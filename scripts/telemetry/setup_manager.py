#!/usr/bin/env python3
"""Setup advice for the Setup manager page (GreMi only, behind a Discord login).

    python3 scripts/telemetry/setup_manager.py CACHE_DIR OUT.json

Downloads GreMi's race and one-shot qualifying telemetry from the "telemetry"
release (kept in CACHE_DIR between runs), measures how the car behaved in each
session and turns that into a recommended value and a reason for every setup
setting. Per track there is a qualifying, a race and, only where GreMi drove in
the rain, a wet setup. A track without a recorded qualifying gets its race
advice with qualifying fuel.

The rules favour a stable car: GreMi prefers a predictable car over the last
tenth, and drives without traction control or ABS. The site encrypts the output
(scripts/encrypt-setups.mjs), so it never goes out readable.
"""

import copy
import json
import os
import statistics as st
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import analyse as A  # noqa: E402
import gmtel  # noqa: E402

RELEASE = "https://api.github.com/repos/gremigaming/race-stats/releases/tags/telemetry"
DOWNLOAD = "https://github.com/gremigaming/race-stats/releases/download/telemetry/"
METRICS_VERSION = 1  # bump when the measured values change, to measure every file again

LIMITS = {"front_wing": (0, 50), "rear_wing": (0, 50), "diff_on_throttle": (10, 100), "diff_off_throttle": (10, 100),
          "front_suspension": (1, 41), "rear_suspension": (1, 41), "front_arb": (1, 21), "rear_arb": (1, 21),
          "front_ride_height": (15, 35), "rear_ride_height": (40, 60), "brake_pressure": (80, 100),
          "brake_bias": (50, 70), "fl_psi": (22.5, 29.5), "fr_psi": (22.5, 29.5), "rl_psi": (20.5, 26.5),
          "rr_psi": (20.5, 26.5)}

# Reasons for settings the data says nothing against
KEEP = {
    "front_camber": "At the usual value. The game doesn't send tyre temperatures per edge, so camber can't be tuned better from the data.",
    "rear_camber": "At the usual value. The game doesn't send tyre temperatures per edge, so camber can't be tuned better from the data.",
    "front_toe": "At the usual value; nothing in the data asks for a change.",
    "rear_toe": "At the usual value; nothing in the data asks for a change.",
    "engine_braking": "No corner entry trouble that engine braking would fix.",
    "ballast": "No effect found in the data.",
    "fuel_load": "Enough for 5 laps.",
}
NO_ISSUE = "Nothing in the data asks for a change."

# Changes confirmed on track in practice: these win over the rules
TESTED = {
    "Singapore": {
        "note": "Tested in practice on 18 Oct: 1:31.71 average without ERS, as fast as the old setup with ERS.",
        "values": {
            "rear_wing": (42, "Tested: less wheelspin and less heat in the rear tyres."),
            "diff_on_throttle": (80, "Tested: better traction out of the slow corners."),
            "diff_off_throttle": (45, "Tested: calmer turn-in into the slow corners."),
            "front_suspension": (35, "Tested: more front grip over the bumps."),
            "front_ride_height": (22, "Tested: the front no longer hits the ground under hard braking."),
            "brake_bias": (58, "Tested: the rear wheels were locking first."),
            "fl_psi": (26.5, "Tested: the front tyres now get up to temperature (70-78 °C)."),
            "fr_psi": (26.5, "Tested: the front tyres now get up to temperature (70-78 °C)."),
        },
    },
}


def http_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json", "User-Agent": "race-stats"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(DOWNLOAD + name, path + ".tmp")
        os.replace(path + ".tmp", path)
    return path


def measure(path, quali):
    """Laps, setup and handling numbers of one session."""
    s = gmtel.Session(path)
    laps = [(n, l) for n, l in sorted(s.laps.items()) if l["time_ms"] and len(l["samples"]) > 1000]
    if quali:
        clean = [(n, l) for n, l in laps if n == 1]
    else:
        clean = [(n, l) for n, l in laps if n > 1 and not l["invalid"]]
        if clean:
            med = st.median(l["time_ms"] for n, l in clean)
            clean = [(n, l) for n, l in clean if l["time_ms"] < med * 1.03]
    out = {"track": s.info.get("track"), "weather": s.info.get("weather"), "track_temp": s.info.get("track_temp"),
           "setup": s.setups[-1][1] if s.setups else None,
           "laps": [[n, l["time_ms"], not l["invalid"]] for n, l in laps], "clean": [n for n, l in clean]}
    if not clean:
        return out
    per_lap = [A.lap_metrics(l["samples"]) for n, l in clean]
    m = {k: round(st.mean(x[k] for x in per_lap if x[k] is not None), 2)
         for k in per_lap[0] if any(x[k] is not None for x in per_lap)}
    samples = [x for n, l in clean for x in l["samples"]]
    for w in gmtel.WHEELS:
        m["inner_" + w] = round(st.mean(x["tyre_inner_" + w] for x in samples), 1)
    braking = [x for x in samples if x["brake"] > 0.3]
    if braking:
        rear_first = sum(1 for x in braking
                         if min(x["slip_ratio_rl"], x["slip_ratio_rr"]) < -0.1
                         and min(x["slip_ratio_rl"], x["slip_ratio_rr"]) < min(x["slip_ratio_fl"], x["slip_ratio_fr"]))
        m["rear_lock_first"] = round(100 * rear_first / len(braking), 1)
    else:
        m["rear_lock_first"] = 0
    times = [l["time_ms"] for n, l in clean]
    out.update(m=m, best=min(times), mean=round(st.mean(times)), spread=max(times) - min(times))
    return out


