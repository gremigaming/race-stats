"""Rulebook v1.7 (GreMi, rounds 1-13, 18-25 Nov 2026).

The rulebook thread's v17 engine with its round 9-11 extras, judged the way the thread scored it
(128 of GreMi's 171 graded incidents, v1.6 gets 80 of the same 171):

  rulebook_v17_base.py   measures every car pair of an incident against the field (braking, racing
                         line, moves, wheels off, time lost) and keeps them on inc["_ms"]
  rulebook_v17_feat4.py  extra measures per contact: move beyond the field's expected line from the same
                         entry line, wall hits (map walls), slides, ground (exec'd with path and H)
  rulebook_v17_harm.py   did the car carry on: next 300 m, places, retired (exec'd with path and H)
  judge_incidents()      the round 11 judge: v17's judge_pair on those measures, then the chain rules
                         (later touches in the first 3 s are the aftermath, unless a car not hurt by the
                         first touch makes its own hit), the finish line and the wake of an earlier crash.

Used by verdicts.judge_all() for races recorded on or after V17_FROM; older races keep v1.6, so frozen
calls are never re-judged.
"""
import copy
import json
import os
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
CAR_LEN = 5.6
LIM1, LIM2 = 1.0, 0.5          # lost time that counts as harm on lap 1 / later laps
CHAIN_S = 3.0                  # touches this soon after the first one are its aftermath
CHAIN_S4, CHAIN_M = 4, 3.0     # ...unless the car makes its own clear hit (severity 4+ or moved 3 m+)
WAKE_S, WAKE_V = 10.0, 60      # a car still crawling (< 60 km/h) after a crash in the last 10 s is in its wake
FIN_NEAR = 1.0                 # touches within 1 s of a car taking the flag: nothing
EXPK = "exp_dev1.0"            # move = metres towards the other car beyond the field's line from the same entry line
SLIPHARM = 12                  # a slide of 12 deg+ after the touch (not before) is harm
WALLHIT = 20                   # a wall hit 20 km/h+ just after the touch is harm (and counts as pushed off)
HARM_BIG = 5                   # wrecked / never covered the next 300 m: 5 s lost

# judge_pair's settings (the round 11 run: EARLYBRK=40, REJOIN_SURF, MAPREJ; the rest v17 defaults)
NS = {"CAR_LEN": CAR_LEN, "FLOW": 0.0, "FLOW_N": 2, "LIGHT_KMH": 5.0, "MOVE_MIN": 1.5, "AMBIG": 2.0, "SPLIT": 3.0,
      "DODGE": True, "BRAKECHK": 1.3, "SLOWCAR": 0.6, "DIVE": 4.0, "PANIC": True, "LIM2": LIM2, "HARM_S": 3.0,
      "OWN_GAP": 6.5, "LASTMIN": 3.0, "BC_STRICT": True, "THROTTLE_HIT": True, "MINOR": 0.0, "BC_SHARE": 20.0,
      "ALONG_OK": True, "SELF_HARM": True, "LAP1_PACK": 15.0, "SECOND_HARM": 0.0, "SECOND_MODE": 3, "OWN_T": 0.0,
      "LAP1_PACK2": 20.0, "LAP1_MV": 3.0, "NO_OFFBRAKE": False, "BLOCK_V": 150.0, "BLOCK_ANY": True, "O_LIM": 0.5,
      "M2": 1.5, "DIFF": 1.0, "BOTHM": 1.5, "MOVE_COMB": 0, "OWN_ALWAYS": False, "LIM1": LIM1, "NOHARM_MV": 0.0,
      "NOHARM_O": 0.5, "EARLYBRK": 40.0, "EARLY_CL": 10.0, "REJOIN_SURF": True, "MAPREJ": True, "OFFBRAKE_ZONE": True}


def _src(name):
    return open(os.path.join(HERE, name), encoding="utf-8").read()


def _judge_pair():
    src = _src("rulebook_v17_base.py")
    jp = src.split("    def judge_pair(", 1)[1].split("\n    FLOW, FLOW_N", 1)[0]
    ns = dict(NS)
    exec(textwrap.dedent("    def judge_pair(" + jp), ns)
    return ns["judge_pair"]


def _run(fname, path, H, sess=None, frames=None):
    # the race's parsed session and frames are passed in (25 Nov 2026): parsing them again per file took 3 GB on Monaco
    ns = {"path": path, "H": H, "SESS": sess, "FRAMES": frames, "__name__": "rulebook_v17_" + fname}
    exec(compile(_src(fname), fname, "exec"), ns)
    return ns["out"]


def _fix(m):
    return {(int(k) if k.isdigit() else k): (dict(v) if isinstance(v, dict) else v) for k, v in m.items()}


