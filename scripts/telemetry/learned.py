#!/usr/bin/env python3
"""What the fault engine learned from grading, for the staff page (GreMi, 5 Nov 2026).

Writes public/league/learned.json with:
  - rulebook: every change to the rulebook and to how grades are used, with the grades behind it
  - accuracy: the leave-one-out check after every precedents build (grading/precedents.json
    eval_history): how many graded incidents the engine gets right without having seen them
  - lessons: the graded contacts where the final call differs from the rulebook's, grouped by
    situation, in plain words ("one car behind, nobody slid: the rulebook blamed the car behind,
    the graded call is not an incident"), with examples
  - changes: what the grades change in the calls of every judged race right now (CACHE/verdicts
    after precedents.py apply): incidents that follow a grade or a similar graded incident
  - graded: how many grades of which kind (GreMi, staff, protests, staff changes) and their types
Notes from grades stay out: this file is published with the site.

    python3 scripts/telemetry/learned.py /tmp/telemetry-cache
"""
import collections
import datetime
import glob
import json
import os
import re
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
STORE = os.path.join(ROOT, "grading", "precedents.json")
OUT = os.path.join(ROOT, "public", "league", "learned.json")
LABELS = {"front": "the car ahead at fault", "back": "the car behind at fault", "both": "both at fault",
          "none": "a racing incident", "no": "not an incident"}
WHO = {"front": "the car ahead", "back": "the car behind", "both": "both cars", "none": "nobody", "no": "nobody"}

RULEBOOK = [
    {"date": "2026-10-30", "version": "v0", "from": "batch 1 (20 incidents graded by GreMi)",
     "changes": ["The game's own penalty calls are no longer used",
                 "A tap without consequence is not an incident",
                 "Side by side: the car that keeps moving over is at fault, even when it is behind",
                 "Running into the back under braking: the car behind is at fault",
                 "A chain started by a small error is a racing incident; otherwise the car that started it",
                 "An unsafe rejoin is the rejoining car's fault",
                 "Contacts with AI cars don't count"]},
    {"date": "2026-10-31", "version": "v1", "from": "batch 2",
     "changes": ["A squeeze of less than 3 m that did no harm is not an incident",
                 "No time to react: when the car ahead slid or went off less than 1 s before, the car behind is not to blame",
                 "A contact less than 2 s after an earlier one is aftermath: nobody is blamed for it",
                 "Shared fault: both cars moved across into each other",
                 "Hitting the same car again within 10 s after being apart: deliberate, severity 10"]},
    {"date": "2026-11-01", "version": "v1.1", "from": "GreMi",
     "changes": ["Severity is the harm done to the other car only: your own spin doesn't make your penalty bigger"]},
    {"date": "2026-11-03", "version": "v1.2", "from": "GreMi's grades of 2 Nov and batch 4",
     "changes": ["One car behind the other and nobody slid or lost a place: never an incident, even with wheels off"]},
    {"date": "2026-11-03", "version": "precedents", "from": "0 of 5 right on the 2 Nov stream picks",
     "changes": ["Every graded incident gets its own grade, also on the site",
                 "A new contact that looks like graded ones (7 closest, 75% agree) follows their call",
                 "Graded incidents can be split into parts, with a call and severity per driver; shared blame = half points",
                 "Staff point changes ('engine got it wrong') and accepted protests teach the engine too"]},
    {"date": "2026-11-05", "version": "v1.3", "from": "GreMi",
     "changes": ["Wet track (light rain or worse): the car behind gets 1.5 s to react instead of 1 s",
                 "Wet track: the car behind must close in at 10 km/h or more to be blamed for a rear-end (dry: 7 km/h)",
                 "Wet track: a car behind that lost it just before the contact, closing slowly, is a racing incident",
                 "Rejected protests teach the engine too: its call was right",
                 "Incident types and the weather are kept with every call"]},
    {"date": "2026-11-06", "version": "v1.4", "from": "GreMi: look at the inputs (daris_2190 into DDRK, Singapore 4 Nov)",
     "changes": ["Inputs count: a car behind that keeps full throttle for 0.8 s or more after hitting a car that is braking, "
                 "still touching it, pushed it on purpose: at fault, severity 10 (not when side by side)"]},
]