def advise(r):
    """(recommended values with reasons, findings) for one measured session."""
    s, m, wet = r["setup"], r.get("m"), (r["weather"] or 0) >= 3
    rec, why = {}, {}

    def setv(k, v, reason):
        lo, hi = LIMITS.get(k, (-1e9, 1e9))
        v = max(lo, min(hi, v))
        v = round(v * 2) / 2 if "psi" in k else int(round(v))
        if v != s[k]:
            rec[k] = (v, reason)
        else:
            why[k] = reason

    if not m:
        return rec, why, []
    bm, be = m["balance_mid"], m["balance_entry"]
    over, spin, locks = m["oversteer_moments"], m["wheelspin_events"], m["lockups"]
    bot_r, bot_f = m["bottoming_rear_pct"], m["bottoming_front_pct"]
    front_t = (m["tyre_surface_fl"] + m["tyre_surface_fr"]) / 2
    rear_t = (m["tyre_surface_rl"] + m["tyre_surface_rr"]) / 2
    rear_inner = max(m["inner_rl"], m["inner_rr"])
    rlf = m["rear_lock_first"]

    level = "strong" if bm > 3.2 else "mild" if bm > 1.8 else "almost no"
    findings = [f"Mid-corner: {level} understeer ({bm:.1f}°)."]
    if over >= 4:
        findings.append(f"Unsettled rear: {over:.0f} oversteer moments per lap.")
    if spin >= 3:
        findings.append(f"Rear wheelspin {spin:.0f} times per lap.")
    if bot_r >= 5:
        findings.append(f"The rear floor hits the ground for {bot_r:.0f}% of the lap.")
    if bot_f >= 1.5:
        findings.append(f"The front hits the ground under hard braking ({bot_f:.1f}% of the lap).")
    if rlf >= 3:
        findings.append(f"Under braking the rear wheels lock before the fronts ({rlf:.0f}% of braking).")
    if not wet and front_t < rear_t - 8:
        findings.append(f"Front tyres run cooler than the rears ({front_t:.0f} vs {rear_t:.0f} °C).")
    if not wet and rear_inner > 101:
        findings.append(f"The rear tyres get hot (core {rear_inner:.0f} °C).")

    if over >= 4 or spin >= 3:
        setv("rear_wing", s["rear_wing"] + (2 if s["rear_wing"] <= 10 else 3),
             "More rear grip against oversteer and wheelspin. Costs a little top speed.")
    if bm > 3.2:
        if s["front_wing"] < 50:
            setv("front_wing", s["front_wing"] + 3, "More front grip against the mid-corner understeer.")
        else:
            setv("rear_arb", s["rear_arb"] + 2,
                 "The front wing is already at 50, so a slightly stiffer rear anti-roll bar helps the car rotate.")
    if spin >= 8:
        setv("diff_on_throttle", 70, "Lots of wheelspin: a more open diff lets the rear wheels take the power.")
    elif spin >= 3:
        drop = 20 if s["diff_on_throttle"] >= 90 else 10
        setv("diff_on_throttle", s["diff_on_throttle"] - drop,
             "Less wheelspin out of slow corners and less rear tyre wear.")
    if over >= 4 and be < 1.0:
        setv("diff_off_throttle", s["diff_off_throttle"] + 10, "A calmer rear on turn-in and under braking.")
    elif be > 1.4 and over < 2:
        setv("diff_off_throttle", s["diff_off_throttle"] - 5,
             "The car is reluctant to turn in; a slightly more open diff helps the nose into the corner.")
    if bot_r >= 5:
        if s["rear_suspension"] < 25:
            setv("rear_suspension", 30, "The soft rear lets the floor scrape. 30 keeps it off the ground and makes laps more consistent.")
        else:
            setv("rear_ride_height", s["rear_ride_height"] + 1, "The rear floor still scrapes; a little higher.")
    if bot_f >= 1.5:
        setv("front_ride_height", s["front_ride_height"] + 1, "The front hits the ground under hard braking.")
    if rlf >= 8:
        setv("brake_bias", s["brake_bias"] + 2, "The rear wheels lock first. More bias to the front makes braking predictable.")
    elif rlf >= 3:
        setv("brake_bias", s["brake_bias"] + 1, "The rear wheels sometimes lock first. A little more bias to the front.")
    if locks >= 1.5 and rlf < 3:
        setv("brake_pressure", s["brake_pressure"] - 5,
             "Frequent lock-ups without ABS. A little less pressure gives more feel in the pedal.")
    if not wet:
        if front_t < rear_t - 8 and s["fl_psi"] > 24:
            for k in ("fl_psi", "fr_psi"):
                setv(k, s[k] - 1.5, "The front tyres stay cool; lower pressure gives more contact and front grip.")
        if rear_inner > 101 and s["rl_psi"] > 21:
            for k in ("rl_psi", "rr_psi"):
                setv(k, s[k] - 0.5, "The rear tyres get hot; slightly lower pressure keeps them cooler.")
    return rec, why, findings


