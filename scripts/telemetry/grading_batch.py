#!/usr/bin/env python3
"""Five incidents for the staff to grade after every stream (GreMi, 2 Nov 2026).

From the fault engine's verdicts (fault_engine.py, CACHE/verdicts) it picks, per finished stream:
one clear low-severity incident, one high-severity incident, and the three the engine finds
hardest to call: the numbers its call rests on sit right next to a rule's limit, several cars
or contacts disagree, or the rule itself is a judgement (shared fault, no time to react).
Each pick carries the engine's call and Claude's take on it (what it thinks and why), which only
GreMi sees on the staff page; staff grade blind.

Every incident of severity SEVERE+ (GreMi, 5 Nov 2026: the most important ones to grade) goes into
one more batch, grading/severe.json, that only grows: new ones are added after every build, ones
already in a stream's picks are left out.

Each incident carries the engine's guess of its type (verdicts.kind_of, the staff page fills the
picker with it) and the weather at the incident.

A stream's batch is written once to grading/<stream>.json (committed by site.yml, so later
rulebook changes never reshuffle what staff already graded) and every batch is published as
public/league/grading.json, which the staff page reads.

    python3 scripts/telemetry/grading_batch.py /tmp/telemetry-cache
"""
import datetime
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import verdicts as V  # noqa: E402

SEVERE = 7                   # every incident this severe goes into the severity batch
SEVERE_PATH = os.path.join("grading", "severe.json")
FROM_DAY = "2026_10_31"      # streams before this are in calibration batches 1-4
STREAM_GAP_H = 3             # same as build-league-data.mjs: sessions less than 3 h apart = one stream
SETTLE_H = 4                 # a stream counts as finished this long after its last race file
SESSIONS = os.path.join("public", "league", "sessions")
OUT_DIR = "grading"
PUBLISHED = os.path.join("public", "league", "grading.json")
SITE = "https://gremigaming.github.io/race-stats/all/race/"
RULE_NAMES = {"R1": "no incident (light tap or squeeze)", "R2": "side by side, one car moved over",
              "R3": "the car behind ran into the one ahead", "R4": "chain started by a small error",
              "R5": "unsafe rejoin", "R7": "no time to react", "R8": "shared fault", "R9": "hit the same car again",
              "R10": "kept full throttle into a braking car",
              "G": "graded before", "P": "follows a similar graded incident"}


def stamp(f):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)", f)
    return datetime.datetime(*map(int, m.groups())) if m else None


def streams(files):
    out = []
    for f in sorted(files, key=stamp):
        if out and stamp(f) - stamp(out[-1][-1]) <= datetime.timedelta(hours=STREAM_GAP_H):
            out[-1].append(f)
        else:
            out.append([f])
    return out


def display_names(png):
    names, ai = {}, set()
    for c in png["classification-data"]:
        n = re.sub(r"\s+", " ", c["driver-name"]).strip()
        rn = (c.get("participant-data") or {}).get("race-number")
        m = re.match(r"^(.*'\d\d) #\d+$", n)
        names[c["index"]] = f"Hidden #{rn} ({m.group(1).replace('Mclaren', 'McLaren')})" if m else f"#{rn} {n}"
        if (c.get("participant-data") or {}).get("ai-controlled") and m:
            ai.add(c["index"])   # an AI car keeps its team name; a human who quit keeps theirs
        if c.get("is-player"):
            ai.add(c["index"])   # GreMi hosts and has no safety rating: not graded
    return names, ai


# ---------------------------------------------------------------- how close a call is


def near(x, limit, scale):
    """1 when x sits on the limit, 0 when it is scale or more away."""
    return max(0.0, 1 - abs(x - limit) / scale) if x is not None else 0.0


