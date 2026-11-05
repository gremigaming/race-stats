#!/usr/bin/env python3
"""Precedents: the fault engine looks at what GreMi decided before, not only at the rulebook.

Every incident GreMi (or the staff majority) graded is a precedent: the numbers of each of its
contacts (gap along the track, closing speed, who moved across, rejoining, harm done) and the
final call on it. When the fault engine judges a new contact it looks for the most similar
graded contacts. If they are close enough and agree with each other, their call wins over the
rulebook's, and the verdict says which past incident it followed. An incident that was graded
itself always gets GreMi's own call.

A graded incident can be split into parts (staff page: "split"): each part has its own time
window (replay clock), the drivers in it and a call per driver (at fault / shared / not at fault /
not involved) with its own severity, note and reason tags. `apply` then makes one incident per
part out of the contacts in its window between its drivers, contacts of the graded incident that
fall in no part between involved drivers become "not an incident" (innocent touches), and contacts
with a driver marked "not involved" go back to the rulebook as their own incident. Every part is
its own precedent, so the numbers learn each call separately.

  grading/decisions-seed.json   GreMi's grades of calibration batches 1-3 (grading page artifact)
  grading/decisions.json        final calls from the staff page (written by the staff server)
  grading/precedents.json       the numbers of every graded incident (built here, committed)
  races/corrections.json        staff changes of SR points and accepted protests: each one is a
                                lesson too (an incident the engine judged wrongly), unless "learn"
                                is false (GreMi, 3 Nov 2026: that day's changes were leniency)

    python3 scripts/telemetry/precedents.py build CACHE   # numbers for new grades (needs telemetry)
    python3 scripts/telemetry/precedents.py apply CACHE   # precedents into CACHE/verdicts/*.json
    python3 scripts/telemetry/precedents.py eval          # leave-one-out: rulebook vs precedents

`apply` keeps the rulebook's call of every incident under "rulebook" and starts from it each
time, so it can run after every build without stacking.
"""
import glob
import hashlib
import json
import math
import os
import re
import sys
from concurrent.futures import ProcessPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(os.path.dirname(HERE))
DECISIONS = os.path.join(ROOT, "grading", "decisions.json")
SEED = os.path.join(ROOT, "grading", "decisions-seed.json")
STORE = os.path.join(ROOT, "grading", "precedents.json")
CORRECTIONS = os.path.join(ROOT, "races", "corrections.json")
NO_LESSON_DAYS = ("2026-11-03",)   # GreMi: penalties changed that day were leniency, not wrong calls
SESSIONS = os.environ.get("LEAGUE_SESSIONS_DIR", os.path.join(ROOT, "public", "league", "sessions"))

ALONGSIDE_M = 4.0 # same as verdicts.ALONGSIDE_M
RADIUS = 2.5      # a precedent further away than this (scaled distance) is not "similar"
K = 7             # look at this many nearest graded contacts
AGREE = 0.75      # ... and follow them when this share of their weight agrees
STAFF_W = 0.5     # a staff-majority call counts half as much as GreMi's own
SAME_S = 3.0      # an incident within this many seconds of a graded one, same cars = that incident
APPLY_V = 4        # bump when apply() changes: every verdict file is redone
LABELS = {"front": "the car ahead at fault", "back": "the car behind at fault", "both": "both at fault",
          "none": "a racing incident", "no": "not an incident"}

# feature: (scale, weight). Scaled differences are weighted, then Euclidean.
FEATURES = {"gap": (4.0, 1.0), "closing": (15.0, 1.0), "moved_front": (1.5, 1.0), "moved_back": (1.5, 1.0),
            "rejoin_front": (1.0, 1.5), "rejoin_back": (1.0, 1.5), "slide": (45.0, 0.6), "lost": (2.0, 0.6),
            "off": (1.0, 0.5), "cars": (3.0, 0.4), "reaction": (1.0, 1.0), "aftermath": (1.0, 1.5)}


# ---------------------------------------------------------------- numbers of one contact


def vector(c, cars):
    """(front car, back car, {feature: value}) of one contact from the fault engine's numbers (`f`)."""
    f = c["f"]
    a, b = c["a"], c["b"]
    ahead = f.get("ahead_m") or 0.0
    front, back = (a, b) if ahead > 0 else (b, a)
    closing = (f.get("closing_kmh") or 0.0) * (1 if back == a else -1)
    moved = f.get("moved") or {}
    rej = set(f.get("rejoin") or [])
    why = c.get("why", "")
    return front, back, {
        "gap": min(abs(ahead), 20.0), "closing": max(-30.0, min(60.0, closing)),
        "moved_front": max(-6.0, min(6.0, moved.get(str(front), 0.0) or 0.0)),
        "moved_back": max(-6.0, min(6.0, moved.get(str(back), 0.0) or 0.0)),
        "rejoin_front": float(front in rej), "rejoin_back": float(back in rej),
        "slide": min(f.get("slide_deg") or 0, 120), "lost": min(f.get("places_lost") or 0, 6),
        "off": min(f.get("off_track") or 0, 3), "cars": min(cars, 8),
        "reaction": float(c.get("rule") == "R7" and "aftermath" not in why),
        "aftermath": float(c.get("rule") == "R7" and "aftermath" in why)}


