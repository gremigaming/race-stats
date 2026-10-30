#!/usr/bin/env python3
"""Rulebook v0: who is at fault in an incident, and how bad it was.

Calibrated with GreMi on 30 Oct 2026 from his grades of 20 incidents (batch 1). It replaces the
game's own collision calls, which are not used at all. Input is one incident from
race_bundles.incidents(); the first contact in it is the one that is judged (later contacts in a
chain are its consequences).

  R1  A contact that did no harm (nobody slid, lost a place or went off) is not an incident when
      it was a light touch: side by side, a tap from behind under TAP_KMH, or a move across
      under TAP_MOVE_M. R5 always applies.
  R2  Alongside (less than ALONGSIDE_M apart along the track): the car that kept moving across
      into the other is at fault, whichever one is ahead. Both or neither: racing incident.
  R3  One car clearly behind: the car behind is at fault when it closed in on the other
      (rear-ending under braking, a tap into the gearbox), unless the car ahead swept across
      into it (then R2: the car ahead).
  R4  A chain (CHAIN_CARS+ cars) started by a small error (low closing speed, nobody moving
      across) is a racing incident; otherwise the car that started it is at fault.
  R5  Rejoining the track (2+ wheels off, or far off the racing line) and moving across into a
      car is always the rejoining car's fault.
  R6  Contacts with AI cars don't count. "AI" means AI at the start of the race: the game also
      flags humans who quit as AI.

Severity 1-10: 1 for the contact, plus what it did (slides and spins, cars involved, places
lost, cars off track) and +1 when one driver is clearly at fault.

    python3 scripts/telemetry/verdicts.py FILE.gmtel.gz     # every incident in a race
"""
import bisect
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gmtel  # noqa: E402
import incident_replays  # noqa: E402
import race_bundles as rb  # noqa: E402

ALONGSIDE_M = 4.0    # less than this apart along the track = alongside (a car is ~5.6 m long)
MOVE_M = 1.0         # moving across this much in the last 1.2 s counts as moving into the other car
MOVE_MORE_M = 0.7    # ... and this much more than the other car did
SWEEP_M = 1.5        # the car ahead sweeping across this much into a car behind
CLOSING_KMH = 7      # the car behind closing in this fast = it ran into the other
SMALL_KMH = 15       # a chain started below this closing speed with nobody moving across = small error
CHAIN_CARS = 4
SLIP_HARM = 20       # a slide under this, no place lost, nobody off track = no harm done
TAP_KMH = 22         # harmless and closing slower than this = a tap, not an incident
TAP_MOVE_M = 2.5     # harmless and moved across less than this = a touch, not an incident
OFF_LINE_M = 3.0     # further than this outside the track's normal width = rejoining


def ai_at_start(path):
    """Cars that were AI in the first participants packet of the recording (before quitters turn AI)."""
    for h, body, kind in gmtel.records(path):
        if kind == 0 and h[5] == 4:
            return {i for i, p in gmtel.parse_participants(body).items() if p["ai"]}
    return set()


