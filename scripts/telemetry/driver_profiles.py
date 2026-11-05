#!/usr/bin/env python3
"""Driver summaries for the staff page (GreMi, 5 Nov 2026): what kind of driver someone is, so
staff can give them tips. Never used by the fault engine or the safety rating: a driver's history
must not change the call on an incident.

For every driver with MIN_RACES+ judged races (races from 19 Oct 2026 on with a fault engine
verdict file, CACHE/verdicts after precedents.py) it adds up:
  - pace: best lap against the race's fastest, and lap-to-lap spread on clean laps
  - results: grid, finish, places gained
  - incidents: involved, at fault, hit by someone else, average severity when at fault
  - how they hit others when at fault: under braking, turning in / moving across, on the straight
    (pedals, steering and sideways movement just before the contact) and the incident types
  - wheel to wheel: seconds side by side, battles, battles without a contact, passes made in them
  - lash-outs: hitting the same car again (R9) and at-fault incidents soon after being hit
  - trend: at-fault incidents per race in the last 5 races against the ones before
plus a few plain-language notes that point at a tip. Written to public/league/driver-profiles.json.

    python3 scripts/telemetry/driver_profiles.py /tmp/telemetry-cache
"""
import collections
import datetime
import glob
import json
import os
import re
import statistics
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from incident_kinds import kind_of, phase_of  # noqa: E402

MIN_RACES = 5
FIRST_DAY = "2026_10_19"   # same as fault_engine.py: all-car telemetry from here on
AFTER_HIT_S = 60           # an at-fault incident this soon after being hit = maybe a reaction
SESSIONS = os.environ.get("LEAGUE_SESSIONS_DIR", os.path.join("public", "league", "sessions"))
OUT = os.path.join("public", "league", "driver-profiles.json")
HIDDEN = re.compile(r"'\d\d #\d+$")   # a hidden name ("Ferrari '26 #28") can be anyone: no summary


def stamp(f):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)", f)
    return datetime.datetime(*map(int, m.groups())) if m else None


def nm(n):
    return re.sub(r"\s+", " ", n or "").strip()


def laps_of(c):
    out = []
    for k, lap in enumerate((c.get("session-history") or {}).get("lap-history-data") or []):
        ms = lap.get("lap-time-in-ms") or 0
        if ms > 0 and k > 0 and (lap.get("lap-valid-bit-flags", 15) & 1):   # lap 1 and invalid laps out
            out.append(ms)
    return out


