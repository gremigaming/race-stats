#!/usr/bin/env python3
"""Handling and consistency summary for one or more telemetry sessions.

    python3 scripts/telemetry/analyse.py FILE.gmtel.gz [...] [--json OUT]

Per session: clean race laps (lap 1, slow laps and laps after the flag left out),
the quali lap, and per lap averages of:
- balance: front minus rear slip angle (degrees) in corners, split by phase
  (entry = braking, mid = neither, exit = throttle >= 60%). Positive = the front
  slides more than the rear (understeer), negative = oversteer.
- oversteer moments, rear wheelspin and lock-ups (counted as events)
- steering corrections in corners, inputs (full throttle, braking, coasting)
- bottoming (plank height near zero), tyre surface temps and hot pressures
- per corner: minimum speed and time, and how much each varies between laps
"""

import argparse
import json
import math
import os
import statistics as st
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gmtel  # noqa: E402

DEG = 180 / math.pi
CORNER_G = 1.5       # lateral g above which a sample counts as cornering
MIN_SPEED = 60       # km/h


def front_rear_slip(s):
    f = (abs(s["slip_angle_fl"]) + abs(s["slip_angle_fr"])) / 2
    r = (abs(s["slip_angle_rl"]) + abs(s["slip_angle_rr"])) / 2
    return f * DEG, r * DEG


def phase(s):
    if s["brake"] > 0.05:
        return "entry"
    if s["throttle"] >= 0.6:
        return "exit"
    return "mid"


def runs(flags, min_len):
    """Number of runs of True at least min_len long."""
    count = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        if cur == min_len:
            count += 1
    return count


def lap_metrics(samples):
    n = len(samples)
    bal = {"entry": [], "mid": [], "exit": []}
    over, spin, lock, corr = [], [], [], 0
    last_dir, last_turn = 0, None
    for s in samples:
        cornering = abs(s["g_lat"]) > CORNER_G and s["speed"] > MIN_SPEED
        f, r = front_rear_slip(s)
        if cornering:
            bal[phase(s)].append(f - r)
        over.append(cornering and r > 3.0 and r > f + 0.5)
        rear_sr = (s["slip_ratio_rl"] + s["slip_ratio_rr"]) / 2
        spin.append(s["throttle"] > 0.3 and rear_sr > 0.10 and s["speed"] > 40)
        lock.append(s["brake"] > 0.1 and min(s["slip_ratio_fl"], s["slip_ratio_fr"],
                                             s["slip_ratio_rl"], s["slip_ratio_rr"]) < -0.15)
        # steering corrections: direction reversals of the wheel while cornering
        if cornering:
            if last_turn is not None:
                d = s["steer"] - last_turn
                if abs(d) > 0.004:
                    direction = 1 if d > 0 else -1
                    if last_dir and direction != last_dir:
                        corr += 1
                    last_dir = direction
            last_turn = s["steer"]
        else:
            last_turn, last_dir = None, 0
    m = {
        "balance_entry": st.mean(bal["entry"]) if bal["entry"] else None,
        "balance_mid": st.mean(bal["mid"]) if bal["mid"] else None,
        "balance_exit": st.mean(bal["exit"]) if bal["exit"] else None,
        "oversteer_moments": runs(over, 6),
        "wheelspin_events": runs(spin, 4),
        "lockups": runs(lock, 4),
        "steering_corrections": corr,
        "full_throttle_pct": 100 * sum(s["throttle"] > 0.98 for s in samples) / n,
        "braking_pct": 100 * sum(s["brake"] > 0.05 for s in samples) / n,
        "coasting_pct": 100 * sum(s["brake"] <= 0.05 and s["throttle"] <= 0.05 for s in samples) / n,
        "max_brake": max(s["brake"] for s in samples),
        "brake_over_80_pct_of_braking": 100 * sum(s["brake"] > 0.8 for s in samples)
        / max(1, sum(s["brake"] > 0.05 for s in samples)),
        "bottoming_front_pct": 100 * sum(s["front_aero_height"] < 0.002 for s in samples) / n,
        "bottoming_rear_pct": 100 * sum(s["rear_aero_height"] < 0.002 for s in samples) / n,
    }
    for w in gmtel.WHEELS:
        m[f"tyre_surface_{w}"] = st.mean(s[f"tyre_surface_{w}"] for s in samples)
        m[f"tyre_psi_{w}"] = st.mean(s[f"tyre_psi_{w}"] for s in samples)
    return m