class Judge:
    def __init__(self, sess, frames, path):
        self.frames, self.times = frames, [t for t, _ in frames]
        self.track_len = sess.info.get("track_length", 0)
        self.race = incident_replays.Race(sess)
        self.ai = ai_at_start(path)
        self.slip = rb.slip_angles(frames)

    def at(self, t):
        k = min(max(bisect.bisect_left(self.times, t), 0), len(self.frames) - 1)
        return self.frames[k][1]

    def offset(self, track, car, t):
        """Metres from the reference line across the track (and the track's half width there)."""
        G, N, L, R, _ = track
        c = self.at(t).get(car)
        if not c:
            return None, None
        k, o = self.race.project(G, N, np.array([[c[0], c[1]]]))
        if not len(k):
            return None, None
        return float(o[0]), float(L[k[0]] if o[0] > 0 else R[k[0]])

    def contact(self, c):
        a, b, t = c["a"], c["b"], c["t"]
        A, B = self.at(t)[a], self.at(t)[b]
        mid = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
        track = None
        for i in (a, b):
            if i in self.race.arr:
                track = self.race.track(i, t - 4, t + 4, mid, 70)
                if track:
                    break
        f = {"a": a, "b": b}
        # along the track: + = a is ahead of b
        lap_m = lambda x: x[11] * self.track_len + x[10] if self.track_len else x[10]
        f["a_ahead_m"] = round(lap_m(self.at(t - 0.3)[a]) - lap_m(self.at(t - 0.3)[b]), 1)
        f["closing_a_kmh"] = 0   # how much faster a was than b, at most, in the 1.5 s before (+: a closing on b)
        for dt in (1.5, 1.2, 0.9, 0.6, 0.3):
            A0, B0 = self.at(t - dt).get(a), self.at(t - dt).get(b)
            if A0 and B0 and abs(A0[4] - B0[4]) > abs(f["closing_a_kmh"]):
                f["closing_a_kmh"] = A0[4] - B0[4]
        f["moved"], f["rejoin"] = {}, {}
        if track:
            oa, ob = self.offset(track, a, t - 0.3)[0], self.offset(track, b, t - 0.3)[0]
            for me, other, om, oo in ((a, b, oa, ob), (b, a, ob, oa)):
                o1, o0 = self.offset(track, me, t - 1.2)[0], self.offset(track, me, t)[0]
                side = 1 if (oo or 0) > (om or 0) else -1
                f["moved"][me] = round((o0 - o1) * side, 2) if o1 is not None and o0 is not None else 0.0
                # rejoining: off the track (or far off its normal width) in the 2.5 s before
                off = False
                for dt in (2.5, 2.0, 1.5, 1.0, 0.6):
                    o, half = self.offset(track, me, t - dt)
                    row = self.at(t - dt).get(me)
                    if (row and bin(row[9]).count("1") >= 2) or (o is not None and abs(o) > half + OFF_LINE_M):
                        off = True
                f["rejoin"][me] = off
        else:
            f["moved"] = {a: 0.0, b: 0.0}
            f["rejoin"] = {a: False, b: False}
        return f

    def effects(self, inc, cars):
        before, after = self.at(inc["t0"] - 1), self.at(inc["t1"] + 3)
        lost = max((after[i][12] - before[i][12] for i in cars if i in before and i in after), default=0)
        k0, k1 = bisect.bisect_left(self.times, inc["t0"]), bisect.bisect_right(self.times, inc["t1"] + 3)
        slide = max((self.slip.get((i, t), 0) for t, _ in self.frames[k0:k1] for i in cars), default=0)
        off = sum(1 for d in inc["drivers"] if d["car"] in cars and (d.get("role") == "off track" or d.get("surfaces")))
        return {"places_lost": max(lost, 0), "max_slide_deg": round(slide), "cars": len(inc["drivers"]), "off_track": off}

    def judge(self, inc, name=str):
        """The incident's verdict (its first contact with no AI car) plus one per contact."""
        per = []
        for c in inc["contacts"]:
            if c["a"] in self.ai or c["b"] in self.ai:
                per.append({"a": c["a"], "b": c["b"], "verdict": "Not counted (AI)", "at_fault": None, "rule": "R6", "severity": 1,
                            "why": "contact with an AI car"})
                continue
            first = not any(p["rule"] != "R6" for p in per)
            per.append(dict(self.judge_contact(inc, c, first, name), a=c["a"], b=c["b"]))
        main = next((p for p in per if p["rule"] != "R6"), per[0])
        return dict(main, contacts=per)

    def judge_contact(self, inc, c, first, name):
        f = self.contact(c)
        a, b = f["a"], f["b"]
        eff = self.effects(inc, (a, b))
        ma, mb = f["moved"].get(a, 0), f["moved"].get(b, 0)
        fault, rule, why = None, None, ""
        alongside = abs(f["a_ahead_m"]) < ALONGSIDE_M
        front, back = (a, b) if f["a_ahead_m"] > 0 else (b, a)
        closing = f["closing_a_kmh"] if back == a else -f["closing_a_kmh"]
        rej = [i for i in (a, b) if f["rejoin"].get(i) and f["moved"].get(i, 0) >= MOVE_M]
        if rej:
            fault, rule = rej[0], "R5"
            why = f"{name(rej[0])} came back onto the track and moved {f['moved'][rej[0]]:.1f} m across into {name(b if rej[0] == a else a)}"
        elif alongside and inc.get("kind") == "tap":
            return {"verdict": "Not an incident", "at_fault": None, "rule": "R1", "severity": 1,
                    "why": "light side-by-side contact, nobody slowed, slid or went off", "features": f, "effects": eff}
        elif alongside:
            if ma >= MOVE_M and ma - mb >= MOVE_MORE_M:
                fault = a
            elif mb >= MOVE_M and mb - ma >= MOVE_MORE_M:
                fault = b
            rule = "R2"
            why = (f"side by side; {name(fault)} moved {max(ma, mb):.1f} m across into the other car" if fault is not None
                   else f"side by side, both or neither moved across ({ma:.1f} m / {mb:.1f} m)")
        elif f["moved"].get(front, 0) >= SWEEP_M and f["moved"][front] > f["moved"].get(back, 0) + MOVE_MORE_M and closing < CLOSING_KMH:
            fault, rule = front, "R2"
            why = f"{name(front)} was ahead but swept {f['moved'][front]:.1f} m across into {name(back)}"
        elif closing >= CLOSING_KMH:
            fault, rule = back, "R3"
            why = f"{name(back)} ran into the back of {name(front)}, closing at {closing:.0f} km/h"
        elif inc.get("kind") == "tap":
            return {"verdict": "Not an incident", "at_fault": None, "rule": "R1", "severity": 1,
                    "why": f"light touch from behind ({closing:.0f} km/h), nobody slowed, slid or went off", "features": f, "effects": eff}
        else:
            rule = "R3"
            why = f"{name(back)} was behind but hardly closing ({closing:.0f} km/h)"
        harmless = eff["max_slide_deg"] <= SLIP_HARM and not eff["places_lost"] and not eff["off_track"]
        if harmless and ((rule == "R3" and fault is not None and closing < TAP_KMH) or (rule == "R2" and max(ma, mb) < TAP_MOVE_M)):
            return {"verdict": "Not an incident", "at_fault": None, "rule": "R1", "severity": 1,
                    "why": f"{why}, but nobody slid, lost a place or went off", "features": f, "effects": eff}
        if first and fault == back and rule == "R3" and eff["cars"] >= CHAIN_CARS and closing < SMALL_KMH and max(ma, mb) < MOVE_M:
            fault, rule = None, "R4"
            why = f"chain of {eff['cars']} cars started by a small error ({name(back)} closing at {closing:.0f} km/h)"
        sev = 1 + (2 if eff["max_slide_deg"] > 45 else 1 if eff["max_slide_deg"] > 20 else 0)
        sev += (2 if eff["places_lost"] >= 3 else 1 if eff["places_lost"] >= 1 else 0) + min(eff["off_track"], 2)
        sev += (1 if first and eff["cars"] >= CHAIN_CARS else 0) + (1 if fault is not None else 0)
        verdict = f"{name(fault)} at fault" if fault is not None else "Racing incident"
        return {"verdict": verdict, "at_fault": fault, "rule": rule, "severity": max(1, min(10, sev)), "why": why,
                "features": f, "effects": eff}


def judge_race(path):
    sess = gmtel.Session(path)
    frames = rb.frames_of(sess)
    gw = rb.ghosts([(t, a, b) for t, c in frames for a, b in rb.overlaps(c)], sess.collisions)
    incs = rb.incidents(frames, sess.collisions, sess.info.get("track_length", 0), gw)
    rb.add_surfaces(sess, incs)
    j = Judge(sess, frames, path)
    name = lambda i: f"#{sess.drivers[i]['race_number']} {sess.drivers[i]['name']}" if i in sess.drivers else f"car {i}"
    return sess, incs, [j.judge(inc, name) for inc in incs]


if __name__ == "__main__":
    sess, incs, vs = judge_race(sys.argv[1])
    for inc, v in zip(incs, vs):
        print(f"L{inc['lap']} {inc['t0']:7.1f}s {len(inc['drivers'])} cars  {v['rule']:3} sev {v['severity']:2}  {v['verdict']}: {v['why']}")