def kind_entry(r, date, source):
    rec, why, findings = advise(r)
    settings = []
    for k, v in r["setup"].items():
        nv, reason = rec.get(k, (v, None))
        settings.append({"key": k, "now": v, "rec": nv, "changed": nv != v,
                         "why": reason or why.get(k) or KEEP.get(k) or NO_ISSUE})
    return {"source": source, "date": date, "weather": r["weather"], "trackTemp": r["track_temp"],
            "laps": r["laps"], "clean": r["clean"], "best": r.get("best"), "mean": r.get("mean"),
            "spread": r.get("spread"), "findings": findings, "notes": [], "settings": settings}


def main():
    cache, out_path = sys.argv[1], sys.argv[2]
    os.makedirs(cache, exist_ok=True)
    metrics_file = os.path.join(cache, f"metrics-v{METRICS_VERSION}.json")
    metrics = json.load(open(metrics_file)) if os.path.exists(metrics_file) else {}
    names = sorted(a["name"] for a in http_json(RELEASE)["assets"])
    sessions = [n for n in names if n.endswith(("_Race.gmtel.gz", "_s15.gmtel.gz", "_OSQ.gmtel.gz"))]
    for name in sessions:
        if name not in metrics:
            print("measuring", name, flush=True)
            try:
                metrics[name] = measure(download(name, cache), "_OSQ" in name)
            except Exception as ex:  # one broken file shouldn't stop the rest
                print("  skipped:", ex, flush=True)
                metrics[name] = None
            json.dump(metrics, open(metrics_file, "w"))

    tracks = {}
    for name in sessions:  # oldest first, so the newest session of a kind wins
        r = metrics.get(name)
        if not r or not r.get("setup") or not r.get("track"):
            continue
        quali = "_OSQ" in name
        kind = "wet" if (r["weather"] or 0) >= 3 else "quali" if quali else "race"
        t = tracks.setdefault(r["track"], {"track": r["track"], "kinds": {}})
        t["kinds"][kind] = kind_entry(r, name[:10], "quali" if quali else "race")

    for track, t in tracks.items():
        k = t["kinds"]
        tested = TESTED.get(track)
        if tested and "race" in k:
            for kind in ("race", "quali"):
                for s in k.get(kind, {}).get("settings", []):
                    if s["key"] in tested["values"]:
                        s["rec"], s["why"] = tested["values"][s["key"]]
                        s["changed"] = s["rec"] != s["now"]
            k["race"]["tested"] = tested["note"]
        if "quali" not in k and "race" in k:
            q = copy.deepcopy(k["race"])
            q.update(derived=True, laps=[], clean=[], best=None, mean=None, spread=None, findings=[])
            q.pop("tested", None)
            for s in q["settings"]:
                if s["key"] == "fuel_load" and s["now"] != 5:
                    s.update(rec=5.0, changed=True, why="Qualifying needs one fast lap: less fuel is quicker.")
            k["quali"] = q
        for kind, e in k.items():
            if e.get("derived"):
                e["notes"].append("No qualifying recorded on this track yet, so this is the race advice with qualifying fuel.")
            elif not e["clean"]:
                e["notes"].append("The recording stopped too early: no laps to judge.")
            elif kind == "quali" or e["source"] == "quali":
                e["notes"].append("Based on a single qualifying lap, so less certain than race advice.")
            elif len(e["clean"]) == 1:
                e["notes"].append("Only 1 clean lap in this race, so treat this advice with care.")
            if kind == "wet":
                e["notes"].append(f"From your {'qualifying' if e['source'] == 'quali' else 'race'} in the rain.")

    out = {"generated": sessions[-1][:10] if sessions else None, "tracks": list(tracks.values())}
    with open(out_path, "w") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"setup advice for {len(tracks)} tracks -> {out_path}")


if __name__ == "__main__":
    main()
