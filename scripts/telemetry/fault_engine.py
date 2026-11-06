#!/usr/bin/env python3
"""Fault engine verdicts for every race since 19 Oct 2026, for the safety rating.

For each race file in public/league/sessions (written by build-league-data.mjs) it finds the race
recording in the "telemetry" release (same day, started before the race file was saved, matched
by the contacts both saw: incident_replays.offset), runs the rulebook (verdicts.py) on it and
writes CACHE/verdicts/<race file>.json with every incident on the race file's clock and car
indices. safety_rating.py (SR_RULES=v1) takes all contact blame from these files; the game's
collision calls are not used. Files are kept between builds and only redone when the rulebook
version changes.

    python3 scripts/telemetry/fault_engine.py /tmp/telemetry-cache
"""
import datetime
import glob
import json
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import incident_replays as ir  # noqa: E402
import verdicts  # noqa: E402

FIRST_DAY = "2026_10_19"   # races before this have no telemetry for every car: no SR (GreMi, 31 Oct)
SESSIONS = os.environ.get("LEAGUE_SESSIONS_DIR", os.path.join("public", "league", "sessions"))
WINDOW_MIN = 60            # the recording started at most this long before the race file was saved


def stamp(f):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)", f)
    return datetime.datetime(*map(int, m.groups())) if m else None


def rec_time(n):
    return datetime.datetime.strptime(n[:19], "%Y-%m-%d_%H-%M-%S")


def feats(p):
    """The numbers a contact's call rests on, for the staff grading batches (scripts/telemetry/grading_batch.py)."""
    f, eff = p["features"], p.get("effects") or {}
    return {"ahead_m": f.get("a_ahead_m"), "closing_kmh": round(f.get("closing_a_kmh") or 0, 1),
            "moved": {str(k): v for k, v in (f.get("moved") or {}).items()},
            "rejoin": [int(k) for k, v in (f.get("rejoin") or {}).items() if v],
            "slide_deg": eff.get("max_slide_deg"), "places_lost": eff.get("places_lost"), "off_track": eff.get("off_track"),
            "brake": {str(k): v for k, v in (f.get("brake") or {}).items()},
            "steer": {str(k): v for k, v in (f.get("steer") or {}).items()},
            "push": {str(k): v for k, v in (f.get("push") or {}).items() if v}}


BATTLE_M = 5.0       # less than this apart along the track and ...
BATTLE_SIDE_M = 8.0  # ... this close in a straight line = side by side (wheel to wheel)
BATTLE_END_S = 2.0   # a battle ends when the two cars have not been side by side for this long


