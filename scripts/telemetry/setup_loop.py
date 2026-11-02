#!/usr/bin/env python3
"""Setup loop: GreMi's versioned in-game setups (setups/registry.json).

    python3 scripts/telemetry/setup_loop.py CACHE_DIR [ADVICE.json]

Every track keeps three setups in F1 25 Time Trial (F1 2026 car, Red Bull):
QUALI, RACE and WET, saved as "TRACK - KIND - V<n>". After a stream this:

1. finds the sessions driven on a saved version (the car setup in the
   telemetry matches the version's values exactly),
2. gives every change a verdict: the version against the one it was based on
   (average clean race lap, or the quali lap),
3. for every track that isn't finished and whose newest version was driven,
   adds the next version: one change nobody tried yet on that setup, picked from
   what the telemetry shows (setup_manager.advise), else from a fixed list.
   A worse change is undone first; a better one is kept.

New versions wait with "saved": null until the Apply run (docs/setup-apply.md)
saves them in the game. Uses the measurements setup_manager.py keeps in
CACHE_DIR, so it runs after that script. With ADVICE.json, the registry is
also added to it (as "manager") for the encrypted Setup manager page.
"""

import copy
import datetime
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import setup_manager as SM  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REGISTRY = os.path.join(ROOT, "setups", "registry.json")
KINDS = ["quali", "race", "wet"]

# Short keys (the registry and the Apply run) and the telemetry's names
TEL = {"fw": "front_wing", "rw": "rear_wing", "don": "diff_on_throttle", "doff": "diff_off_throttle",
       "fc": "front_camber", "rc": "rear_camber", "ft": "front_toe", "rt": "rear_toe",
       "fs": "front_suspension", "rs": "rear_suspension", "farb": "front_arb", "rarb": "rear_arb",
       "frh": "front_ride_height", "rrh": "rear_ride_height", "bb": "brake_bias", "bp": "brake_pressure",
       "fr": "fr_psi", "fl": "fl_psi", "rr": "rr_psi", "rl": "rl_psi"}
SHORT = {v: k for k, v in TEL.items()}
# One click of the in-game slider
STEP = {"fw": 1, "rw": 1, "don": 5, "doff": 5, "fc": 0.1, "rc": 0.1, "ft": 0.01, "rt": 0.01, "fs": 1, "rs": 1,
        "farb": 1, "rarb": 1, "frh": 1, "rrh": 1, "bb": 1, "bp": 1, "fr": 0.1, "fl": 0.1, "rr": 0.1, "rl": 0.1}
RANGE = {"fw": (0, 50), "rw": (0, 50), "don": (10, 100), "doff": (10, 100), "fc": (-3.5, -2.5), "rc": (-2.0, -1.0),
         "ft": (0.0, 0.5), "rt": (0.1, 0.5), "fs": (1, 41), "rs": (1, 41), "farb": (1, 21), "rarb": (1, 21),
         "frh": (15, 35), "rrh": (40, 60), "bb": (50, 70), "bp": (80, 100), "fr": (22.5, 29.5),
         "fl": (22.5, 29.5), "rr": (20.5, 26.5), "rl": (20.5, 26.5)}
NAMES = {"fw": "Front wing", "rw": "Rear wing", "don": "On-throttle diff", "doff": "Off-throttle diff",
         "fc": "Front camber", "rc": "Rear camber", "ft": "Front toe", "rt": "Rear toe", "fs": "Front springs",
         "rs": "Rear springs", "farb": "Front anti-roll bar", "rarb": "Rear anti-roll bar",
         "frh": "Front ride height", "rrh": "Rear ride height", "bb": "Brake bias", "bp": "Brake pressure",
         "fr": "Front tyre pressure", "fl": "Front tyre pressure", "rr": "Rear tyre pressure",
         "rl": "Rear tyre pressure"}
PAIRS = {"fr": ("fr", "fl"), "fl": ("fr", "fl"), "rr": ("rr", "rl"), "rl": ("rr", "rl")}