def situation(x):
    """Plain words for the numbers of one graded contact."""
    if x.get("rejoin_front") or x.get("rejoin_back"):
        where = "a car rejoining the track"
    elif x.get("aftermath"):
        where = "a contact right after an earlier one"
    elif x.get("reaction"):
        where = "the car ahead slid just before"
    elif x.get("gap", 99) < 4:
        where = "side by side"
    else:
        where = "one car behind the other"
    harm = "with harm (a slide or a place lost)" if (x.get("slide", 0) > 20 or x.get("lost", 0) > 0) else "nobody slid or lost a place"
    return where, harm


def lessons(store):
    groups = collections.defaultdict(list)
    agree = 0
    for pid, p in store.get("precedents", {}).items():
        for c in p.get("contacts") or []:
            if c["label"] == c["rulebook"] or {c["label"], c["rulebook"]} <= {"no", "none"}:
                agree += 1
                continue
            where, harm = situation(c["x"])
            groups[(where, harm, c["rulebook"], c["label"])].append((pid, p, c))
    out = []
    for (where, harm, rb, lab), xs in sorted(groups.items(), key=lambda kv: -len(kv[1])):
        closing = statistics.median(c["x"].get("closing", 0) for _, _, c in xs)
        mf = statistics.median(c["x"].get("moved_front", 0) for _, _, c in xs)
        mb = statistics.median(c["x"].get("moved_back", 0) for _, _, c in xs)
        mv = lambda m: f"{m:.1f} m towards the other car" if m >= 0.05 else f"{-m:.1f} m away" if m <= -0.05 else "straight on"  # noqa: E731
        detail = (f"closing at about {closing:.0f} km/h" if where == "one car behind the other"
                  else f"the car ahead moved {mv(mf)}, the car behind {mv(mb)}" if where == "side by side" else "")
        out.append({"situation": f"{where}, {harm}" + (f" ({detail})" if detail else ""),
                    "rulebook": LABELS[rb], "graded": LABELS[lab], "count": len(xs),
                    "text": f"{where[0].upper() + where[1:]}, {harm}{' (' + detail + ')' if detail else ''}: "
                            f"the rulebook said {LABELS[rb]}, the grades say {LABELS[lab]} ({len(xs)}x). "
                            f"Similar contacts now lean towards blaming {WHO[lab]}.",
                    "by": dict(collections.Counter(p.get("by", "GreMi") for _, p, _ in xs)),
                    "examples": [{"id": pid, "track": p.get("track"), "date": p.get("date"), "kind": p.get("kind"),
                                  "source": p.get("source") or "grade"} for pid, p, _ in xs[:6]]})
    return out, agree


def changes(cache):
    """What the grades change in the current calls (verdict files after precedents.py apply)."""
    rows, n = [], collections.Counter()
    for path in sorted(glob.glob(os.path.join(cache, "verdicts", "Race_*.json"))):
        try:
            data = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError):
            continue
        file = os.path.basename(path)
        track = re.sub(r"^Race_|_\d{4}_.*$", "", file).replace("_", " ")
        date = "-".join(re.search(r"(\d{4})_(\d\d)_(\d\d)", file).groups())
        for inc in data.get("incidents") or []:
            pr, rb = inc.get("precedent") or {}, inc.get("rulebook") or {}
            if inc.get("rule") not in ("G", "P") and not (pr.get("own") or (inc.get("rule") == "R1" and pr)):
                continue
            before, after = sorted(rb.get("at_fault") or []), sorted(inc.get("at_fault") or [])
            if before == after and rb.get("verdict") == inc.get("verdict"):
                n["confirmed"] += 1
                continue
            what = ("cleared" if before and not after else "blamed" if after and not before else "moved")
            n[what] += 1
            rows.append({"track": track, "date": date, "lap": inc.get("lap"), "what": what,
                         "graded_itself": bool(pr.get("own")), "follows": pr.get("id"),
                         "before": rb.get("verdict"), "after": inc.get("verdict")})
    rows.sort(key=lambda r: (r["date"], r["track"]), reverse=True)
    return {"counts": dict(n), "total": sum(v for k, v in n.items() if k != "confirmed"), "recent": rows[:25]}


