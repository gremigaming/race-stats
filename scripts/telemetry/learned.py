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
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
    print("learned:", len(out_lessons), "lessons,", data["changes"]["total"], "calls changed by grades")


if __name__ == "__main__":
    main()
