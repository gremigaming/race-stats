#!/usr/bin/env python3
"""Precedents: the fault engine looks at what GreMi decided before, not only at the rulebook.

Every incident GreMi (or the staff majority) graded is a precedent: the numbers of each of its
contacts (gap along the track, closing speed, who moved across, rejoining, harm done) and the
final call on it. When the fault engine judges a new contact it looks for the most similar
graded contacts. If they are close enough and agree with each other, their call wins over the
rulebook's, and the verdict says which past incident it followed. An incident that was graded
itself always gets GreMi's own call.

  grading/decisions-seed.json   GreMi's grades of calibration batches 1-3 (grading page artifact)
  grading/decisions.json        final calls from the staff page (written by the staff server)
  grading/precedents.json       the numbers of every graded incident (built here, committed)

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
SESSIONS = os.environ.get("LEAGUE_SESSIONS_DIR", os.path.join(ROOT, "public", "league", "sessions"))

ALONGSIDE_M = 4.0 # same as verdicts.ALONGSIDE_M
RADIUS = 2.5      # a precedent further away than this (scaled distance) is not "similar"
K = 7             # look at this many nearest graded contacts
AGREE = 0.75      # ... and follow them when this share of their weight agrees
STAFF_W = 0.5     # a staff-majority call counts half as much as GreMi's own
SAME_S = 3.0      # an incident within this many seconds of a graded one, same cars = that incident
APPLY_V = 3        # bump when apply() changes: every verdict file is redone
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


def fault_cars(d):
    by_name = {x["name"]: x["car"] for x in d["drivers"]}
    return {by_name[n] for n in d.get("at_fault") or [] if n in by_name}


def key_of(d):
    """Changes when the call on a graded incident changes: its numbers are then made again."""
    import verdicts  # noqa: E402  (the rulebook's call is stored too: made again when it changes)
    return hashlib.sha1(json.dumps([d["recording"], d["t"], d["verdict"], sorted(d.get("at_fault") or []), verdicts.RULES]).encode()).hexdigest()[:12]


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
            "verdict": d["verdict"], "severity": d.get("severity") or 0, "note": (d.get("note") or "")[:300],
            "recording": rec, "t": d["t"], "cars": sorted({x["car"] for x in inc["drivers"]}),
            "rulebook": {"verdict": v["verdict"], "rule": v["rule"]}, "contacts": contacts},
            f"{d['id']} {rec} t={d['t']} -> {d['verdict']} ({len(contacts)} contacts)"))
    return out


def build(cache):
    store = load_store()
    decs = load_decisions()
    todo = {}
    for k, d in decs.items():
        p = store["precedents"].get(k)
        if not p or p.get("key") != key_of(d):
            todo.setdefault(d["recording"], []).append(d)
    for k in list(store["precedents"]):
        if k not in decs:
            del store["precedents"][k]
    jobs = [(rec, ds, cache) for rec, ds in sorted(todo.items())]
    with ProcessPoolExecutor(int(os.environ.get("FAULT_JOBS", "2"))) as ex:
        for done in ex.map(_build_one, jobs):
            for pid, entry, msg in done:
                print(msg)
                if entry:
                    store["precedents"][pid] = entry
    store["about"] = "Numbers of every graded incident's contacts and the final call (scripts/telemetry/precedents.py)."
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


def version(store):
    return hashlib.sha1(json.dumps([APPLY_V, store["precedents"], RADIUS, K, AGREE, STAFF_W, FEATURES], sort_keys=True).encode()).hexdigest()[:10]


def names_of(file):
    try:
        png = json.load(open(os.path.join(SESSIONS, file), encoding="utf-8"))
        return {c["index"]: re.sub(r"\s+", " ", c["driver-name"]).strip() for c in png["classification-data"]}
    except (OSError, ValueError, KeyError):
        return {}


def blame_text(cars, name):
    return " + ".join(name(x) for x in cars) + " at fault" if cars else "Racing incident"


def apply_file(path, store, decs, pts, ver):
    data = json.load(open(path, encoding="utf-8"))
    if data.get("precedents") == ver:
        return 0
    names = names_of(os.path.basename(path))
    name = lambda i: names.get(i, f"car {i}")  # noqa: E731
    off = data.get("offset") or 0
    graded = [d for d in decs.values() if d["recording"] == data.get("recording")]
    mine = {}   # graded incident id -> the incident of this race it is (closest, most shared cars)
    for d in graded:
        best = None
        for inc in data["incidents"]:
            t0, t1 = inc["t0"] - off, inc["t1"] - off
            shared = len({x["car"] for x in d["drivers"]} & set(inc["cars"]))
            dt = 0 if t0 <= d["t"] <= t1 else min(abs(t0 - d["t"]), abs(t1 - d["t"]))
            if shared >= min(2, len(d["drivers"])) and dt <= SAME_S and (best is None or (shared, -dt) > best[0]):
                best = ((shared, -dt), inc)
        if best:
            mine[d["id"]] = best[1]
    changed = 0
    for inc in data["incidents"]:
        rb = inc.setdefault("rulebook", {k: inc[k] for k in ("rule", "severity", "verdict", "why", "at_fault")})
        inc.update(rb)
        for c in inc["contacts"]:
            crb = c.setdefault("rulebook", {k: c[k] for k in ("rule", "severity", "verdict", "why", "at_fault")})
            c.update(crb)
            c.pop("precedent", None)
        inc.pop("precedent", None)
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
            if not c.get("f") or c["rule"] == "R9":
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
        blamed = [c for c in counted if c.get("at_fault")]
        cars = []
        for c in blamed:
            cars += [x for x in c["at_fault"] if x not in cars]
        if blamed:
            main = max(blamed, key=lambda c: c["severity"])
            inc.update(rule=main["rule"] if len(cars) == 1 or main["rule"] == "R9" else "R8", severity=main["severity"],
                       verdict=blame_text(cars, name), why="; ".join(dict.fromkeys(c["why"] for c in blamed)), at_fault=cars)
        elif all(c["rule"] == "R1" for c in counted):
            first = counted[0]
            inc.update(rule="R1", severity=1, verdict="Not an incident", why=first["why"], at_fault=[])
        else:
            first = next(c for c in counted if c["rule"] != "R1")
            inc.update(rule=first["rule"], severity=first["severity"], verdict="Racing incident", why=first["why"], at_fault=[])
        inc["precedent"] = next((c["precedent"] for c in counted if c.get("precedent")), None)
    data["precedents"] = ver
    json.dump(data, open(path + ".tmp", "w"), separators=(",", ":"))
    os.replace(path + ".tmp", path)
    return changed


def apply(cache):
    store = load_store()
    decs = load_decisions()
    pts = points(store)
    ver = version(store)
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