def close_calls(c, nm):
    """[(closeness 0-1, sentence)] for one contact, from the numbers its rule used."""
    f = c.get("f")
    if not f:
        return []
    a, b = nm(c["a"]), nm(c["b"])
    ma, mb = f["moved"].get(str(c["a"]), 0) or 0, f["moved"].get(str(c["b"]), 0) or 0
    ahead = abs(f["ahead_m"] or 0)
    closing = abs(f["closing_kmh"] or 0)
    harmless = (f.get("slide_deg") or 0) <= V.SLIP_HARM and not f.get("places_lost") and not f.get("off_track")
    out = [(near(ahead, V.ALONGSIDE_M, 1.5),
            f"the cars were {ahead:.1f} m apart along the track, right at the {V.ALONGSIDE_M:g} m line between "
            f"'side by side' (the car moving over is to blame) and 'one behind the other' (the car behind is to blame)")]
    if c["rule"] == "R2" or (c["rule"] == "R8" and ahead < V.ALONGSIDE_M):
        big, small = max(ma, mb), min(ma, mb)
        out.append((near(big - small, V.MOVE_MORE_M, 0.6),
                    f"{a} moved {ma:.1f} m across and {b} {mb:.1f} m: the difference ({big - small:.1f} m) is close to the "
                    f"{V.MOVE_MORE_M:g} m that decides who moved into whom"))
        out.append((near(small, V.SHARED_M, 0.8) * (big >= V.SHARED_M - 0.8),
                    f"both cars moved across ({ma:.1f} m / {mb:.1f} m), close to the {V.SHARED_M:g} m each that makes it shared fault"))
        if harmless:
            out.append((near(big, V.TAP_MOVE_M, 1.0),
                        f"nobody slid or lost a place, and the move ({big:.1f} m) is close to the {V.TAP_MOVE_M:g} m below which "
                        f"I call it a harmless squeeze, not an incident"))
    if c["rule"] in ("R3", "R1", "R4"):
        out.append((near(closing, V.CLOSING_KMH, 5),
                    f"the car behind was closing at only {closing:.0f} km/h, near the {V.CLOSING_KMH} km/h where I stop "
                    f"calling it 'ran into the back'"))
        if harmless:
            out.append((near(closing, V.TAP_KMH, 8),
                        f"nobody slid or lost a place and the closing speed ({closing:.0f} km/h) is near the {V.TAP_KMH} km/h "
                        f"line between a harmless tap and an incident"))
    if c["rule"] == "R5":
        rj = f["rejoin"][0] if f["rejoin"] else None
        mv = f["moved"].get(str(rj), 0) if rj is not None else 0
        out.append((near(mv, V.MOVE_M, 0.8),
                    f"the rejoining car moved {mv:.1f} m across, close to the {V.MOVE_M:g} m that makes it an unsafe rejoin"))
    if f.get("slide_deg") is not None:
        out.append((near(f["slide_deg"], V.SLIP_HARM, 10) * 0.8,
                    f"the worst slide was {f['slide_deg']}°, near the {V.SLIP_HARM}° where I count it as harm done"))
    return out


def gray(inc, nm):
    """(score, [reasons]) for an incident: higher = harder to call."""
    counted = [c for c in inc["contacts"] if c["rule"] != "R6"]
    calls = sorted((x for c in counted for x in close_calls(c, nm)), key=lambda x: -x[0])
    score = calls[0][0] if calls else 0
    why, kinds = [], set()
    for v, s in calls:   # the two closest calls, one of each kind
        if v >= 0.35 and len(why) < 2 and s[:14] not in kinds:
            why.append(s)
            kinds.add(s[:14])
    if inc["rule"] == "R8":
        score += 0.35
        why.insert(0, "more than one car gets the blame, and splitting it is a judgement call")
    if inc["rule"] in ("R7", "R4"):
        score += 0.3
        why.insert(0, "my rules say nobody is to blame because of what happened just before, which is easy to see differently on video")
    blamed = {tuple(c.get("at_fault") or []) for c in counted}
    if len(blamed) > 1 and len(counted) > 1:
        score += 0.25
        why.append(f"its {len(counted)} contacts don't point the same way ({'; '.join(hidden(c['verdict']) for c in counted[:3])})")
    if len(inc["cars"]) >= 3:
        score += 0.15
        why.append(f"{len(inc['cars'])} cars are involved, so the first move is hard to pick out")
    if any(not c.get("f") for c in counted):
        score -= 0.5   # no numbers to show: not a good gray-area pick
    return score, why or ["the numbers are clear of every limit; this one is here for its severity"]


def hidden(text):
    """The engine writes hidden cars as "Audi '26 #99"; the staff page calls them "Hidden #99 (Audi '26)"."""
    return re.sub(r"((?:[A-Z][\w]*\s)+'\d\d) #(\d+)", lambda m: f"Hidden #{m.group(2)} ({m.group(1).replace('Mclaren', 'McLaren')})", text)


