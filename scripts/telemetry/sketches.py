#!/usr/bin/env python3
"""Top-down sketches of graded incidents for the staff page's "What I learned" (GreMi, 6 Nov 2026).

A sketch is a still picture of one contact: the track edges around it, the line of every car in it
from SKETCH_BEFORE s before to SKETCH_AFTER s after, each car where it was at the contact, the
contact point and the pedals of each car just before it ("look at the inputs"). Turned so the cars
drive up the picture. Coordinates are metres from the contact point, x right, y down (SVG).

Sketches are kept in CACHE/sketches/<key>.json (key = the precedent's key: a new call or a new
rulebook makes a new one), so a build only reads the recordings of new grades.

    sketch_all(cache, store) -> {precedent id: sketch}
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SKETCH_BEFORE = 3.0
SKETCH_AFTER = 1.5
STEP = 0.1
VERSION = 1
MARGIN_M = 12
BEFORE_M = 110       # keep this much of each line before the contact (the picture stays readable at speed)
AFTER_M = 55
WIDE_M = 60


def _rot(p, c, s):
    x, y = p
    return (round(x * c - y * s, 1), round(x * s + y * c, 1))


def sketch_one(sess, frames, race, pre):
    """The sketch of a precedent's main contact, or None."""
    import bisect
    import race_bundles as rb  # noqa: F401  (frames come from rb.frames_of)
    contacts = pre.get("contacts") or []
    if not contacts:
        return None
    # the contact that carries the call: the first one with a real label, else the first one
    main = next((c for c in contacts if c.get("label") not in ("no",)), contacts[0])
    t = main["t"]
    times = [x for x, _ in frames]

    def at(tt):
        k = min(max(bisect.bisect_left(times, tt), 0), len(frames) - 1)
        return frames[k][1]

    cars = list(dict.fromkeys([main["a"], main["b"]] + [c for c in pre.get("cars") or [] if c not in (main["a"], main["b"])]))[:4]
    now = at(t)
    cars = [c for c in cars if c in now]
    if len(cars) < 2:
        return None
    A, B = now[main["a"]], now[main["b"]]
    hit = ((A[0] + B[0]) / 2, (A[1] + B[1]) / 2)
    paths = {}
    for car in cars:
        pts = []
        k = 0
        while t - SKETCH_BEFORE + k * STEP <= t + SKETCH_AFTER + 1e-6:
            r = at(t - SKETCH_BEFORE + k * STEP).get(car)
            if r:
                pts.append((r[0] - hit[0], r[1] - hit[1]))
            k += 1
        paths[car] = pts
    # turn so the cars drive up the picture: direction of the first car over the last second
    p0, p1 = at(t - 1.0).get(main["a"]), now[main["a"]]
    if p0 and math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 3:
        ang = math.atan2(p1[1] - p0[1], p1[0] - p0[0])
    else:
        ang = p1[3]
    turn = -math.pi / 2 - ang          # rotate the travel direction onto (0, -1)
    c, s = math.cos(turn), math.sin(turn)
    out = {"v": VERSION, "t": round(t, 1), "cars": [], "track": None}
    xs, ys = [], []
    for car in cars:
        path = [q for q in (_rot(p, c, s) for p in paths[car]) if -AFTER_M <= q[1] <= BEFORE_M and abs(q[0]) <= WIDE_M]
        xs += [p[0] for p in path]
        ys += [p[1] for p in path]
        if not path:
            continue
        r = now[car]
        pre_ = at(t - 0.2).get(car) or r
        here = _rot((r[0] - hit[0], r[1] - hit[1]), c, s)
        out["cars"].append({"car": car, "path": path[::2] + ([path[-1]] if len(path) % 2 == 0 else []), "at": list(here),
                            "heading": round(math.degrees(r[3] + turn), 0),
                            "kmh": round(pre_[4]), "throttle": round(float(pre_[5]), 2), "brake": round(float(pre_[6]), 2),
                            "steer": round(float(pre_[7]), 2)})
    if not xs:
        return None
    if max(xs) - min(xs) < 40:   # at least 40 m wide, centred on the lines
        mid = (max(xs) + min(xs)) / 2
        xs += [mid - 20, mid + 20]
    box = (min(xs) - MARGIN_M, min(ys) - MARGIN_M, max(xs) + MARGIN_M, max(ys) + MARGIN_M)
    try:
        tr = None
        for car in cars:
            if car in race.arr:
                tr = race.track(car, t - 4, t + 4, hit, 70)
                if tr:
                    break
        if tr:
            G, N, L, R = tr[0], tr[1], tr[2], tr[3]
            edges = []
            for E in (G + N * L[:, None], G - N * R[:, None]):
                pts = [_rot((float(x) - hit[0], float(z) - hit[1]), c, s) for x, z in E]
                pts = [p for p in pts if box[0] - 20 <= p[0] <= box[2] + 20 and box[1] - 20 <= p[1] <= box[3] + 20]
                edges.append(pts[::2])
            if all(len(e) > 3 for e in edges):
                out["track"] = edges
    except Exception as ex:   # a sketch without edges is still a sketch
        print("sketch: no track edges:", ex)
    out["box"] = [round(v, 1) for v in box]
    return out


def sketch_all(cache, store, wanted=None):
    """Sketches for the precedents in the store (all, or the ids in `wanted`), kept in CACHE/sketches."""
    import gmtel
    import incident_replays
    import race_bundles as rb
    d = os.path.join(cache, "sketches")
    os.makedirs(d, exist_ok=True)
    out, todo = {}, {}
    for pid, p in (store.get("precedents") or {}).items():
        if wanted is not None and pid not in wanted:
            continue
        path = os.path.join(d, f"{p.get('key', pid)}-{VERSION}.json")
        if os.path.exists(path):
            try:
                out[pid] = json.load(open(path, encoding="utf-8"))
                continue
            except ValueError:
                pass
        todo.setdefault(p.get("recording"), []).append((pid, p, path))
    for rec, items in todo.items():
        f = os.path.join(cache, rec or "")
        if not rec or not os.path.exists(f):
            continue
        try:
            sess = gmtel.Session(f)
            frames = rb.frames_of(sess)
            race = incident_replays.Race(sess)
        except Exception as ex:
            print("sketch:", rec, "not readable:", ex)
            continue
        for pid, p, path in items:
            try:
                sk = sketch_one(sess, frames, race, p)
            except Exception as ex:
                print("sketch:", pid, ex)
                sk = None
            if sk:
                json.dump(sk, open(path, "w", encoding="utf-8"))
                out[pid] = sk
        del sess, frames, race
    return out


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    store = json.load(open(os.path.join(here, "..", "..", "grading", "precedents.json"), encoding="utf-8"))
    res = sketch_all(sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache", store, set(sys.argv[2:]) or None)
    print(len(res), "sketches")
    _ = np