SWAP = {"front": "back", "back": "front"}


def canon(x):
    """Side by side, "ahead" means little: compare such contacts with the car that moved across most
    in the "back" seat (as if it came from behind). Returns (vector, swapped)."""
    if x["gap"] < ALONGSIDE_M and x["moved_front"] > x["moved_back"]:
        y = dict(x)
        for k in ("moved", "rejoin"):
            y[k + "_front"], y[k + "_back"] = x[k + "_back"], x[k + "_front"]
        y["closing"] = -x["closing"]
        return y, True
    return x, False


def distance(x, y):
    return math.sqrt(sum((w * (x[k] - y[k]) / s) ** 2 for k, (s, w) in FEATURES.items()))


def role(front, back, fault, real):
    """A call on one contact in words that carry over to other cars: front / back / both / none / no."""
    if not real:
        return "no"
    f, b = front in fault, back in fault
    return "both" if f and b else "front" if f else "back" if b else "none"


def rule_role(c, front, back):
    if c["rule"] == "R1":
        return "no"
    return role(front, back, set(c.get("at_fault") or []), True)


# ---------------------------------------------------------------- decisions


def load_decisions():
    out = {}
    for path in (SEED, DECISIONS):
        try:
            for k, d in json.load(open(path, encoding="utf-8")).get("decisions", {}).items():
                d = dict(d, id=k)
                if d.get("t") is None:
                    m = re.search(r"inc=([\d.]+)", d.get("replay") or "")
                    if not m:
                        continue
                    d["t"] = float(m.group(1))
                if not d.get("recording"):
                    continue
                out[k] = d
        except (OSError, ValueError):
            continue
    return out


def _sev_of(pts):
    """The severity behind v2.2 contact points (1 / 3 / 6 / 10)."""
    a = abs(pts)
    return 9 if a >= 10 else 6 if a >= 6 else 4 if a >= 3 else 2


def load_lessons(cache):
    """Staff changes of contact points (and accepted protests) as graded incidents: the engine's
    call on that contact with the changed driver cleared (points to 0), blamed (points from 0) or
    kept (points changed). A rejected protest ("confirm", GreMi 5 Nov 2026) is a lesson too: the
    engine's call was right. Changes made with the staff page's picker carry their call (incident
    type, at fault / shared / not at fault, severity), which wins over guessing from the points.
    Needs CACHE/verdicts (the race's incidents and recording)."""
    try:
        changes = json.load(open(CORRECTIONS, encoding="utf-8")).get("changes", [])
    except (OSError, ValueError):
        return {}
    groups = {}
    for c in changes:
        if c.get("type") not in ("incident", "confirm") or not c.get("inc") or "|contact|" not in c.get("id", ""):
            continue
        if c.get("learn") is False or (c.get("at") or "")[:10] in NO_LESSON_DAYS:
            continue
        groups.setdefault((c["file"], round(c["inc"]["t"], 1)), []).append(c)
    out = {}
    for (file, t), cs in groups.items():
        try:
            data = json.load(open(os.path.join(cache, "verdicts", file), encoding="utf-8"))
        except (OSError, ValueError):
            continue
        pair = set(cs[0]["inc"].get("pair") or [])
        inc = next((i for i in data["incidents"] if abs(i["t0"] - t) < 0.2 and pair <= set(i["cars"])), None)
        if inc is None:
            continue
        names = names_of(file)
        name = lambda i: names.get(i, f"car {i}")  # noqa: E731
        fault = set(inc.get("at_fault") or [])
        sev = inc.get("severity") or 1
        kinds = []
        for c in cs:
            call = c.get("call") or {}
            if call.get("kind"):
                kinds.append(call["kind"])
            if call.get("fault") in ("fault", "shared"):
                fault.add(c["car"])
                sev = int(call.get("severity") or sev)
            elif call.get("fault") == "clear" or float(c["pts"]) >= 0:
                fault.discard(c["car"])
            else:
                fault.add(c["car"])
                sev = _sev_of(float(c["pts"]))
        lid = "s-" + hashlib.sha1(f"{file}|{t}".encode()).hexdigest()[:8]
        out[lid] = {"id": lid, "by": "GreMi" if all(c.get("owner") for c in cs) else "staff", "lesson": True,
                    "real": True, "at_fault": [name(x) for x in sorted(fault)], "severity": sev if fault else 0,
                    "verdict": blame_text(sorted(fault), name), "kind": kinds[0] if kinds else None,
                    "source": "protest rejected" if any(c["type"] == "confirm" for c in cs) else
                              "protest accepted" if any((c.get("reason") or "").startswith("Protest accepted") for c in cs) else "staff change", "note": "; ".join(c.get("reason", "") for c in cs)[:300],
                    "drivers": [{"car": x, "name": name(x)} for x in inc["cars"]], "recording": data["recording"],
                    "t": round(inc["t0"] - (data.get("offset") or 0), 1), "track": re.sub(r"^Race_|_\d{4}_.*$", "", file).replace("_", " "),
                    "date": "-".join(re.search(r"(\d{4})_(\d\d)_(\d\d)", file).groups())}
    return out