def take(inc, nm, kind, reasons):
    """Claude's take, in plain words: what the engine calls and why, and why it might be wrong."""
    rule = RULE_NAMES.get(inc["rule"], inc["rule"])
    blame = ", ".join(nm(x) for x in inc["at_fault"]) or "nobody"
    head = {"low": "Picked as the low-severity case.", "high": "Picked as the high-severity case.",
            "gray": "Picked because it's a gray area for me.",
            "severe": f"In the list because it's severity {SEVERE}+."}[kind]
    text = (f"{head} My call: {hidden(inc['verdict']).replace('Not an incident', 'not an incident')} "
            f"(rule {inc['rule']}: {rule}), severity {inc['severity']}, blame on {blame}. "
            f"What I saw: {hidden(inc['why'])}.")
    if kind == "gray":
        text += " Why I'm not sure: " + "; ".join(reasons[:3]) + "."
    else:
        text += " I'm fairly confident: " + reasons[0] + "."
    return text


# ---------------------------------------------------------------- one stream


def candidates(files, cache):
    out = []
    for file in files:
        vf = os.path.join(cache, "verdicts", file)
        if not os.path.exists(vf):
            continue
        d = json.load(open(vf))
        png = json.load(open(os.path.join(SESSIONS, file)))
        names, skip = display_names(png)
        nm = lambda i, names=names: names.get(i, f"car {i}")  # noqa: E731
        track = re.sub(r"^Race_|_(Just_in_case|Manual)$", "", re.sub(r"_\d{4}_\d\d_\d\d_.*$", "", file)).replace("_", " ")
        for inc in d["incidents"]:
            rt = inc["t0"] - d["offset"]
            if len(inc["cars"]) < 2 or set(inc["cars"]) & skip or rt < 5:
                continue
            if all(c["rule"] == "R6" for c in inc["contacts"]):
                continue
            score, reasons = gray(inc, nm)
            out.append({"inc": inc, "nm": nm, "file": file, "rec": d["recording"], "rt": rt, "track": track,
                        "score": score, "reasons": reasons, "weather": inc.get("weather"), "track_temp": d.get("track_temp")})
    return out


def pick(cands):
    """1 low severity, 1 high severity, 3 gray areas, never twice the same incident."""
    real = [c for c in cands if c["inc"]["rule"] != "R1"]
    chosen = []
    if real:
        hi = max(real, key=lambda c: (c["inc"]["severity"], -c["score"]))
        chosen.append(("high", hi))
    low = [c for c in real if c["inc"]["at_fault"] and c not in [x for _, x in chosen]]
    if low:
        chosen.append(("low", min(low, key=lambda c: (c["inc"]["severity"], c["score"]))))
    rest = sorted((c for c in cands if c not in [x for _, x in chosen]), key=lambda c: -c["score"])
    tracks, rules = {}, set()
    for strict in (True, False):   # first one per rule (a mix of kinds of doubt), then the best of the rest
        for c in rest:
            if sum(1 for k, _ in chosen if k == "gray") >= 3:
                break
            if c in [x for _, x in chosen] or tracks.get(c["file"], 0) >= 2:   # spread over the stream's races
                continue
            if strict and c["inc"]["rule"] in rules:
                continue
            tracks[c["file"]] = tracks.get(c["file"], 0) + 1
            rules.add(c["inc"]["rule"])
            chosen.append(("gray", c))
    order = {"low": 0, "high": 1, "gray": 2}
    return sorted(chosen, key=lambda kc: (order[kc[0]], -kc[1]["score"]))


def entry(iid, kind, c):
    """One incident for the staff page."""
    inc, nm, rt = c["inc"], c["nm"], c["rt"]
    day = stamp(c["file"])
    w = c.get("weather")
    return {"id": iid, "pick": kind, "track": c["track"], "date": day.strftime("%Y-%m-%d"),
            "type": V.kind_of(inc), **({"weather": V.weather_name(w)} if w is not None else {}),
            **({"track_temp": c["track_temp"]} if c.get("track_temp") is not None else {}),
            "lap": inc["lap"], "race_time": f"{int(rt // 60)}:{int(rt % 60):02d}",
            "replay": f"{SITE}{c['rec'].replace('.gmtel.gz', '')}?inc={rt:.1f}&car=" + ",".join(map(str, inc["cars"])),
            "race_file": c["file"], "recording": c["rec"],
            "t0": round(rt, 1), "t1": round(rt + inc["t1"] - inc["t0"], 1),   # replay clock: the staff page's split windows
            "contacts": [{"t": round(rt + x["t"] - inc["t0"], 1), "a": x["a"], "b": x["b"]} for x in inc["contacts"] if x["rule"] != "R6"],
            "drivers": [{"car": x, "name": nm(x)} for x in inc["cars"]],
            "engine": {"rules": V.RULES, "verdict": inc["verdict"], "rule": inc["rule"], "severity": inc["severity"],
                       "why": inc["why"], "at_fault": [nm(x) for x in inc["at_fault"]], "contacts": len(inc["contacts"]),
                       "gray_score": round(c["score"], 2)},
            "claude": take(inc, nm, kind, c["reasons"])}


