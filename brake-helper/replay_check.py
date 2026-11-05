#!/usr/bin/env python3
"""Replay recorded races (.gmtel.gz) through the brake helper engine of a patched
Pits n' Giggles checkout and check that it behaves.

    python3 brake-helper/replay_check.py PNG_DIR FILE.gmtel.gz [FILE ...]

Each file is replayed twice with the same reference store (second run = next race on
that track). Prints corners, results and how close the shown brake point was to where
the driver actually braked. Exits 1 if something is clearly wrong.
"""
import bisect
import collections
import importlib.util
import os
import statistics
import sys
import tempfile
import types

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts", "telemetry"))
import gmtel  # noqa: E402


def load_engine(png_dir):
    path = os.path.join(png_dir, "apps/hud/ui/overlays/brake_helper/brake_engine.py")
    spec = importlib.util.spec_from_file_location("brake_engine", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def samples(path):
    """Engine samples from a recording. Bias = setup bias; fuel/wear estimated (the
    recorder does not keep the car status / damage packets)."""
    S = gmtel.Session(path)
    bias = S.setups[0][1]["brake_bias"] if S.setups else 56
    fuel0 = S.setups[0][1].get("fuel_load", 10.0) if S.setups else 10.0
    L = S.info["track_length"]
    ftimes = sorted(S.field)
    out = []
    for n in sorted(S.laps):
        for x in S.laps[n]["samples"]:
            if "lap_distance" not in x or "speed" not in x or "slip_ratio_fl" not in x:
                continue
            others = []
            i = bisect.bisect_right(ftimes, x["t"]) - 1
            if i >= 0 and x["t"] - ftimes[i] < 0.5:
                for r in S.field[ftimes[i]].values():
                    if "lap_distance" in r and abs(r["lap_distance"] - x["lap_distance"]) > 0.01 \
                            and not r.get("pit_status"):
                        others.append([r["lap_distance"], r.get("speed")])
            lapf = max(0, n - 1) + max(0.0, x["lap_distance"]) / L
            out.append((x["t"], types.SimpleNamespace(
                player=True, track_id=S.info["track"], track_length=L, session_uid=1,
                lap_num=x["lap"], lap_distance=x["lap_distance"], lap_invalid=bool(x.get("lap_invalid")),
                pit_status=x.get("pit_status", 0), speed_kmph=x["speed"], throttle=x["throttle"],
                brake=x["brake"],
                tyre_surface_temp=[x["tyre_surface_rl"], x["tyre_surface_rr"], x["tyre_surface_fl"],
                                   x["tyre_surface_fr"]],
                front_brake_bias=bias, fuel_kg=max(0.0, fuel0 - 1.8 * lapf), visual_compound=16,
                tyre_wear=[3.0 * lapf] * 4,
                wheel_slip=[x["slip_ratio_rl"], x["slip_ratio_rr"], x["slip_ratio_fl"], x["slip_ratio_fr"]],
                pos_x=x["x"], pos_z=x["z"], weather=S.info.get("weather", 0), rain_pct=0, others=others)))
    return S, out


def replay(be, smp, store):
    eng = be.BrakeEngine(store_dir=store)
    modes, results, errs, last = collections.Counter(), collections.Counter(), [], None
    prev_mode = None
    for t, s in smp:
        v = eng.update(s, t)
        modes[v["mode"]] += 1
        if v["mode"] == "result" and prev_mode != "result":
            results[v["label"]] += 1
        prev_mode = v["mode"]
        e = getattr(eng, "last_eval", None)
        if e is not last and e:
            errs.append(abs(e["start_err"]))
            last = e
    eng.save()
    return eng, modes, results, errs


def main():
    png_dir, files = sys.argv[1], sys.argv[2:]
    be = load_engine(png_dir)
    ok = True
    for f in files:
        S, smp = samples(f)
        store = tempfile.mkdtemp()
        print(f"## {S.info['track']} ({os.path.basename(f)}), {len(smp)} samples")
        for run in (1, 2):
            eng, modes, results, errs = replay(be, smp, store)
            med = statistics.median(errs) if errs else None
            print(f"run {run}: corners {sum(c.confirmed for c in eng.corners)}, judged zones {len(errs)}, "
                  f"median |brake start - shown point| {med and round(med, 1)} m, results {dict(results)}")
            if run == 2:
                if sum(c.confirmed for c in eng.corners) < 4 or not errs or med > 25 or results.get("Good", 0) < len(errs) / 3:
                    print("  -> FAIL")
                    ok = False
                for c in eng.corners:
                    r = c.refs.get("dry") if c.confirmed else None
                    if r:
                        print(f"   corner at {c.apex:6.0f} m: brake {r['start']:6.0f} m, "
                              f"{r['v_entry'] * 3.6:3.0f} -> {r['vmin'] * 3.6:3.0f} km/h")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