def judge_incidents(j, incs, name=str, path=None, sess=None):
    """v1.7 verdicts for every incident (same shape as verdicts.Judge.judge). None for an incident = keep the old call."""
    import rulebook_v17_base
    incs2 = copy.deepcopy(incs)
    base = rulebook_v17_base.judge_incidents(j, incs2, name)
    # the measures, saved the way the rulebook thread saved them (JSON: car ids as strings, fixed back below)
    H = []
    for inc, b in zip(incs2, base):
        H.append({"t0": inc["t0"], "t1": inc["t1"], "lap": inc["lap"],
                  "raw": [{"a": p["a"], "b": p["b"], "ms": p["ms"]} for p in inc.get("_ms", [])],
                  "ai": all(c["rule"] == "R6" for c in b["contacts"]),
                  "names": {str(d["car"]): name(d["car"]) for d in inc["drivers"]},
                  "wet": (j.weather_at(inc["t0"]) or 0) >= 3,
                  "contacts": [(c["a"], c["b"], c["t"]) for c in inc["contacts"]]})
    H = json.loads(json.dumps(H, default=str))
    frames = getattr(j, "frames", None)
    try:
        HM = _run("rulebook_v17_harm.py", path, H, sess, frames)
    except Exception as ex:   # noqa: BLE001  (no harm data: judge without it)
        print("rulebook_v17: harm measures failed:", ex)
        HM = None
    try:
        F4 = _run("rulebook_v17_feat4.py", path, H, sess, frames)
    except Exception as ex:   # noqa: BLE001
        print("rulebook_v17: extra measures failed:", ex)
        F4 = None
    if sess is None:
        import gmtel
        sess = gmtel.Session(path)
    chqf = next((t for t, e in sess.events if e == "CHQF"), None)
    fz = {"chqf": chqf, "laps": sess.info.get("total_laps") or 0, "len": sess.info.get("track_length") or 0}
    fc = {}
    for t in sorted(sess.field):
        for i, r in sess.field[t].items():
            if r.get("result_status") == 3 and str(i) not in fc:
                fc[str(i)] = t
    judge_pair = _judge_pair()

    allc = []   # (t, a, b, lap, lap distance, incident index) of every measured touch
    for n, inc in enumerate(H):
        for p in inc["raw"]:
            for m in p["ms"]:
                allc.append((m["t"], p["a"], p["b"], m["lap"], m["d"], n))
    res = []
    for n, inc in enumerate(H):
        if inc["ai"] or not inc["raw"]:
            res.append(None)
            continue
        nm = lambda i: inc["names"].get(str(i), f"car {i}")   # noqa: E731
        order = sorted(inc["raw"], key=lambda p: p["ms"][0]["t"])
        fault, notes, involved, victims, contacts = {}, [], set(), set(), []
        t_first = order[0]["ms"][0]["t"]
        for p in order:
            a, b = p["a"], p["b"]
            ms = [_fix(m) for m in p["ms"]]
            t = ms[0]["t"]
            if F4:
                for m in ms:
                    q4 = next((q for q in F4[n] if {q["a"], q["b"]} == {a, b} and abs(q["t"] - m["t"]) < 0.05), None)
                    for c in (a, b):
                        m[c]["f4"] = (q4 or {}).get(str(c)) or {}
                    if not q4:
                        continue
                    for c in (a, b):
                        z = q4.get(str(c)) or {}
                        # round 11 (GreMi: 'he starts turning in way too early'): a move is how far the car went towards
                        # the other car beyond where the field goes from the same entry line
                        if z.get(EXPK) is not None:
                            m[c]["toward_vs_line_before_m"] = z[EXPK]
                        lim_ = LIM1 if m["lap"] == 1 else LIM2
                        # round 11 (GreMi Baku: 'he did not go off track, but only because he hit a wall'): slides and wall hits are harm
                        if (z.get("slip_post") or 0) >= SLIPHARM and (z.get("slip_pre") or 0) < 8:
                            m[c]["lost_s"] = max(m[c].get("lost_s") or 0, lim_)
                        if z.get("wall_hit") and -0.2 <= z["wall_hit"]["dt"] <= 3.0 and z["wall_hit"]["drop_kmh"] >= WALLHIT:
                            m[c]["wheels_off_after"] = 4
                            m[c]["wheels_off_before"] = min(m[c].get("wheels_off_before", 0), 1)
                            m[c]["lost_s"] = max(m[c].get("lost_s") or 0, lim_)
            if HM:
                # round 10 (GreMi Texas #3 'hit Overfast hard'): a wrecked car, or one that never covered the next 300 m, lost a lot
                for m in ms:
                    hq = next((q for q in HM[n] if {q["a"], q["b"]} == {a, b} and abs(q["t"] - m["t"]) < 0.05), None)
                    if not hq:
                        continue
                    for c in (a, b):
                        z = hq.get(str(c))
                        if z and m[c].get("lost_s") is None and (z["t300"] is None or z["retired"]):
                            m[c]["lost_s"] = HARM_BIG
            prior = {}
            for ca, cb, ct in inc["contacts"]:
                if {ca, cb} != {a, b}:
                    for q in (ca, cb):
                        prior.setdefault(q, []).append(ct)
            wake = {a, b} if any(k != n and t - 3 <= ct < t and lp == ms[0]["lap"] and abs(dd - ms[0]["d"]) < 150
                                 for ct, _, _, lp, dd, k in allc) else set()
            # round 9 (GreMi Austria apple): a car still crawling after its own crash is still in that crash's wake
            for x in (a, b):
                if (ms[0][x].get("speed") or 999) < WAKE_V and any(k != n and t - WAKE_S <= ct < t - 0.5 and x in (ca, cb)
                                                                  for ct, ca, cb, lp, dd, k in allc):
                    wake.add(x)
            if FIN_NEAR and any(str(x) in fc and fc[str(x)] <= t + FIN_NEAR for x in (a, b)):
                o, note = {}, "nothing: at the finish line (the game takes over)"
            elif fz["chqf"] and t > fz["chqf"] and ms[0]["lap"] >= fz["laps"] and ms[0]["d"] < 0.25 * fz["len"]:
                o, note = {}, "nothing: after the finish (the game drives the car)"
            else:
                try:
                    o, note = judge_pair(inc, ms, a, b, inc["wet"], prior, wake)
                except Exception as ex:   # noqa: BLE001
                    o, note = {}, "not judged: %s" % ex
            if involved and t - t_first <= CHAIN_S:
                keep = {}
                for x, (s, why) in o.items():
                    oth = b if x == a else a
                    hit_before = any(t - 0.4 <= ct < t and oth in (ca, cb) and {ca, cb} != {a, b} for ct, ca, cb, _, _, _ in allc)
                    if s >= 10:
                        keep[x] = (s, why)
                        continue
                    y, yo = ms[0][x], ms[0][oth]
                    lim = 1.0 if ms[0]["lap"] == 1 else 0.5
                    hurt_o = (yo.get("lost_s") or 0) >= lim or (yo.get("wheels_off_after", 0) >= 2 and yo.get("wheels_off_before", 0) < 2)
                    # round 10 (GreMi Texas T1): a car in the first touch that was not hurt by it, not pushed by a third car,
                    # still drives its own race: its own later hit counts
                    if x in involved and x not in victims and not hit_before and hurt_o and x not in fault and (
                            s >= CHAIN_S4 or (y.get("toward_vs_line_before_m") or 0) >= CHAIN_M):
                        keep[x] = (s, why)
                        continue
                    # round 3 (GreMi Baku T1 vanderdeured 'a little at fault'): a new car joining the chain that clearly
                    # moves (3 m+) into a car and hurts it is a little at fault
                    if x not in involved and (y.get("toward_vs_line_before_m") or 0) >= 3 and hurt_o and not hit_before:
                        keep[x] = (2, why + " (joined the chain)")
                was = bool(o) or not note.startswith("nothing")
                o = keep
                if not o:
                    note = "aftermath of the first contact" + (", it cost time" if was else "")
            involved |= {a, b}
            for x in (a, b):
                lim_ = LIM1 if ms[0]["lap"] == 1 else LIM2
                if any((m[x].get("lost_s") or 0) >= lim_ or (m[x].get("wheels_off_after", 0) >= 2 and m[x].get("wheels_off_before", 0) < 2)
                       for m in ms):
                    victims.add(x)
            for x, (s, why) in o.items():
                if x not in fault or s > fault[x][0]:
                    fault[x] = (s, why)
            notes.append(note)
            if o:
                for x, (s, why) in o.items():
                    contacts.append({"a": a, "b": b, "t": t, "rule": "V17", "severity": s, "verdict": nm(x) + " at fault",
                                     "why": nm(x) + " " + why, "at_fault": x, "at_fault_all": [x]})
            else:
                r1 = note.startswith("nothing")
                contacts.append({"a": a, "b": b, "t": t, "rule": "R1" if r1 else "V17", "severity": 1,
                                 "verdict": "Not an incident" if r1 else "Racing incident", "why": note,
                                 "at_fault": None, "at_fault_all": []})
        sev = max([s for s, _ in fault.values()] or [1])
        own = [x for x in notes if not x.startswith("aftermath")]
        r1 = bool(own) and all(x.startswith("nothing") for x in own) and not any(x.endswith("cost time") for x in notes)
        verdict = (" + ".join(nm(x) for x in fault) + " at fault") if fault else ("Not an incident" if r1 else "Racing incident")
        why = "; ".join(nm(x) + " " + w for x, (s, w) in fault.items()) or (notes[0] if notes else "")
        cars = sorted(fault)
        res.append({"rule": "V17" if fault or not r1 else "R1", "severity": sev, "verdict": verdict, "why": why,
                    "at_fault": cars[0] if cars else None, "at_fault_all": cars, "contacts": contacts})
    return res