# ---------------------------------------------------------------- the lesson log (GreMi, 6 Nov 2026)

SITE = "https://gremigaming.github.io/race-stats/f1/"
SEED_DAYS = {"b1": "2026-10-30", "b2": "2026-10-31", "b3": "2026-11-01"}   # batches 1-3: graded in the old artifact, day only
SAME = {"no": "nobody", "none": "nobody"}
CONFLICT_D = 2.0     # graded contacts this similar (scaled distance; precedents follow up to 2.5) ...
CONFLICTS = 12       # ... with a different call: show the closest this many pairs


def _short(name):
    return re.sub(r"^#\d+\s+", "", name or "")


def _front_back(main, sk):
    """(front car, back car) of a contact from its sketch (the cars drive up the picture), or None."""
    if not sk:
        return None
    at = {c["car"]: c["at"] for c in sk.get("cars") or []}
    a, b = main["a"], main["b"]
    if a not in at or b not in at:
        return None
    return (a, b) if at[a][1] < at[b][1] else (b, a)


def why_text(p, sk, name):
    """Why the call on a graded contact is what it is, in plain words from its numbers."""
    cs = p.get("contacts") or []
    if not cs:
        return ""
    main = next((c for c in cs if c.get("label") != "no"), cs[0])
    x, lab = main["x"], main["label"]
    fb = ((main["front"], main["b"] if main["front"] == main["a"] else main["a"]) if main.get("front") is not None
          else _front_back(main, sk))
    front, back = (name(fb[0]), name(fb[1])) if fb else ("the car ahead", "the car behind")
    ins = {c["car"]: c for c in (sk or {}).get("cars") or []}
    side = x["gap"] < 4
    if lab == "back":
        out = f"{back} was {x['gap']:.0f} m behind, closing in at {x['closing']:.0f} km/h, and ran into {front}"
        if fb and ins.get(fb[0], {}).get("brake", 0) >= 0.2:
            out += f" while {front} was braking"
        if fb and ins.get(fb[1], {}).get("throttle", 0) >= 0.9 and ins.get(fb[1], {}).get("brake", 0) < 0.05:
            out += f" ({back} still on full throttle)"
        out += ": the car behind is at fault."
    elif lab == "front":
        if x.get("rejoin_front"):
            out = f"{front} came back onto the track into {back}: an unsafe rejoin is the rejoining car's fault."
        elif side:
            out = (f"Side by side, {front} moved {x['moved_front']:.1f} m across into {back} "
                   f"({back} moved {x['moved_back']:.1f} m): the car that keeps moving across is at fault.")
        else:
            out = f"{front} was ahead but moved {x['moved_front']:.1f} m across into {back}: the car ahead is at fault."
    elif lab == "both":
        out = (f"Both moved across into each other ({x['moved_front']:.1f} m and {x['moved_back']:.1f} m): shared blame.")
    elif lab == "none":
        out = ("Neither driver clearly caused it" + (f" (side by side, {x['moved_front']:.1f} m / {x['moved_back']:.1f} m)" if side
               else f" ({x['gap']:.0f} m apart, closing at {x['closing']:.0f} km/h)") + ": a racing incident.")
    else:
        harm = []
        if x["slide"] <= 20:
            harm.append("nobody slid")
        if not x["lost"]:
            harm.append("nobody lost a place")
        out = "A light contact" + (f": {', '.join(harm)}" if harm else "") + ": not an incident."
    if x.get("reaction"):
        out += " The car ahead slid or went off just before: no time to react."
    if x.get("aftermath"):
        out += " It came right after an earlier contact: aftermath."
    return out


def _incident_link(file, lap, names):
    if not file:
        return None
    return (f"{SITE}incidents?file={file}" + (f"&lap={lap}" if lap else "")
            + "&with=" + "|".join(_short(n) for n in names if n))


def _verdict_files(cache):
    out = []
    for path in sorted(glob.glob(os.path.join(cache, "verdicts", "Race_*.json"))):
        try:
            out.append((os.path.basename(path), json.load(open(path, encoding="utf-8"))))
        except (OSError, ValueError):
            continue
    return out