# Tried in this order when the telemetry asks for nothing new: small steps,
# the safe direction first (GreMi wants a stable car over the last tenth)
EXPLORE = [
    ({"rw": 2}, "More rear wing for a calmer rear in fast corners."),
    ({"don": -10}, "A more open on-throttle diff for less wheelspin out of slow corners."),
    ({"fw": 2}, "More front wing for a sharper turn-in."),
    ({"doff": 5}, "A slightly more locked off-throttle diff for a calmer rear on entry."),
    ({"rarb": -1}, "A softer rear anti-roll bar for more rear grip mid-corner."),
    ({"farb": 1}, "A slightly stiffer front anti-roll bar for a quicker change of direction."),
    ({"bb": -1}, "A little more brake bias to the rear to help the car turn under braking."),
    ({"bp": -2}, "A little less brake pressure for more feel without ABS."),
    ({"rs": -2}, "Softer rear springs for more traction over the kerbs."),
    ({"fs": -2}, "Softer front springs for more front grip over bumps."),
    ({"frh": 1}, "A slightly higher front against bottoming under braking."),
    ({"rrh": 1}, "A slightly higher rear for a calmer car over the kerbs."),
    ({"fr": -0.4, "fl": -0.4}, "Lower front tyre pressure for more front grip."),
    ({"rr": -0.4, "rl": -0.4}, "Lower rear tyre pressure for more traction."),
    ({"rw": -2}, "Less rear wing for more top speed."),
    ({"don": 10}, "A more locked on-throttle diff for a stronger exit."),
    ({"fw": -2}, "Less front wing for a calmer front end."),
    ({"doff": -5}, "A more open off-throttle diff for an easier turn-in."),
    ({"bb": 1}, "A little more brake bias to the front for more stable braking."),
]
BETTER, WORSE = -0.15, 0.15   # % of the lap time; between them there's no clear difference


def snap(k, v):
    lo, hi = RANGE[k]
    v = min(hi, max(lo, v))
    return round(round(v / STEP[k]) * STEP[k], 2)


def short_setup(tel):
    return {k: tel[t] for k, t in TEL.items() if t in tel}


def same(a, b):
    return all(abs(a.get(k, 1e9) - b.get(k, -1e9)) < STEP[k] / 2 for k in TEL)


def describe(change):
    parts = []
    seen = set()
    for k, (old, new) in change.items():
        name = NAMES[k]
        if name in seen:
            continue
        seen.add(name)
        parts.append(f"{name} {fmt(k, old)} → {fmt(k, new)}")
    return ", ".join(parts)


def fmt(k, v):
    if k in ("fr", "fl", "rr", "rl"):
        return f"{v:.1f}"
    if k in ("fc", "rc"):
        return f"{v:.1f}°"
    if k in ("ft", "rt"):
        return f"{v:.2f}°"
    if k in ("don", "doff", "bb", "bp"):
        return f"{int(v)}%"
    return str(int(v))


def lap(ms):
    return f"{int(ms // 60000)}:{(ms % 60000) / 1000:06.3f}" if ms else "—"


def sessions_by_version(reg, metrics):
    """{(track, kind, v): [session, ...]} for every session driven on a saved
    version on or after the day it was saved."""
    ids = {tid: t["track"] for t in reg["tracks"] for tid in t["trackIds"]}
    out = {}
    for name in sorted(metrics):
        r = metrics[name]
        if not r or not r.get("setup") or r.get("track") not in ids:
            continue
        track = next(t for t in reg["tracks"] if t["track"] == ids[r["track"]])
        setup = short_setup(r["setup"])
        date = name[:10].replace("_", "-")
        quali = "_OSQ" in name
        for kind in KINDS:
            for v in track["kinds"][kind]["versions"]:
                if v.get("saved") and date >= v["saved"] and same(setup, v["values"]):
                    pace = r.get("best") if quali else r.get("mean")
                    out.setdefault((track["track"], kind, v["v"]), []).append({
                        "file": name, "date": date, "session": "quali" if quali else "race",
                        "weather": r.get("weather"), "pace": pace, "best": r.get("best"),
                        "mean": r.get("mean"), "laps": len(r.get("clean") or []), "_r": r})
    return out


def counted(kind, sessions):
    """Sessions that judge a setup of this kind: quali laps for QUALI, races for
    RACE and WET (in the wet only when it rained)."""
    want = "quali" if kind == "quali" else "race"
    s = [x for x in sessions if x["session"] == want and x["pace"]]
    if kind == "wet":
        s = [x for x in s if (x["weather"] or 0) >= 3]
    elif kind == "race":
        s = [x for x in s if (x["weather"] or 0) < 3]
    return s


def mean_pace(s):
    return sum(x["pace"] for x in s) / len(s)