def race(file, cache):
    """{driver name: numbers of this race} for one race file, or {} without a verdict file."""
    try:
        png = json.load(open(os.path.join(SESSIONS, file), encoding="utf-8"))
        v = json.load(open(os.path.join(cache, "verdicts", file), encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    cls = png.get("classification-data") or []
    best = [c["final-classification"]["best-lap-time-ms"] for c in cls
            if (c.get("final-classification") or {}).get("best-lap-time-ms")]
    fastest = min(best) if best else None
    wet = any(w >= 3 for _, w in v.get("weather") or [])
    names = {c["index"]: nm(c["driver-name"]) for c in cls}
    out = {}
    for c in cls:
        n = names[c["index"]]
        if c.get("is-player") or HIDDEN.search(n):
            continue
        fc = c.get("final-classification") or {}
        laps = laps_of(c)
        clean = [x for x in laps if laps and x <= 1.07 * statistics.median(laps)]
        out[n] = {"car": c["index"], "file": file, "wet": wet,
                  "grid": fc.get("grid-position"), "finish": fc.get("position") if fc.get("result-status") == "FINISHED" else None,
                  "pace": round(100 * (fc["best-lap-time-ms"] / fastest - 1), 2) if fastest and fc.get("best-lap-time-ms") else None,
                  "spread": round(100 * statistics.pstdev(clean) / statistics.mean(clean), 2) if len(clean) >= 3 else None,
                  "involved": 0, "fault": 0, "hit": 0, "sev": [], "phases": collections.Counter(), "types": collections.Counter(),
                  "r9": 0, "after_hit": 0, "battles": (v.get("battles") or {}).get(str(c["index"])) or {}}
    by_car = {d["car"]: n for n, d in out.items()}
    hits = collections.defaultdict(list)   # car -> times it was hit by someone at fault
    incs = sorted(v.get("incidents") or [], key=lambda i: i["t0"])
    for inc in incs:
        if inc.get("rule") in ("R1", "R6"):
            continue
        cars = [int(k) for k, r in (inc.get("roles") or {}).items() if r == "contact"] or inc.get("cars") or []
        fault = set(inc.get("at_fault") or [])
        for x in cars:
            if x not in by_car:
                continue
            d = out[by_car[x]]
            d["involved"] += 1
            if x in fault:
                d["fault"] += 1
                d["sev"].append(inc.get("severity") or 1)
                d["types"][kind_of(inc)] += 1
                mine = [c for c in inc["contacts"] if x in (c.get("at_fault") or [])]
                for c in mine[:1]:
                    d["phases"][phase_of(c, x)] += 1
                d["r9"] += any(c.get("rule") == "R9" for c in mine)
                if any(0 < inc["t0"] - t <= AFTER_HIT_S for t in hits[x]):
                    d["after_hit"] += 1
            elif fault:
                d["hit"] += 1
                hits[x].append(inc["t0"])
    return out


def mean(xs):
    xs = [x for x in xs if x is not None]
    return round(sum(xs) / len(xs), 2) if xs else None


def summary(name, rs):
    n = len(rs)
    ph, ty = collections.Counter(), collections.Counter()
    for r in rs:
        ph.update(r["phases"])
        ty.update(r["types"])
    b = [r["battles"] for r in rs]
    battles = sum(x.get("battles", 0) for x in b)
    fault = sum(r["fault"] for r in rs)
    recent, before = rs[-5:], rs[:-5]
    gained = [r["grid"] - r["finish"] for r in rs if r.get("grid") and r.get("finish")]
    return {"name": name, "races": n, "wet_races": sum(r["wet"] for r in rs),
            "first": rs[0]["file"], "last": rs[-1]["file"],
            "grid": mean(r["grid"] for r in rs), "finish": mean(r["finish"] for r in rs), "gained": mean(gained),
            "pace_gap_pct": mean(r["pace"] for r in rs), "spread_pct": mean(r["spread"] for r in rs),
            "involved_per_race": round(sum(r["involved"] for r in rs) / n, 2),
            "fault_per_race": round(fault / n, 2), "hit_per_race": round(sum(r["hit"] for r in rs) / n, 2),
            "avg_severity": mean(s for r in rs for s in r["sev"]),
            "phases": dict(ph.most_common()), "types": dict(ty.most_common()),
            "lash_outs": sum(r["r9"] for r in rs), "after_hit": sum(r["after_hit"] for r in rs),
            "side_s_per_race": round(sum(x.get("side_s", 0) for x in b) / n, 1),
            "battles_per_race": round(battles / n, 1),
            "clean_battle_pct": round(100 * sum(x.get("clean", 0) for x in b) / battles) if battles else None,
            "passes_per_race": round(sum(x.get("passes", 0) for x in b) / n, 2),
            "trend": {"recent": round(sum(r["fault"] for r in recent) / len(recent), 2),
                      "before": round(sum(r["fault"] for r in before) / len(before), 2) if before else None}}


def notes(p, league):
    """A few plain-language observations that point at a tip (staff decide what to tell the driver)."""
    out = []
    ph = p["phases"]
    tot = sum(ph.values())
    if tot >= 3:
        top, k = max(ph.items(), key=lambda x: x[1])
        if k / tot >= 0.5:
            where = {"braking": "under braking", "turning in / moving across": "while turning in or moving across",
                     "on the straight": "on the straight"}[top]
            tip = {"braking": "braking a bit earlier or leaving a gap into corners would help",
                   "turning in / moving across": "checking mirrors and leaving a car's width would help",
                   "on the straight": "watch the closing speed in the slipstream"}[top]
            out.append(f"{k} of {tot} at-fault contacts happen {where}: {tip}")
    lf, f = league.get("fault_per_race"), p["fault_per_race"]
    if lf and f >= 1.5 * lf and f >= 0.4:
        out.append(f"At fault {f:g} times per race, league average {lf:g}")
    elif lf is not None and f <= 0.5 * lf:
        out.append(f"Clean: at fault {f:g} times per race, league average {lf:g}")
    if p["hit_per_race"] >= 1.5 * max(league.get("hit_per_race") or 0, 0.2):
        out.append(f"Gets hit a lot ({p['hit_per_race']:g} per race): often in the wrong place at the wrong time, or hard to read")
    if p["lash_outs"]:
        out.append(f"Hit the same car again on purpose {p['lash_outs']} time{'s' if p['lash_outs'] > 1 else ''} (R9)")
    if p["after_hit"] >= 2:
        out.append(f"{p['after_hit']} at-fault incidents within a minute of being hit: may lose their cool after contact")
    cb = p.get("clean_battle_pct")
    if cb is not None and p["battles_per_race"] >= 2:
        lcb = league.get("clean_battle_pct")
        if lcb and cb >= lcb + 10:
            out.append(f"Good wheel to wheel: {cb}% of battles without contact (league {lcb}%)")
        elif lcb and cb <= lcb - 10:
            out.append(f"Wheel to wheel is a weak spot: {cb}% of battles without contact (league {lcb}%)")
    pg, lpg = p.get("pace_gap_pct"), league.get("pace_gap_pct")
    if pg is not None and lpg is not None:
        if pg <= lpg - 0.5:
            out.append(f"Quick: best lap {pg:g}% off the fastest on average (league {lpg:g}%)")
        elif pg >= lpg + 1:
            out.append(f"Pace: {pg:g}% off the fastest on average (league {lpg:g}%)")
    sp = p.get("spread_pct")
    if sp is not None and league.get("spread_pct") and sp >= league["spread_pct"] * 1.4:
        out.append(f"Lap times vary a lot ({sp:g}% spread, league {league['spread_pct']:g}%): consistency before speed")
    t = p["trend"]
    if t["before"] is not None and p["races"] >= 8:
        if t["recent"] <= t["before"] - 0.3:
            out.append(f"Getting cleaner: {t['recent']:g} at-fault per race in the last 5, {t['before']:g} before")
        elif t["recent"] >= t["before"] + 0.3:
            out.append(f"Getting messier: {t['recent']:g} at-fault per race in the last 5, {t['before']:g} before")
    return out


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    files = sorted((os.path.basename(f) for f in glob.glob(os.path.join(SESSIONS, "Race_*.json"))
                    if stamp(f) and stamp(f).strftime("%Y_%m_%d") >= FIRST_DAY), key=stamp)
    per = collections.defaultdict(list)
    for f in files:
        for n, r in race(f, cache).items():
            per[n].append(r)
    profiles = [summary(n, rs) for n, rs in per.items() if len(rs) >= MIN_RACES]
    keys = ("fault_per_race", "hit_per_race", "pace_gap_pct", "spread_pct", "clean_battle_pct", "battles_per_race", "involved_per_race")
    league = {k: mean(p[k] for p in profiles) for k in keys}
    league = {k: (round(v) if k == "clean_battle_pct" else round(v, 2)) if v is not None else None for k, v in league.items()}
    for p in profiles:
        p["notes"] = notes(p, league)
    profiles.sort(key=lambda p: p["name"].lower())
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({"made": datetime.date.today().isoformat(), "min_races": MIN_RACES, "races": len(files), "league": league,
               "drivers": profiles}, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("driver profiles:", len(profiles), "drivers with", MIN_RACES, "+ races, from", len(files), "races")


if __name__ == "__main__":
    main()