def fault_cars(d):
    by_name = {x["name"]: x["car"] for x in d["drivers"]}
    return {by_name[n] for n in d.get("at_fault") or [] if n in by_name}


CALLS = ("fault", "shared", "clear", "out")   # per driver in a part; shared = half the points in the SR


def parts_of(d):
    """The parts of a graded incident; an unsplit one is one part covering it (calls from at_fault)."""
    return d.get("parts") or []


def part_cars(p):
    return {x["car"] for x in p["drivers"] if x.get("call") != "out"}


def part_fault(p):
    return {x["car"] for x in p["drivers"] if x.get("call") in ("fault", "shared")} if p.get("real", True) else set()


def in_part(t, a, b, p, slack=0.6):
    cars = part_cars(p)
    return p["t0"] - slack <= t <= p["t1"] + slack and a in cars and b in cars


def part_id(d, n):
    return f"{d['id']}{chr(97 + n)}"


def key_of(d):
    """Changes when the call on a graded incident changes: its numbers are then made again."""
    import verdicts  # noqa: E402  (the rulebook's call is stored too: made again when it changes)
    k = [d["recording"], d["t"], d["verdict"], sorted(d.get("at_fault") or []), verdicts.RULES, d.get("kind")]
    if parts_of(d):   # unsplit grades keep their old key (no rebuild)
        k.append(parts_of(d))
    return hashlib.sha1(json.dumps(k, sort_keys=True).encode()).hexdigest()[:12]


def parent_of(pid, p):
    return p.get("parent") or pid


def load_store():
    try:
        return json.load(open(STORE, encoding="utf-8"))
    except (OSError, ValueError):
        return {"precedents": {}}


# ---------------------------------------------------------------- build


def find_incident(incs, d):
    """The recording's incident that is the graded one: closest in time with the most shared cars."""
    cars = {x["car"] for x in d["drivers"]}
    best, score = None, None
    for k, inc in enumerate(incs):
        dt = 0 if inc["t0"] - 2 <= d["t"] <= inc["t1"] + 2 else min(abs(inc["t0"] - d["t"]), abs(inc["t1"] - d["t"]))
        if dt > 8:
            continue
        shared = len(cars & {x["car"] for x in inc["drivers"]})
        s = (shared, -dt)
        if shared >= min(2, len(cars)) and (score is None or s > score):
            best, score = k, s
    return best


def _build_one(job):
    """Numbers of the graded incidents of one recording: [(id, precedent or None, message)]."""
    rec, ds, cache = job
    sys.path.insert(0, HERE)
    import fault_engine as fe  # noqa: E402
    import incident_replays as ir  # noqa: E402
    import verdicts  # noqa: E402
    out = []
    try:
        sess, incs, j = verdicts.prepare(ir.download(rec, cache))
    except Exception as ex:
        return [(d["id"], None, f"{d['id']}: recording {rec} not read: {ex}") for d in ds]
    vs = verdicts.judge_all(j, incs)
    for d in ds:
        if parts_of(d):
            out += _build_parts(d, rec, incs, vs)
            continue
        k = find_incident(incs, d)
        if k is None:
            out.append((d["id"], None, f"{d['id']}: incident not found in {rec}"))
            continue
        inc, v = incs[k], vs[k]
        fault, cars = fault_cars(d), len(inc["drivers"])
        contacts = []
        for p in v["contacts"]:
            if p["rule"] == "R6" or not p.get("features"):
                continue
            c = {"a": p["a"], "b": p["b"], "rule": p["rule"], "why": p["why"], "at_fault": p.get("at_fault_all") or [],
                 "f": fe.feats(p)}
            front, back, x = vector(c, cars)
            contacts.append({"a": p["a"], "b": p["b"], "t": round(p["t"], 1), "x": {n: round(val, 2) for n, val in x.items()},
                             "label": role(front, back, fault, d["real"]), "rulebook": rule_role(c, front, back), "rule": p["rule"]})
        out.append((d["id"], {
            "key": key_of(d), "by": d.get("by", "GreMi"), "track": d.get("track"), "date": d.get("date"),
            "kind": d.get("kind"), "source": d.get("source") or "grade", "verdict": d["verdict"], "severity": d.get("severity") or 0, "note": (d.get("note") or "")[:300],
            "recording": rec, "t": d["t"], "cars": sorted({x["car"] for x in inc["drivers"]}),
            "rulebook": {"verdict": v["verdict"], "rule": v["rule"]}, "contacts": contacts},
            f"{d['id']} {rec} t={d['t']} -> {d['verdict']} ({len(contacts)} contacts)"))
    return out