def _where(vfiles, rec, t):
    """(race file, lap) of the incident at recording time t."""
    for file, data in vfiles:
        if data.get("recording") != rec:
            continue
        off = data.get("offset") or 0
        best = min(data.get("incidents") or [], key=lambda i: abs(i["t0"] - off - t), default=None)
        if best is not None and abs(best["t0"] - off - t) < 8:
            return file, best.get("lap")
        return file, None
    return None, None


def followers(vfiles):
    """{precedent id: [incident calls changed because they look like it]} (after precedents.py apply)."""
    out = collections.defaultdict(list)
    for file, data in vfiles:
        track = re.sub(r"^Race_|_\d{4}_.*$", "", file).replace("_", " ")
        date = "-".join(re.search(r"(\d{4})_(\d\d)_(\d\d)", file).groups())
        names = {}
        for inc in data.get("incidents") or []:
            pr, rb = inc.get("precedent") or {}, inc.get("rulebook") or {}
            if not pr.get("id") or pr.get("own"):
                continue
            before, after = sorted(rb.get("at_fault") or []), sorted(inc.get("at_fault") or [])
            if before == after and rb.get("verdict") == inc.get("verdict"):
                continue
            who = [d.get("name") for d in inc.get("drivers") or [] if d.get("name")] or names.get(file, [])
            out[pr["id"]].append({"track": track, "date": date, "lap": inc.get("lap"), "file": file,
                                  "what": "cleared" if before and not after else "blamed" if after and not before else "moved",
                                  "before": rb.get("verdict"), "after": inc.get("verdict"), "d": pr.get("d"),
                                  "watch": _incident_link(file, inc.get("lap"), who)})
    return out


def lesson_log(store, cache, sketches=None):
    """One entry per lesson, newest first: when, who, which incident, the call, why, a sketch and
    the calls it changed. Lessons the rulebook now makes by itself, or a later grade replaced, are
    marked outdated (the staff page folds them away); lessons that agreed with the rulebook are
    "confirmed" (they keep it honest: a rule change that breaks them shows in the accuracy)."""
    import precedents as P
    try:
        decs = P.load_decisions()
    except Exception:
        decs = {}
    try:
        decs.update({k: v for k, v in P.load_lessons(cache).items() if k not in decs})
    except Exception as ex:
        print("learned: staff lessons not read:", ex)
    vfiles = _verdict_files(cache)
    follow = followers(vfiles)
    ps = store.get("precedents") or {}
    sketches = sketches or {}
    graded = {(p.get("recording"), round(p.get("t") or 0)) for pid, p in ps.items() if not pid.startswith("s-")}
    out = []
    for pid, p in ps.items():
        parent = p.get("parent") or pid
        d = decs.get(parent) or {}
        names = {x["car"]: x["name"] for x in d.get("drivers") or []}
        name = lambda i: _short(names.get(i) or f"car {i}")  # noqa: E731
        sk = sketches.get(pid)
        cs = p.get("contacts") or []
        differs = any(c["label"] != c["rulebook"] and {c["label"], c["rulebook"]} - {"no", "none"} for c in cs)
        changed = follow.get(pid, [])
        at = p.get("at") or P.meta(d).get("at")
        file = p.get("race_file") or d.get("race_file")
        f2, lap = _where(vfiles, p.get("recording"), p.get("t") or 0)
        file = file or f2
        state, why_old = "active", None
        if pid.startswith("s-") and (p.get("recording"), round(p.get("t") or 0)) in graded:
            state, why_old = "outdated", "graded later: the grade wins"
        elif pid.endswith("-touches"):
            state, why_old = "outdated", "innocent touches around a graded incident"
        elif not differs and not changed:
            state, why_old = "confirmed", "the rulebook already made this call: kept as a check"
        fault = set(d.get("at_fault") or [])
        cars = [{"car": c, "name": name(c), "fault": names.get(c) in fault} for c in p.get("cars") or []]
        for part in d.get("parts") or []:
            if p.get("part") and part is (d.get("parts") or [])[p["part"] - 1]:
                calls = {x["car"]: x.get("call") for x in part.get("drivers") or []}
                for c in cars:
                    c["call"] = calls.get(c["car"])
                    c["fault"] = calls.get(c["car"]) in ("fault", "shared")
        out.append({"id": pid, "parent": parent, "at": at, "day": p.get("date") if at else SEED_DAYS.get(pid[:2]),
                    "by": p.get("by", "GreMi"), "who": p.get("who") or [], "source": p.get("source") or "grade",
                    "changes": p.get("changes") or [], "track": p.get("track"), "date": p.get("date"), "lap": lap, "file": file,
                    "part": p.get("part"), "of": p.get("of"), "kind": p.get("kind"), "call": p.get("verdict"),
                    "severity": p.get("severity"), "rulebook": (p.get("rulebook") or {}).get("verdict"), "differs": differs,
                    "cars": cars, "why": why_text(p, sk, name), "sketch": sk, "changed": changed[:40], "followers": len(changed),
                    "watch": _incident_link(file, lap, [c["name"] for c in cars]), "state": state, "outdated": why_old})
    out.sort(key=lambda e: (e["at"] or e["day"] or "", e["id"]), reverse=True)
    return out