def batch(key, files, cache):
    chosen = pick(candidates(files, cache))
    if not chosen:
        return None
    day = stamp(files[0])
    incidents = [entry(f"{key}-{n}", kind, c) for n, (kind, c) in enumerate(chosen, 1)]
    return {"title": f"Stream {day.strftime('%-d %b')} · 5 picks", "stream": key, "made": datetime.date.today().isoformat(),
            "rules": V.RULES, "incidents": incidents}


def severe_batch(races, cache, streams_):
    """Every incident of severity SEVERE+ that is not in a stream's picks (grading/severe.json, only grows)."""
    try:
        b = json.load(open(SEVERE_PATH, encoding="utf-8"))
    except (OSError, ValueError):
        b = {"title": f"Severity {SEVERE}+ · every one", "stream": "severe", "rules": V.RULES, "incidents": []}
    have = {(i["recording"], round(i["t0"])) for i in b["incidents"]}
    for s in streams_:   # older picks have no t0: their replay link has the time
        for i in s["incidents"]:
            m = re.search(r"inc=([\d.]+)", i.get("replay") or "")
            t = i.get("t0") if i.get("t0") is not None else float(m.group(1)) if m else None
            if t is not None and i.get("recording"):
                have.add((i["recording"], round(t)))
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    done_files = set()
    for files in streams(races):   # only finished streams, like the picks
        if now - stamp(files[-1]) >= datetime.timedelta(hours=SETTLE_H):
            done_files.update(files)
    new = 0
    for c in candidates(sorted(done_files, key=stamp), cache):
        inc = c["inc"]
        if inc["severity"] < SEVERE or inc["rule"] in ("R1", "R6", "G") or not inc.get("at_fault"):
            continue
        if (c["rec"], round(c["rt"])) in have:
            continue
        rec = re.sub(r"_Race\.gmtel\.gz$", "", c["rec"]).replace("-", "").replace("_", "")
        b["incidents"].append(entry(f"sev-{rec[4:12]}-{int(c['rt'] * 10)}", "severe", c))
        have.add((c["rec"], round(c["rt"])))
        new += 1
    if not b["incidents"]:
        return None
    b["incidents"].sort(key=lambda i: (i["date"], i["recording"], i["t0"]), reverse=True)
    b["title"] = f"Severity {SEVERE}+ · every one ({len(b['incidents'])})"
    b["made"] = datetime.date.today().isoformat()
    if new or not os.path.exists(SEVERE_PATH):
        json.dump(b, open(SEVERE_PATH, "w"), indent=1, ensure_ascii=False)
        print("grading:", new, f"new severity {SEVERE}+ incidents")
    return b


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    os.makedirs(OUT_DIR, exist_ok=True)
    races = [os.path.basename(f) for f in glob.glob(os.path.join(SESSIONS, "Race_*.json"))
             if stamp(f) and stamp(f).strftime("%Y_%m_%d") >= FROM_DAY]
    for files in streams(races):
        first = stamp(files[0])
        key = first.strftime("%m%d") + ("a" if first.hour < 17 else "b")
        path = os.path.join(OUT_DIR, f"stream-{first.strftime('%Y-%m-%d')}-{key[-1]}.json")
        if os.path.exists(path):
            continue
        if now - stamp(files[-1]) < datetime.timedelta(hours=SETTLE_H):   # race files are local time: a margin
            print("grading: stream", key, "still going, later")
            continue
        b = batch(key, files, cache)
        if not b:
            print("grading: stream", key, "has no judged incidents")
            continue
        json.dump(b, open(path, "w"), indent=1, ensure_ascii=False)
        print("grading: new batch", path, [i["pick"] for i in b["incidents"]])
    out = [json.load(open(p)) for p in sorted(glob.glob(os.path.join(OUT_DIR, "stream-*.json")), reverse=True)]
    severe = severe_batch(races, cache, out)
    if severe:
        out.insert(0, severe)
    os.makedirs(os.path.dirname(PUBLISHED), exist_ok=True)
    json.dump(out, open(PUBLISHED, "w"), ensure_ascii=False)
    print("grading:", len(out), "stream batches published")


if __name__ == "__main__":
    main()