def verdict(kind, version, base, found):
    mine = counted(kind, found.get(version["v"], []))
    if not mine:
        return {"result": "untested", "text": "Not driven yet."}
    if base is None:
        return {"result": "baseline", "text": f"Starting point: {lap(mean_pace(mine))} over {len(mine)} "
                                              f"{'session' if len(mine) == 1 else 'sessions'}."}
    theirs = counted(kind, found.get(base["v"], []))
    if not theirs:
        return {"result": "untested", "text": f"V{base['v']} has no laps to compare with."}
    a, b = mean_pace(mine), mean_pace(theirs)
    d = (a - b) / b * 100
    what = "quali lap" if kind == "quali" else "average lap"
    if d <= BETTER:
        return {"result": "better", "delta": round(d, 2),
                "text": f"Better: {what} {lap(a)} against {lap(b)} on V{base['v']} ({abs(a - b) / 1000:.3f} s faster)."}
    if d >= WORSE:
        return {"result": "worse", "delta": round(d, 2),
                "text": f"Worse: {what} {lap(a)} against {lap(b)} on V{base['v']} ({abs(a - b) / 1000:.3f} s slower)."}
    return {"result": "same", "delta": round(d, 2),
            "text": f"No clear difference: {what} {lap(a)} against {lap(b)} on V{base['v']}."}


def tried(versions, base_values):
    """(key, direction) pairs already tried on this setup."""
    out = set()
    for v in versions:
        for k, (old, new) in (v.get("change") or {}).items():
            out.add((k, 1 if new > old else -1))
    return out


def next_change(kind, versions, base, last_session):
    done = tried(versions, base["values"])
    options = []
    if last_session and last_session.get("_r", {}).get("m"):
        r = copy.deepcopy(last_session["_r"])
        r["setup"] = {**r["setup"], **{TEL[k]: v for k, v in base["values"].items()}}
        rec, _, findings = SM.advise(r)
        for tk, (value, why) in rec.items():
            k = SHORT.get(tk)
            if not k:
                continue
            delta = value - base["values"][k]
            keys = PAIRS.get(k, (k,))
            options.append(({x: delta for x in keys}, why))
    options += EXPLORE
    for deltas, why in options:
        change = {}
        for k, d in deltas.items():
            new = snap(k, base["values"][k] + d)
            if new != base["values"][k]:
                change[k] = [base["values"][k], new]
        if not change or any((k, 1 if n > o else -1) in done for k, (o, n) in change.items()):
            continue
        return change, why
    return None, None


def run(reg, metrics, today):
    found_all = sessions_by_version(reg, metrics)
    for t in reg["tracks"]:
        for kind in KINDS:
            versions = t["kinds"][kind]["versions"]
            found = {v["v"]: found_all.get((t["track"], kind, v["v"]), []) for v in versions}
            by_v = {v["v"]: v for v in versions}
            for v in versions:
                v["sessions"] = [{k: x[k] for k in x if k != "_r"} for x in found[v["v"]]]
                v["verdict"] = verdict(kind, v, by_v.get(v.get("base")), found)
            last = versions[-1]
            if t.get("finished") or not last.get("saved") or last["verdict"]["result"] == "untested":
                continue
            # Keep a change that helped (or the starting point); undo one that didn't
            keep = last["verdict"]["result"] in ("baseline", "better")
            base = last if keep else by_v.get(last.get("base"), last)
            mine = counted(kind, found[last["v"]])
            change, why = next_change(kind, versions, base, mine[-1] if mine else None)
            if not change:
                continue
            values = dict(base["values"])
            for k, (_, new) in change.items():
                values[k] = new
            note = "" if keep else f" V{last['v']}'s change is undone (it didn't make the car faster)."
            versions.append({"v": last["v"] + 1, "base": base["v"], "created": today, "saved": None,
                             "values": values, "change": change, "text": describe(change),
                             "why": why + note, "sessions": [], "verdict": {"result": "untested",
                                                                            "text": "Not driven yet."}})
    pending = [f"{t['track']} {k} V{t['kinds'][k]['versions'][-1]['v']}" for t in reg["tracks"] for k in KINDS
               if not t["kinds"][k]["versions"][-1].get("saved")]
    reg["pending"] = len(pending)
    return pending


def main():
    cache = sys.argv[1]
    metrics_file = os.path.join(cache, f"metrics-v{SM.METRICS_VERSION}.json")
    metrics = json.load(open(metrics_file)) if os.path.exists(metrics_file) else {}
    reg = json.load(open(REGISTRY))
    before = json.dumps(reg, sort_keys=True)
    pending = run(reg, metrics, datetime.date.today().isoformat())
    if json.dumps(reg, sort_keys=True) != before:
        with open(REGISTRY, "w") as f:
            json.dump(reg, f, indent=1, ensure_ascii=False)
            f.write("\n")
    print(f"setup loop: {len(pending)} versions waiting for the Apply run", *pending[:20], sep="\n  ")
    if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
        advice = json.load(open(sys.argv[2]))
        advice["manager"] = reg
        json.dump(advice, open(sys.argv[2], "w"), ensure_ascii=False)


if __name__ == "__main__":
    main()