def conflicts(store):
    """Graded contacts that look very much alike but got a different call: either they are less alike
    than the numbers say, or one of the calls is wrong. Closest pairs first, one pair per two incidents."""
    import precedents as P
    pts = []
    for pid, p in (store.get("precedents") or {}).items():
        if pid.endswith("-touches"):
            continue
        for k, c in enumerate(p.get("contacts") or []):
            y, _ = P.canon(c["x"])
            pts.append((pid, p.get("parent") or pid, k, y, SAME.get(c["label"], c["label"]), c))
    pairs = []
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            a, b = pts[i], pts[j]
            if a[1] == b[1] or a[4] == b[4]:
                continue
            dist = P.distance(a[3], b[3])
            if dist < CONFLICT_D:
                pairs.append((dist, a, b))
    pairs.sort(key=lambda x: x[0])
    seen, out = set(), []
    for dist, a, b in pairs:
        key = tuple(sorted((a[1], b[1])))
        if key in seen:
            continue
        seen.add(key)
        diff = sorted(P.FEATURES, key=lambda f: -abs(P.FEATURES[f][1] * (a[3][f] - b[3][f]) / P.FEATURES[f][0]))[:3]
        out.append({"d": round(dist, 2), "key": "|".join(key),
                    "a": {"id": a[0], "label": LABELS[a[5]["label"]], "x": a[3]},
                    "b": {"id": b[0], "label": LABELS[b[5]["label"]], "x": b[3]}, "differ": diff})
        if len(out) >= CONFLICTS:
            break
    return out


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    try:
        store = json.load(open(STORE, encoding="utf-8"))
    except (OSError, ValueError):
        store = {"precedents": {}}
    ps = store.get("precedents", {})
    out_lessons, agree = lessons(store)
    graded = {"incidents": len({p.get("parent") or k for k, p in ps.items()}),
              "by": dict(collections.Counter(p.get("by", "GreMi") for p in ps.values())),
              "source": dict(collections.Counter(p.get("source") or "grade" for p in ps.values())),
              "types": dict(collections.Counter(p["kind"] for p in ps.values() if p.get("kind")).most_common()),
              "contacts_agree": agree, "contacts_differ": sum(x["count"] for x in out_lessons)}
    data = {"made": datetime.date.today().isoformat(), "rulebook": RULEBOOK[::-1],
            "accuracy": store.get("eval_history") or [], "graded": graded, "lessons": out_lessons,
            "changes": changes(cache)}
    try:
        import sketches as S
        sk = S.sketch_all(cache, store)
    except Exception as ex:
        print("learned: no sketches:", ex)
        sk = {}
    try:
        data["log"] = lesson_log(store, cache, sk)
        data["conflicts"] = conflicts(store)
    except Exception as ex:
        print("learned: lesson log failed:", ex)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("learned:", len(out_lessons), "lessons,", data["changes"]["total"], "calls changed by grades,",
          len(data.get("log") or []), "log entries,", len(data.get("conflicts") or []), "similar incidents with different calls")


if __name__ == "__main__":
    main()