def _contact_entry(p, cars, fault, real):
    import fault_engine as fe  # noqa: E402
    c = {"a": p["a"], "b": p["b"], "rule": p["rule"], "why": p["why"], "at_fault": p.get("at_fault_all") or [],
         "f": fe.feats(p)}
    front, back, x = vector(c, cars)
    return {"a": p["a"], "b": p["b"], "t": round(p["t"], 1), "x": {n: round(val, 2) for n, val in x.items()},
            "label": role(front, back, fault, real), "rulebook": rule_role(c, front, back), "rule": p["rule"]}


def _build_parts(d, rec, incs, vs):
    """One precedent per part of a split grade, plus one for its innocent touches."""
    every = [(p, inc) for inc, v in zip(incs, vs) for p in v["contacts"] if p["rule"] != "R6" and p.get("features")]
    taken, out, parts = set(), [], parts_of(d)
    for n, part in enumerate(parts):
        mine = [p for p, _ in every if id(p) not in taken and in_part(p["t"], p["a"], p["b"], part)]
        taken.update(id(p) for p in mine)
        cars, fault, real = len(part_cars(part)), part_fault(part), part.get("real", True)
        sev = max([x.get("severity") or 0 for x in part["drivers"] if x["car"] in fault] or [0])
        pid = part_id(d, n)
        out.append((pid, {
            "key": key_of(d), "parent": d["id"], "part": n + 1, "of": len(parts), "by": d.get("by", "GreMi"),
            "track": d.get("track"), "date": d.get("date"), "verdict": part.get("verdict") or d["verdict"],
            "severity": sev, "note": (part.get("note") or "")[:300], "tags": part.get("tags") or [],
            "kind": part.get("kind"), "source": d.get("source") or "grade",
            "calls": {str(x["car"]): {k: x[k] for k in ("name", "call", "severity", "note") if x.get(k) not in (None, "")}
                      for x in part["drivers"]},
            "recording": rec, "t": part["t0"], "t1": part["t1"], "cars": sorted(part_cars(part)),
            "contacts": [_contact_entry(p, cars, fault, real) for p in mine]},
            f"{pid} {rec} {part['t0']}-{part['t1']} s -> {part.get('verdict') or ''} ({len(mine)} contacts)"))
    k = find_incident(incs, d)
    involved = set().union(*(part_cars(p) for p in parts))
    lo, hi = min(p["t0"] for p in parts), max(p["t1"] for p in parts)
    if k is not None:
        touches = [p for p in vs[k]["contacts"] if p["rule"] != "R6" and p.get("features") and id(p) not in taken
                   and p["a"] in involved and p["b"] in involved and lo - 1 <= p["t"] <= hi + 1]
        if touches:
            pid = d["id"] + "-touches"
            out.append((pid, {"key": key_of(d), "parent": d["id"], "by": d.get("by", "GreMi"), "track": d.get("track"),
                              "date": d.get("date"), "verdict": "Not an incident", "severity": 0,
                              "note": "contacts in the graded incident outside its parts: innocent touches",
                              "recording": rec, "t": lo, "t1": hi, "cars": sorted(involved),
                              "contacts": [_contact_entry(p, len(involved), set(), False) for p in touches]},
                        f"{pid} {rec}: {len(touches)} innocent touches"))
    return out