def corners(ref, min_drop=25):
    """Corner apexes on a reference lap: speed minima after a drop of min_drop km/h."""
    out, peak, low, low_d = [], 0, None, None
    for s in ref:
        v, d = s["speed"], s["lap_distance"]
        if low is None:
            if v > peak:
                peak = v
            elif peak - v >= min_drop:
                low, low_d = v, d
        else:
            if v < low:
                low, low_d = v, d
            elif v - low >= min_drop:
                out.append(low_d)
                peak, low = v, None
    return out


def corner_stats(laps, apexes, window=150):
    """Min speed and time through +-window metres around each apex, per lap."""
    rows = []
    for i, a in enumerate(apexes):
        mins, times = [], []
        for lap in laps:
            seg = [s for s in lap if a - window <= s["lap_distance"] <= a + window]
            if len(seg) < 10:
                continue
            mins.append(min(s["speed"] for s in seg))
            times.append((seg[-1]["lap_time_ms"] - seg[0]["lap_time_ms"]) / 1000)
        if len(times) >= 2:
            rows.append({"corner": i + 1, "apex_m": round(a), "min_speed": round(st.mean(mins)),
                         "min_speed_spread": round(max(mins) - min(mins)),
                         "time_s": round(st.mean(times), 3),
                         "time_spread_s": round(max(times) - min(times), 3)})
    return rows


def analyse(path):
    sess = gmtel.Session(path)
    laps = [(n, l) for n, l in sorted(sess.laps.items()) if l["time_ms"] and len(l["samples"]) > 100]
    is_race = str(sess.info.get("session_type", "")).startswith("Race")
    if is_race:
        clean = [(n, l) for n, l in laps if n > 1 and not l["invalid"]]
        if clean:
            med = st.median(l["time_ms"] for n, l in clean)
            clean = [(n, l) for n, l in clean if l["time_ms"] < med * 1.03]
    else:
        clean = [(n, l) for n, l in laps if n == 1]
    res = {"file": os.path.basename(path), "track": sess.info.get("track"),
           "session": sess.info.get("session_type"),
           "setup": sess.setups[-1][1] if sess.setups else None,
           "laps": [{"lap": n, "time_ms": l["time_ms"], "valid": not l["invalid"]} for n, l in laps],
           "clean_laps": [n for n, l in clean]}
    if not clean:
        return res
    per_lap = [lap_metrics(l["samples"]) for n, l in clean]
    res["metrics"] = {k: (round(st.mean(m[k] for m in per_lap if m[k] is not None), 3)
                          if any(m[k] is not None for m in per_lap) else None) for k in per_lap[0]}
    times = [l["time_ms"] for n, l in clean]
    res["best_ms"], res["mean_ms"] = min(times), round(st.mean(times))
    res["spread_ms"] = max(times) - min(times)
    best = min(clean, key=lambda x: x[1]["time_ms"])[1]["samples"]
    res["corners"] = corner_stats([l["samples"] for n, l in clean], corners(best)) if is_race else []
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json")
    a = ap.parse_args()
    out = [analyse(f) for f in a.files]
    for r in out:
        m = r.get("metrics") or {}
        print(f"\n{r['track']} {r['session']}: clean laps {r['clean_laps']}, best "
              f"{gmtel.fmt_ms(r['best_ms']) if r.get('best_ms') else '-'}, spread {r.get('spread_ms')} ms")
        print("  " + ", ".join(f"{k}={v}" for k, v in m.items()))
        for c in r.get("corners", []):
            print(f"   corner {c}")
    if a.json:
        with open(a.json, "w") as f:
            json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