def battles(j, incs):
    """Wheel-to-wheel per car, for the staff page's driver summaries: seconds side by side, battles
    (side-by-side spells with one car), battles without a contact, and battles that ended with
    the car ahead of the other (on track, not in the pits). Sampled every 0.25 s."""
    tl = j.track_len
    lap_m = lambda x: x[11] * tl + x[10] if tl else x[10]  # noqa: E731
    touched = {}
    for inc in incs:
        for c in inc["contacts"]:
            touched.setdefault(frozenset((c["a"], c["b"])), []).append(c["t"])
    open_, out = {}, {}
    last_t, step = None, 0.25

    def close(pair, b):
        a_, b_ = sorted(pair)
        clean = not any(b["t0"] - 0.5 <= t <= b["last"] + 0.5 for t in touched.get(pair, []))
        end = j.at(b["last"] + BATTLE_END_S)
        for me, other in ((a_, b_), (b_, a_)):
            s = out.setdefault(me, {"side_s": 0.0, "battles": 0, "clean": 0, "passes": 0})
            s["battles"] += 1
            s["clean"] += clean
            if me in end and other in end and end[me][12] and end[other][12] and end[me][12] < end[other][12] and b["start_pos"].get(me, 99) > end[me][12]:
                s["passes"] += 1

    for t, cars in j.frames:
        if last_t is not None and t - last_t < step:
            continue
        last_t = t
        live = [i for i in cars if i not in j.ai and cars[i][4] > 60]
        for x in range(len(live)):
            for y in range(x + 1, len(live)):
                a, b = live[x], live[y]
                A, B = cars[a], cars[b]
                if abs(lap_m(A) - lap_m(B)) < BATTLE_M and ((A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2) < BATTLE_SIDE_M ** 2:
                    pair = frozenset((a, b))
                    bt = open_.get(pair)
                    if bt is None or t - bt["last"] > BATTLE_END_S:
                        if bt is not None:
                            close(pair, bt)
                        bt = open_[pair] = {"t0": t, "last": t, "start_pos": {a: A[12], b: B[12]}}
                    bt["last"] = t
                    for i in (a, b):
                        out.setdefault(i, {"side_s": 0.0, "battles": 0, "clean": 0, "passes": 0})["side_s"] += step
    for pair, bt in open_.items():
        close(pair, bt)
    return {str(k): dict(v, side_s=round(v["side_s"], 1)) for k, v in out.items()}


def judge(args):
    file, rec, cache = args
    out = os.path.join(cache, "verdicts", file)
    png = json.load(open(os.path.join(SESSIONS, file)))
    path = ir.download(rec, cache)
    sess, incs, j = verdicts.prepare(path)
    off, share = ir.offset(png, sess)
    if off is None or share < 0.5:
        return file, rec, None
    names = {c["index"]: re.sub(r"\s+", " ", c["driver-name"]).strip() for c in png["classification-data"]}
    name = lambda i: names.get(i, f"car {i}")  # noqa: E731
    vs = verdicts.judge_all(j, incs, name)
    keep = lambda p: {"a": p["a"], "b": p["b"], "t": round(p["t"] + off, 2), "rule": p["rule"], "severity": p["severity"],  # noqa: E731
                      "verdict": p["verdict"], "why": p["why"], "at_fault": p.get("at_fault_all") or [],
                      **({"f": feats(p)} if p.get("features") else {})}
    try:
        wheel = battles(j, incs)
    except Exception as ex:   # the summaries can do without it; the verdicts can't
        print(file, ": battles not counted:", ex)
        wheel = {}
    data = {"rules": verdicts.RULES, "recording": rec, "offset": round(off, 2), "matched": round(share, 2),
            "weather": [[round(t + off, 1), w] for t, w in j.weather], "track_temp": sess.info.get("track_temp"),
            "battles": wheel,
            "incidents": [{"t0": round(inc["t0"] + off, 2), "t1": round(inc["t1"] + off, 2), "lap": inc["lap"],
                           "kind": inc.get("kind"), "cars": [d["car"] for d in inc["drivers"]],
                           "roles": {str(d["car"]): d.get("role") for d in inc["drivers"]},
                           "rule": v["rule"], "severity": v["severity"], "verdict": v["verdict"], "why": v["why"],
                           "weather": j.weather_at(inc["t0"]),
                           "at_fault": v.get("at_fault_all") or [], "contacts": [keep(p) for p in v["contacts"]]}
                          for inc, v in zip(incs, vs)]}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(data, open(out + ".tmp", "w"), separators=(",", ":"))
    os.replace(out + ".tmp", out)
    return file, rec, share


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    os.makedirs(os.path.join(cache, "verdicts"), exist_ok=True)
    assets = {os.path.basename(p) for p in glob.glob(os.path.join(cache, "*_Race.gmtel.gz"))}
    try:
        assets.update(a["name"] for a in ir.http_json(ir.RELEASE)["assets"] if a["name"].endswith("_Race.gmtel.gz"))
    except Exception as ex:
        print("telemetry release not reachable, using the kept recordings:", ex)
    assets = sorted(assets)
    todo, used = [], set()
    for f in sorted(glob.glob(os.path.join(SESSIONS, "Race_*.json")), key=lambda f: stamp(f)):
        file = os.path.basename(f)
        if stamp(f).strftime("%Y_%m_%d") < FIRST_DAY:
            continue
        out = os.path.join(cache, "verdicts", file)
        if os.path.exists(out):
            try:
                if json.load(open(out)).get("rules") == verdicts.RULES:
                    used.add(json.load(open(out))["recording"]); continue
            except Exception:
                pass
        saved = stamp(f)
        cands = [n for n in assets if n not in used and saved - datetime.timedelta(minutes=WINDOW_MIN) <= rec_time(n) <= saved]
        if not cands:
            print(file, ": no recording")
            continue
        rec = max(cands, key=rec_time)   # the latest race recording before the save
        used.add(rec)
        todo.append((file, rec, cache))
    with ProcessPoolExecutor(int(os.environ.get("FAULT_JOBS", "2"))) as ex:
        for file, rec, share in ex.map(judge, todo):
            print(file, "<-", rec, f"({share:.0%} of contacts matched)" if share is not None else ": contacts did not match, not judged")


if __name__ == "__main__":
    main()