def build(cache):
    store = load_store()
    decs = load_decisions()
    lessons = load_lessons(cache)
    print(len(lessons), "staff changes / protests as lessons")
    decs.update({k: v for k, v in lessons.items() if k not in decs})
    todo = {}
    for k, d in decs.items():
        mine = [p for pid, p in store["precedents"].items() if parent_of(pid, p) == k]
        if not mine or any(p.get("key") != key_of(d) for p in mine):
            todo.setdefault(d["recording"], []).append(d)
    for k in list(store["precedents"]):
        p = store["precedents"][k]
        if parent_of(k, p) not in decs:
            del store["precedents"][k]
    jobs = [(rec, ds, cache) for rec, ds in sorted(todo.items())]
    with ProcessPoolExecutor(int(os.environ.get("FAULT_JOBS", "2"))) as ex:
        for done in ex.map(_build_one, jobs):
            fresh = set()
            for pid, entry, msg in done:
                print(msg)
                if entry:
                    parent = parent_of(pid, entry)
                    if parent not in fresh:   # the old entries of this grade (a split changes their ids)
                        fresh.add(parent)
                        for old in [q for q, e in store["precedents"].items() if parent_of(q, e) == parent]:
                            del store["precedents"][old]
                    store["precedents"][pid] = entry
    store["about"] = "Numbers of every graded incident's contacts and the final call (scripts/telemetry/precedents.py)."
    # how often the engine gets the graded incidents right without having seen them, over time
    # (the staff page's "What I learned" page shows it)
    try:
        import datetime
        import verdicts  # noqa: E402
        r = evaluate(store)
        now = {k: r[k] for k in ("incidents", "inc_rulebook", "inc_with_precedents", "contacts", "rulebook", "with_precedents", "overrides")}
        hist = store.get("eval_history") or []
        if not hist or {k: hist[-1].get(k) for k in now} != now or hist[-1].get("rules") != verdicts.RULES:
            hist.append(dict(now, date=datetime.date.today().isoformat(), rules=verdicts.RULES))
        store["eval_history"] = hist[-60:]
    except Exception as ex:
        print("leave-one-out check failed:", ex)
    store["precedents"] = dict(sorted(store["precedents"].items()))
    json.dump(store, open(STORE + ".tmp", "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    os.replace(STORE + ".tmp", STORE)
    print(len(store["precedents"]), "precedents in", os.path.relpath(STORE, ROOT))


# ---------------------------------------------------------------- predict


def points(store, skip=None):
    """Every graded contact as (vector, label, precedent id, weight, precedent)."""
    out = []
    for pid, p in store["precedents"].items():
        if pid == skip:
            continue
        for c in p["contacts"]:
            x, sw = canon(c["x"])
            out.append((x, SWAP.get(c["label"], c["label"]) if sw else c["label"], pid, 1.0 if p.get("by", "GreMi") == "GreMi" else STAFF_W, p))
    return out


def predict(x, pts):
    """(label, nearest precedent id, distance) when similar graded contacts agree, else None."""
    x, sw = canon(x)
    g = _predict(x, pts)
    return (SWAP.get(g[0], g[0]) if sw else g[0],) + g[1:] if g else None


def _predict(x, pts):
    near = sorted(((distance(x, px), lab, pid, w) for px, lab, pid, w, _ in pts), key=lambda t: t[0])[:K]
    near = [n for n in near if n[0] <= RADIUS]
    if not near:
        return None
    votes = {}
    for d, lab, pid, w in near:
        votes[lab] = votes.get(lab, 0) + w / (d + 0.2)
    lab = max(votes, key=votes.get)
    if votes[lab] / sum(votes.values()) < AGREE:
        return None
    d, _, pid, _ = next(n for n in near if n[1] == lab)
    return lab, pid, round(d, 2)


def allowed(rule, lab):
    """Precedents may clear the blame, or move it, but never blame someone for a contact the
    rulebook found harmless or had no time to react to (too few grades to be that sure yet)."""
    return lab in ("no", "none") or rule not in ("R1", "R7", "R6")


def evaluate(store=None):
    """Leave-one-out over the graded incidents: how often the rulebook and the precedents put the
    blame where the final call did ("not an incident" and "racing incident" both = nobody)."""
    store = store or load_store()
    who = lambda lab: "nobody" if lab in ("no", "none") else lab  # noqa: E731
    rows, n, rb_ok, pr_ok, used, incs = [], 0, 0, 0, 0, {}
    for pid, p in store["precedents"].items():
        pts = points(store, skip=pid)
        for c in p["contacts"]:
            n += 1
            guess = predict(c["x"], pts)
            if guess and not allowed(c["rule"], guess[0]):
                guess = None
            mine = guess[0] if guess else c["rulebook"]
            used += bool(guess and guess[0] != c["rulebook"])
            a, b = who(c["rulebook"]) == who(c["label"]), who(mine) == who(c["label"])
            rb_ok, pr_ok = rb_ok + a, pr_ok + b
            ok = incs.setdefault(pid, [True, True])
            ok[0], ok[1] = ok[0] and a, ok[1] and b
            rows.append((pid, c["label"], c["rulebook"], mine, guess))
    return {"contacts": n, "rulebook": rb_ok, "with_precedents": pr_ok, "overrides": used, "rows": rows,
            "incidents": len(incs), "inc_rulebook": sum(v[0] for v in incs.values()),
            "inc_with_precedents": sum(v[1] for v in incs.values())}


# ---------------------------------------------------------------- apply to the fault engine's verdicts


def version(store, decs=None):
    graded = sorted((k, d.get("verdict"), d.get("severity"), d.get("at_fault"), parts_of(d)) for k, d in (decs or {}).items())
    return hashlib.sha1(json.dumps([APPLY_V, store["precedents"], RADIUS, K, AGREE, STAFF_W, FEATURES, graded],
                                   sort_keys=True, default=str).encode()).hexdigest()[:10]


def names_of(file):
    try:
        png = json.load(open(os.path.join(SESSIONS, file), encoding="utf-8"))
        return {c["index"]: re.sub(r"\s+", " ", c["driver-name"]).strip() for c in png["classification-data"]}
    except (OSError, ValueError, KeyError):
        return {}


def blame_text(cars, name):
    return " + ".join(name(x) for x in cars) + " at fault" if cars else "Racing incident"


def summarize(inc, name):
    """An incident's call from its contacts' calls (after some of them changed)."""
    counted = [c for c in inc["contacts"] if c["rule"] != "R6"]
    blamed = [c for c in counted if c.get("at_fault")]
    cars = []
    for c in blamed:
        cars += [x for x in c["at_fault"] if x not in cars]
    if blamed:
        main = max(blamed, key=lambda c: c["severity"])
        inc.update(rule=main["rule"] if len(cars) == 1 or main["rule"] == "R9" else "R8", severity=main["severity"],
                   verdict=blame_text(cars, name), why="; ".join(dict.fromkeys(c["why"] for c in blamed)), at_fault=cars)
    elif not counted or all(c["rule"] == "R1" for c in counted):
        first = (counted or inc["contacts"])[0]
        inc.update(rule="R1" if counted else first["rule"], severity=1, verdict="Not an incident", why=first["why"], at_fault=[])
    else:
        first = next(c for c in counted if c["rule"] != "R1")
        inc.update(rule=first["rule"], severity=first["severity"], verdict="Racing incident", why=first["why"], at_fault=[])


def match(d, incidents, off):
    """The incident of this race that a graded one is: closest in time, most shared cars."""
    best = None
    for inc in incidents:
        t0, t1 = inc["t0"] - off, inc["t1"] - off
        shared = len({x["car"] for x in d["drivers"]} & set(inc["cars"]))
        dt = 0 if t0 <= d["t"] <= t1 else min(abs(t0 - d["t"]), abs(t1 - d["t"]))
        if shared >= min(2, len(d["drivers"])) and dt <= SAME_S and (best is None or (shared, -dt) > best[0]):
            best = ((shared, -dt), inc)
    return best[1] if best else None


def call_text(part, name):
    fault = sorted(x["car"] for x in part["drivers"] if x.get("call") == "fault")
    shared = sorted(x["car"] for x in part["drivers"] if x.get("call") == "shared")
    if not part.get("real", True):
        return "Not an incident"
    bits = []
    if fault:
        bits.append(" + ".join(name(x) for x in fault) + " at fault")
    if shared:
        bits.append(" + ".join(name(x) for x in shared) + (" share the blame" if len(shared) > 1 else " shares the blame"))
    return "; ".join(bits) or "Racing incident"


def split_graded(data, d, off, name):
    """A graded incident split into parts: one incident per part (GreMi's call per driver), its other
    contacts between involved drivers = innocent touches, contacts with a driver not involved go back
    to the rulebook. Returns how many incidents changed."""
    parts, who = parts_of(d), "GreMi" if d.get("by", "GreMi") == "GreMi" else "the staff"
    home = match(d, data["incidents"], off)
    claimed = {}   # id(contact) -> part number
    found = [[] for _ in parts]
    for n, part in enumerate(parts):
        for inc in data["incidents"]:
            for c in inc["contacts"]:
                if c["rule"] != "R6" and id(c) not in claimed and in_part(c["t"] - off, c["a"], c["b"], part):
                    claimed[id(c)] = n
                    found[n].append((c, inc))
    involved = set().union(*(part_cars(p) for p in parts))
    lo, hi = min(p["t0"] for p in parts), max(p["t1"] for p in parts)
    touched = set()
    if home is not None:
        for c in home["contacts"]:
            if (id(c) not in claimed and c["rule"] != "R6" and c["a"] in involved and c["b"] in involved
                    and lo - 1 <= c["t"] - off <= hi + 1):
                why = f"graded by {who} ({d['id'].upper()}): an innocent touch, not part of the split incidents"
                c.update(rule="R1", severity=1, verdict="Not an incident", why=why, at_fault=[], precedent={"id": d["id"], "own": True})
                touched.add(id(home))
    new = []
    for n, part in enumerate(parts):
        if not found[n]:
            print(f"{d['id']} part {n + 1} ({part['t0']}-{part['t1']} s): no contacts between its drivers in that window")
            continue
        fault, real = part_fault(part), part.get("real", True)
        calls = {str(x["car"]): {"call": x.get("call") or "clear", "severity": max(1, min(10, int(x.get("severity") or 1)))}
                 for x in part["drivers"] if x.get("call") != "out"}
        sev = max([calls[str(x)]["severity"] for x in fault] or [1])
        pid = part_id(d, n)
        why = f"graded by {who} ({d['id'].upper()}, part {n + 1} of {len(parts)}): {call_text(part, name)}"  # notes stay off the public site
        contacts = []
        for c, _ in sorted(found[n], key=lambda ci: ci[0]["t"]):
            cf = [x for x in (c["a"], c["b"]) if x in fault]
            if not real:
                c.update(rule="R1", severity=1, verdict="Not an incident", why=why, at_fault=[])
            else:
                c.update(rule="G", severity=max([calls[str(x)]["severity"] for x in cf] or [sev]),
                         verdict=blame_text(cf, name), why=why, at_fault=cf)
            c["precedent"] = {"id": pid, "own": True}
            contacts.append(c)
        src = found[n][0][1]
        cars = sorted(part_cars(part))
        new.append({"t0": round(part["t0"] + off, 2), "t1": round(part["t1"] + off, 2), "lap": src["lap"], "kind": src.get("kind"),
                    "cars": cars, "roles": {str(x): "contact" for x in cars},
                    "rule": "G" if real else "R1", "severity": sev if real else 1,
                    "verdict": call_text(part, name), "why": why, "at_fault": sorted(fault) if real else [],
                    "calls": calls if real else {}, "contacts": contacts,
                    "precedent": {"id": pid, "own": True, "parent": d["id"], "part": n + 1, "of": len(parts)}})
    keep = []
    for inc in data["incidents"]:
        before = len(inc["contacts"])
        inc["contacts"] = [c for c in inc["contacts"] if id(c) not in claimed]
        if not inc["contacts"]:
            continue
        if len(inc["contacts"]) != before or id(inc) in touched:
            inc["t0"], inc["t1"] = min(c["t"] for c in inc["contacts"]), max(c["t"] for c in inc["contacts"])
            left = {x for c in inc["contacts"] for x in (c["a"], c["b"])}
            inc["cars"] = [x for x in inc["cars"] if x in left] + sorted(left - set(inc["cars"]))
            inc["roles"] = {str(x): (inc.get("roles") or {}).get(str(x), "contact") for x in inc["cars"]}
            summarize(inc, name)
            if inc is home and all(c.get("precedent", {}).get("own") for c in inc["contacts"] if c["rule"] != "R6"):
                inc["precedent"] = {"id": d["id"], "own": True}
        keep.append(inc)
    data["incidents"] = sorted(keep + new, key=lambda inc: inc["t0"])
    return len(new) + len(touched)


def apply_file(path, store, decs, pts, ver):
    data = json.load(open(path, encoding="utf-8"))
    if data.get("precedents") == ver:
        return 0
    names = names_of(os.path.basename(path))
    name = lambda i: names.get(i, f"car {i}")  # noqa: E731
    off = data.get("offset") or 0
    # start from the rulebook's calls every time (a split changes the list of incidents itself)
    if "rulebook_incidents" in data:
        data["incidents"] = json.loads(json.dumps(data["rulebook_incidents"]))
    else:
        for inc in data["incidents"]:
            inc.update(inc.get("rulebook") or {})
            for c in inc["contacts"]:
                c.update(c.get("rulebook") or {})
                c.pop("precedent", None)
            inc.pop("precedent", None)
        data["rulebook_incidents"] = json.loads(json.dumps(data["incidents"]))
    for inc in data["incidents"]:
        inc.setdefault("rulebook", {k: inc[k] for k in ("rule", "severity", "verdict", "why", "at_fault")})
        for c in inc["contacts"]:
            c.setdefault("rulebook", {k: c[k] for k in ("rule", "severity", "verdict", "why", "at_fault")})
    graded = [d for d in decs.values() if d["recording"] == data.get("recording")]
    changed = 0
    for d in graded:   # 0. split grades first: they change the incidents themselves
        if parts_of(d):
            changed += split_graded(data, d, off, name)
    mine = {}   # graded incident id -> the incident of this race it is (closest, most shared cars)
    for d in graded:
        if not parts_of(d):
            inc = match(d, data["incidents"], off)
            if inc is not None:
                mine[d["id"]] = inc
    for inc in data["incidents"]:
        if (inc.get("precedent") or {}).get("own"):
            continue
        counted = [c for c in inc["contacts"] if c["rule"] != "R6"]
        if not counted:
            continue
        # 1. this incident was graded itself: GreMi's (or the staff's) call, as given
        own = next((d for d in graded if mine.get(d["id"]) is inc), None)
        if own:
            fault = sorted(fault_cars(own))
            who = "GreMi" if own.get("by", "GreMi") == "GreMi" else "the staff"
            why = f"graded by {who} ({own['id'].upper()}): {own['verdict']}"   # the note stays off the public site
            if not own["real"]:
                inc.update(rule="R1", severity=1, verdict="Not an incident", why=why, at_fault=[])
                for c in counted:
                    c.update(rule="R1", severity=1, verdict="Not an incident", why=why, at_fault=[])
            else:
                sev = max(1, min(10, int(own.get("severity") or inc["severity"])))
                inc.update(rule="G", severity=sev, verdict=blame_text(fault, name), why=why, at_fault=fault)
                for c in counted:
                    cf = [x for x in (c["a"], c["b"]) if x in fault]
                    c.update(rule="G", severity=sev, verdict=blame_text(cf, name), why=why, at_fault=cf)
            inc["precedent"] = {"id": own["id"], "own": True}
            changed += 1
            continue
        # 2. similar graded contacts
        moved = False
        for c in counted:
            if not c.get("f") or c["rule"] == "R9" or (c.get("precedent") or {}).get("own"):
                continue
            front, back, x = vector(c, len(inc["cars"]))
            guess = predict(x, pts)
            if not guess:
                continue
            lab, pid, dist = guess
            p = store["precedents"][pid]
            c["precedent"] = {"id": pid, "d": dist, "label": lab}
            if lab == rule_role(c, front, back) or not allowed(c["rule"], lab):
                continue
            cf = {"front": [front], "back": [back], "both": [front, back]}.get(lab, [])
            cite = (f"GreMi called a similar one ({pid.upper()}, {p.get('track')} {p.get('date')}) {LABELS[lab]}"
                    if p.get("by", "GreMi") == "GreMi" else
                    f"the staff called a similar one ({pid.upper()}, {p.get('track')} {p.get('date')}) {LABELS[lab]}")
            why = f"{c['why']}; but {cite}"
            if lab == "no":
                c.update(rule="R1", severity=1, verdict="Not an incident", why=why, at_fault=[])
            else:
                sev = c["severity"]
                if cf and not c["rulebook"]["at_fault"]:
                    sev = min(10, sev + 1)   # the rulebook adds 1 when one driver is clearly at fault
                c.update(rule="P", severity=sev, verdict=blame_text(cf, name), why=why, at_fault=cf)
            moved = True
        if not moved:
            continue
        changed += 1
        summarize(inc, name)
        inc["precedent"] = next((c["precedent"] for c in counted if c.get("precedent")), None)
    data["precedents"] = ver
    json.dump(data, open(path + ".tmp", "w"), separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return changed


def apply(cache):
    store = load_store()
    decs = load_decisions()
    pts = points(store)
    ver = version(store, decs)
    total = 0
    for path in sorted(glob.glob(os.path.join(cache, "verdicts", "*.json"))):
        try:
            n = apply_file(path, store, decs, pts, ver)
        except (OSError, ValueError, KeyError) as ex:
            print(os.path.basename(path), ": precedents not applied:", ex)
            continue
        if n:
            print(os.path.basename(path), ":", n, "incidents follow a graded call")
        total += n
    print(f"precedents {ver}: {len(store['precedents'])} graded incidents, {total} incidents changed")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "eval"
    cache = sys.argv[2] if len(sys.argv) > 2 else "/tmp/telemetry-cache"
    if cmd == "build":
        build(cache)
    elif cmd == "apply":
        apply(cache)
    else:
        r = evaluate()
        print(f"blame right on {r['incidents']} graded incidents (never seen): rulebook {r['inc_rulebook']}, "
              f"with precedents {r['inc_with_precedents']}; contacts {r['rulebook']} / {r['with_precedents']} of {r['contacts']} "
              f"({r['overrides']} changed by precedents)")
        for pid, lab, rbk, mine, guess in r["rows"]:
            if lab != rbk or lab != mine:
                print(f"  {pid}: GreMi {lab:5} rulebook {rbk:5} -> {mine:5}", f"(like {guess[1]}, d={guess[2]})" if guess else "")
