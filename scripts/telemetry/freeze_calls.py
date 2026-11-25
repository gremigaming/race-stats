#!/usr/bin/env python3
"""Frozen calls (GreMi, 16 Nov 2026): a race that has been judged keeps its calls.

"From now on you won't change incidents from the past, unless I made a change in the staff page
because of a protest or I found a wrong incident. You should still learn from it and check old
incidents to see if you got it wrong, but don't change them: it confuses the drivers when
incidents get judged differently after some time."

Runs after `precedents.py apply` (site build and the live server's league rebuild):

- A race file older than FREEZE_AFTER_H hours whose calls are not in grading/frozen-calls.json yet
  is frozen as it is judged now (its incidents, their drivers and every call).
- A frozen race gets its frozen incidents back in CACHE/verdicts/<race>.json, whatever a newer
  rulebook or a newer precedent would say now. The one exception: an incident GreMi or the staff
  graded on the staff page (precedents rule G, "own") takes the new grade, and that is frozen too.
  Staff point changes and accepted protests (races/corrections.json) are applied later by
  safety_rating.py, on top of the frozen calls, so they keep working as before.
- What the engine would say now is kept next to them ("fresh_incidents") and every frozen call it
  would now make differently is listed in grading/second-look.json: the engine keeps learning
  from old races and can review them, the drivers see the call they saw before.

    python3 scripts/telemetry/freeze_calls.py CACHE          # freeze + restore (writes the files)
    python3 scripts/telemetry/freeze_calls.py CACHE --read   # restore only (live server: never writes the repo)
"""
import datetime
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
FROZEN = os.path.join(ROOT, "grading", "frozen-calls.json")
REVIEW = os.path.join(ROOT, "grading", "second-look.json")
FREEZE_AFTER_H = 12   # time for the final upload and same-night staff checks before a race is frozen
FREEZE_V = 1          # bump when restore() changes: every verdict file is redone

INC_KEYS = ("t0", "t1", "lap", "kind", "cars", "roles", "rule", "severity", "verdict", "why", "weather",
            "at_fault", "calls", "precedent", "rulebook", "drivers")
CONTACT_KEYS = ("a", "b", "t", "rule", "severity", "verdict", "why", "at_fault", "precedent", "rulebook")


def stamp(file):
    m = re.search(r"_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)\.json$", file)
    return datetime.datetime(*map(int, m.groups())) if m else None


def slim(inc):
    """The call of one incident, without the contact numbers (those stay in the cache for learning)."""
    out = {k: inc[k] for k in INC_KEYS if k in inc}
    out["contacts"] = [{k: c[k] for k in CONTACT_KEYS if k in c} for c in inc.get("contacts") or []]
    return out


def own(inc):
    return bool((inc.get("precedent") or {}).get("own"))


def overlaps(a, b):
    return a["t0"] - 1 <= b["t1"] + 1 and b["t0"] - 1 <= a["t1"] + 1 and set(a.get("cars") or []) & set(b.get("cars") or [])


def blame(inc):
    return sorted(inc.get("at_fault") or []), inc.get("rule") == "R1"


def merge(frozen, fresh):
    """The frozen incidents, with every staff-graded incident of now in place of the frozen ones it covers."""
    graded = [i for i in fresh if own(i)]
    keep = [i for i in frozen if not any(overlaps(i, g) for g in graded)]
    return sorted(keep + [slim(g) for g in graded], key=lambda i: i["t0"])


def main(cache, write=True):
    try:
        store = json.load(open(FROZEN, encoding="utf-8"))
    except (OSError, ValueError):
        store = {}
    store.setdefault("races", {})
    races = store["races"]
    now = datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
    review, frozen_now, kept, changed = [], 0, 0, False
    for path in sorted(glob.glob(os.path.join(cache, "verdicts", "Race_*.json"))):
        file = os.path.basename(path)
        try:
            data = json.load(open(path, encoding="utf-8"))
        except (OSError, ValueError) as ex:
            print(file, ": not read:", ex)
            continue
        # this build's own calls: precedents.py apply starts from the rulebook every time it runs (a new
        # precedents version); when it did not run, the incidents are still the restored frozen ones
        done = data.get("frozen")
        if done and done[1] == data.get("precedents") and "fresh_incidents" in data:
            fresh = data["fresh_incidents"]
        else:
            fresh = data["incidents"]
        entry = races.get(file)
        if entry is None:
            st = stamp(file)
            if not write or st is None or now - st < datetime.timedelta(hours=FREEZE_AFTER_H):
                continue
            entry = races[file] = {"v": 1, "frozen": now.strftime("%Y-%m-%d"), "recording": data.get("recording"),
                                   "incidents": [slim(i) for i in fresh]}
            frozen_now += 1
            changed = True
        else:
            merged = merge(entry["incidents"], fresh)
            if merged != entry["incidents"] and write:   # a new staff grade on an old race: that is the call now
                entry.update(incidents=merged, v=entry.get("v", 1) + 1)
                changed = True
            entry_incs = merged
            for f in entry_incs:
                if own(f):
                    continue
                now_inc = next((x for x in fresh if abs(x["t0"] - f["t0"]) < 1 and set(x.get("cars") or []) & set(f.get("cars") or [])), None)
                if now_inc is not None and blame(now_inc) != blame(f):
                    review.append({"file": file, "t": f["t0"], "lap": f.get("lap"), "cars": f.get("cars"),
                                   "frozen": f.get("verdict"), "frozen_fault": blame(f)[0],
                                   "now": now_inc.get("verdict"), "now_fault": blame(now_inc)[0], "rule_now": now_inc.get("rule")})
        # the entry's freeze day is in the mark: a race frozen again (v1.7 regrade, 25 Nov 2026) keeps "v": 1
        mark = [FREEZE_V, data.get("precedents"), entry.get("v"), entry.get("frozen")]
        if data.get("frozen") == mark:
            kept += 1
            continue
        data["fresh_incidents"] = fresh
        data["incidents"] = json.loads(json.dumps(entry["incidents"]))
        data["frozen"] = mark
        json.dump(data, open(path + ".tmp", "w"), separators=(",", ":"))
        os.replace(path + ".tmp", path)
        kept += 1
    if write and changed:
        with open(FROZEN, "w", encoding="utf-8") as fh:
            fh.write('{"races":{\n' + ",\n".join(json.dumps(k) + ":" + json.dumps(v, separators=(",", ":"), sort_keys=True)
                                                 for k, v in sorted(races.items())) + "\n}}\n")
    if write:
        old = None
        try:
            old = json.load(open(REVIEW, encoding="utf-8"))
        except (OSError, ValueError):
            pass
        if old != review:
            json.dump(review, open(REVIEW, "w", encoding="utf-8"), indent=1)
    print(f"frozen calls: {kept} races keep their calls ({frozen_now} frozen now), "
          f"{len(review)} old calls the engine would now make differently (grading/second-look.json, not changed)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache", write="--read" not in sys.argv)
