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
SESSIONS = os.path.join("public", "league", "sessions")
WINDOW_MIN = 60            # the recording started at most this long before the race file was saved


def stamp(f):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)", f)
    return datetime.datetime(*map(int, m.groups())) if m else None


def rec_time(n):
    return datetime.datetime.strptime(n[:19], "%Y-%m-%d_%H-%M-%S")


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
                      "verdict": p["verdict"], "why": p["why"], "at_fault": p.get("at_fault_all") or []}
    data = {"rules": verdicts.RULES, "recording": rec, "offset": round(off, 2), "matched": round(share, 2),
            "incidents": [{"t0": round(inc["t0"] + off, 2), "t1": round(inc["t1"] + off, 2), "lap": inc["lap"],
                           "kind": inc.get("kind"), "cars": [d["car"] for d in inc["drivers"]],
                           "roles": {str(d["car"]): d.get("role") for d in inc["drivers"]},
                           "rule": v["rule"], "severity": v["severity"], "verdict": v["verdict"], "why": v["why"],
                           "at_fault": v.get("at_fault_all") or [], "contacts": [keep(p) for p in v["contacts"]]}
                          for inc, v in zip(incs, vs)]}
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump(data, open(out + ".tmp", "w"), separators=(",", ":"))
    os.replace(out + ".tmp", out)
    return file, rec, share


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    os.makedirs(os.path.join(cache, "verdicts"), exist_ok=True)
    try:
        assets = sorted(a["name"] for a in ir.http_json(ir.RELEASE)["assets"] if a["name"].endswith("_Race.gmtel.gz"))
    except Exception as ex:
        print("telemetry release not reachable, using the kept recordings:", ex)
        assets = sorted(os.path.basename(p) for p in glob.glob(os.path.join(cache, "*_Race.gmtel.gz")))
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
