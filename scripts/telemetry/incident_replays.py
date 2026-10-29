"""Overhead replays of the contacts on the safety rating page.

Runs in site.yml after safety_rating.py. For every contact item in
public/league/safety.json it finds the recording of that race in the
"telemetry" release (TelemetryRecorder.cs keeps every car's position 10 times a
second, 30 around each contact), cuts out the seconds around the contact and
writes public/league/replays/<id>.json. The item gets "replay": <id>, which
SafetyPersonal.tsx shows as an overhead animation. No track map is needed: the
track around the contact is drawn from where all cars drove in that race, and
kerbs from where their wheels touched one. Everything is code, no manual work.

    python3 scripts/telemetry/incident_replays.py /tmp/telemetry-cache
"""
import collections
import hashlib
import json
import math
import os
import re
import shutil
import sys
import urllib.request

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gmtel  # noqa: E402

RELEASE = "https://api.github.com/repos/gremigaming/race-stats/releases/tags/telemetry"
DOWNLOAD = "https://github.com/gremigaming/race-stats/releases/download/telemetry/"
LEAGUE = os.path.join("public", "league")
BEFORE, AFTER, FPS = 3.0, 2.5, 30
MARGIN = 40.0          # metres of track drawn around the pair's path
VERSION = 4            # bump to rebuild every replay


def http_json(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "race-stats"}
    if os.environ.get("GITHUB_TOKEN"):   # unauthenticated calls share 60/hour per runner IP and run out
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(DOWNLOAD + name, path + ".tmp")
        os.replace(path + ".tmp", path)
    return path


def day_of(file):
    m = re.search(r"(\d{4})_(\d{2})_(\d{2})_", file)
    return f"{m[1]}-{m[2]}-{m[3]}" if m else None


def has_field(path):
    """True when the recording has rows for every car (a cheap scan, a full parse can take GBs)."""
    return any(kind == 2 for _, _, kind in gmtel.records(path))


def offset(png, sess):
    """Seconds to add to recording time to get the race file's clock, from the contacts both saw."""
    cols = [m for m in png.get("race-control") or [] if m.get("message-type") == "COLLISION"]
    gm = sess.collisions
    if not cols or not gm:
        return None, 0
    cands = [c["timestamp"] - g["t"] for c in cols for g in gm
             if set(c.get("involved-drivers") or []) == {g["a"], g["b"]}]
    best, hits = None, 0
    for o in cands:
        n = sum(any(abs(c["timestamp"] - o - g["t"]) < 0.6 and set(c["involved-drivers"]) == {g["a"], g["b"]} for g in gm) for c in cols)
        if n > hits:
            best, hits = o, n
    return best, hits / len(cols)


def smooth(T, Y, sig, grid):
    """Local linear regression with a Gaussian window: removes timing jitter, keeps the path."""
    out = np.full((len(grid), Y.shape[1]), np.nan)
    for k, tg in enumerate(grid):
        w = np.exp(-((T - tg) / sig) ** 2 / 2)
        m = w > 1e-3
        if m.sum() < 3 or T[m].min() > tg or T[m].max() < tg:
            continue
        X = np.c_[np.ones(m.sum()), T[m] - tg]
        W = w[m]
        A = X.T @ (X * W[:, None])
        b = X.T @ (Y[m] * W[:, None])
        out[k] = np.linalg.solve(A, b)[0]
    return out


def gsm(a, sig):
    k = np.arange(-3 * sig, 3 * sig + 1)
    w = np.exp(-k ** 2 / (2 * sig ** 2))
    w /= w.sum()
    n = len(k)
    return np.convolve(np.r_[[a[0]] * n, a, [a[-1]] * n], w, "same")[n:-n]


class Race:
    def __init__(self, sess):
        self.s = sess
        self.pos = collections.defaultdict(list)    # car -> [(t, x, z, fx, fz)]
        self.kerb = []                              # (t, x, z) of rows with a wheel on a kerb
        self.inp = collections.defaultdict(list)    # car -> [(t, speed, throttle, brake, steer, gear)]
        self.place = collections.defaultdict(list)  # car -> [(t, race position)]
        for t in sorted(sess.field):
            for i, r in sess.field[t].items():
                if "x" in r:
                    self.pos[i].append((t, r["x"], r["z"], r["fx"], r["fz"]))
                if "throttle" in r:
                    self.inp[i].append((t, r["speed"], r["throttle"], r["brake"], r["steer"], r["gear"]))
                if "position" in r:
                    self.place[i].append((t, r["position"]))
        last = {}
        for t in sorted(sess.field):
            for i, r in sess.field[t].items():
                if "x" in r:
                    last[i] = (r["x"], r["z"])
                if any(r.get("surface_" + w) == 1 for w in ("rl", "rr", "fl", "fr")) and i in last:
                    self.kerb.append((t, *last[i]))
        self.arr = {i: np.array(v) for i, v in self.pos.items() if len(v) > 20}

    def track(self, a, t0, t1, c, rad):
        """Track edges around point c: the reference is car a's path on another lap, the width comes from where every car drove."""
        P = self.arr[a]
        near = (np.hypot(P[:, 1] - c[0], P[:, 2] - c[1]) < rad * 1.3) & ((P[:, 0] < t0 - 15) | (P[:, 0] > t1 + 15))
        idx = np.nonzero(near)[0]
        if len(idx) < 10:
            return None
        passes = np.split(idx, np.nonzero(np.diff(idx) > 1)[0] + 1)
        ref = max(passes, key=len)
        R = P[ref][:, 1:3]
        d = np.r_[0, np.cumsum(np.hypot(*np.diff(R, axis=0).T))]
        if d[-1] < 40:
            return None
        sd = np.arange(0, d[-1], 1.0)
        G = np.c_[np.interp(sd, d, R[:, 0]), np.interp(sd, d, R[:, 1])]
        G = np.c_[gsm(G[:, 0], 4), gsm(G[:, 1], 4)]
        T = np.gradient(G, axis=0)
        T /= np.linalg.norm(T, axis=1)[:, None]
        N = np.c_[-T[:, 1], T[:, 0]]
        pts = np.concatenate([v[(np.hypot(v[:, 1] - c[0], v[:, 2] - c[1]) < rad * 1.4) & ((v[:, 0] < t0 - 10) | (v[:, 0] > t1 + 10))][:, 1:3]
                              for v in self.arr.values()])
        if len(pts) < 150:
            return None
        k, o = self.project(G, N, pts)
        left, right = np.full(len(G), np.nan), np.full(len(G), np.nan)
        for b in range(0, len(G), 3):
            m = (k >= b - 4) & (k < b + 7) & (np.abs(o) < 16)   # not a parallel bit of track nearby
            if m.sum() < 15:
                continue
            left[b:b + 3] = np.percentile(o[m], 97) + 1.1
            right[b:b + 3] = -np.percentile(o[m], 3) + 1.1
        for e in (left, right):
            bad = np.isnan(e)
            if bad.all():
                return None
            e[bad] = np.interp(np.nonzero(bad)[0], np.nonzero(~bad)[0], e[~bad])
            e[:] = gsm(np.maximum(e, 4.5), 4)
        # kerbs: stretches where cars ran with a wheel on a kerb near an edge
        kerbs = []
        if self.kerb:
            K = np.array(self.kerb)
            K = K[(np.hypot(K[:, 1] - c[0], K[:, 2] - c[1]) < rad * 1.4) & ((K[:, 0] < t0 - 10) | (K[:, 0] > t1 + 10))]
            if len(K):
                kk, ko = self.project(G, N, K[:, 1:3])
                for side, e in ((1, left), (-1, right)):
                    hit = np.zeros(len(G), bool)
                    for i_, o_ in zip(kk, ko):
                        if 0 <= i_ < len(G) and o_ * side > e[i_] - 3.5:
                            hit[max(0, i_ - 2):i_ + 3] = True
                    runs, start = [], None
                    for j in range(len(G) + 1):
                        on = j < len(G) and hit[j]
                        if on and start is None:
                            start = j
                        if not on and start is not None:
                            runs.append([start, j - 1])
                            start = None
                    merged = []
                    for r in runs:
                        if merged and r[0] - merged[-1][1] <= 8:
                            merged[-1][1] = r[1]
                        else:
                            merged.append(r)
                    for a_, b_ in merged:
                        if b_ - a_ >= 6:
                            kerbs.append((side, a_, b_))
        return G, N, left, right, kerbs

    @staticmethod
    def project(G, N, pts):
        cell = collections.defaultdict(list)
        for j, (x, z) in enumerate(G):
            cell[(int(x // 10), int(z // 10))].append(j)
        k = np.full(len(pts), -1)
        o = np.zeros(len(pts))
        for n, (x, z) in enumerate(pts):
            c = [j for du in (-1, 0, 1) for dv in (-1, 0, 1) for j in cell.get((int(x // 10) + du, int(z // 10) + dv), ())]
            if not c:
                continue
            q = G[c]
            j = c[int(np.argmin(np.sum((q - [x, z]) ** 2, 1)))]
            k[n] = j
            o[n] = (np.array([x, z]) - G[j]) @ N[j]
        ok = k >= 0
        return k[ok], o[ok]

    def replay(self, inc, off, names):
        a, b = inc["pair"]
        t0, t1 = inc["t"] - off, inc["te"] - off
        if a not in self.arr or b not in self.arr:
            return None
        grid = np.round(np.arange(t0 - BEFORE, min(t1, t0 + 4) + AFTER, 1 / FPS), 3)
        cars = {}
        for i, P in self.arr.items():
            m = (P[:, 0] > grid[0] - 1) & (P[:, 0] < grid[-1] + 1)
            if m.sum() < 5:
                continue
            Q = P[m]
            ps = smooth(Q[:, 0], Q[:, 1:3], 0.07, grid)
            fs = smooth(Q[:, 0], Q[:, 3:5], 0.07, grid)
            cars[i] = (ps, fs)
        if a not in cars or b not in cars:
            return None
        ka = int(np.argmin(np.abs(grid - t0)))
        if np.isnan(cars[a][0][ka]).any() or np.isnan(cars[b][0][ka]).any():
            return None
        c = (cars[a][0][ka] + cars[b][0][ka]) / 2
        # keep cars that come within 60 m of the contact
        cars = {i: v for i, v in cars.items() if i in (a, b) or np.nanmin(np.hypot(v[0][:, 0] - c[0], v[0][:, 1] - c[1])) < 60}
        # view: contact in the middle, the pair's direction of travel pointing up
        fx, fz = cars[a][1][ka] + cars[b][1][ka]
        rot = -math.pi / 2 - math.atan2(fz, fx)
        cr, sr = math.cos(rot), math.sin(rot)

        def tf(x, z):
            x, z = x - c[0], z - c[1]
            return x * cr - z * sr, x * sr + z * cr

        def pt(x, z):
            u, v = tf(x, z)
            return [round(u, 2), round(v, 2)]

        frames = []
        for n in range(len(grid)):
            fr = []
            for i, (ps, fs) in cars.items():
                if np.isnan(ps[n]).any() or np.isnan(fs[n]).any():
                    continue
                u, v = tf(*ps[n])
                h = math.atan2(fs[n][0] * sr + fs[n][1] * cr, fs[n][0] * cr - fs[n][1] * sr)
                fr.append([i, round(u, 2), round(v, 2), round(h, 3)])
            frames.append(fr)
        contacts = []
        for g in self.s.collisions:
            if grid[0] <= g["t"] <= grid[-1] and {g["a"], g["b"]} & {a, b}:
                n = int(np.argmin(np.abs(grid - g["t"])))
                pa, pb = cars.get(g["a"]), cars.get(g["b"])
                if pa is None or pb is None or np.isnan(pa[0][n]).any() or np.isnan(pb[0][n]).any():
                    continue
                m = (pa[0][n] + pb[0][n]) / 2
                contacts.append({"f": n, "at": pt(*m)})
        # inputs of the pair, 10 times a second (frame 3k of the replay), for the data panel
        step = FPS // 10
        sub = grid[::step]
        inputs = {}
        for car in (a, b):
            rows = np.array(self.inp.get(car) or [])
            if len(rows) < 5:
                continue
            m = (rows[:, 0] > sub[0] - 1) & (rows[:, 0] < sub[-1] + 1)
            if m.sum() < 5:
                continue
            R = rows[m]

            def lin(col, nd=0):
                v = np.interp(sub, R[:, 0], R[:, col])
                return [round(float(x), nd) if nd else int(round(float(x))) for x in v]
            near = np.abs(R[:, 0][None, :] - sub[:, None]).argmin(1)
            inputs[str(car)] = {"spd": lin(1), "thr": lin(2, 2), "brk": lin(3, 2), "str": lin(4, 2),
                                "gear": [int(R[k, 5]) for k in near]}
            pl = self.place.get(car)
            if pl:
                P = np.array(pl)
                inputs[str(car)]["pos"] = int(P[np.abs(P[:, 0] - grid[ka]).argmin(), 1])
        out = {"v": VERSION, "fps": FPS, "contact": ka, "pair": [a, b], "names": {str(a): names[0], str(b): names[1]},
               "frames": frames, "contacts": contacts, "inputs": inputs, "inputStep": step,
               # world centre and rotation, to put the game track map (public/trackmaps) under the replay
               "world": {"c": [round(float(c[0]), 2), round(float(c[1]), 2)], "rot": round(rot, 5)}}
        path = np.r_[cars[a][0], cars[b][0]]
        path = path[~np.isnan(path).any(1)]
        rad = min(float(np.hypot(path[:, 0] - c[0], path[:, 1] - c[1]).max()) + MARGIN, 300)
        tr = self.track(a, t0, t1, c, rad)
        if tr:
            G, N, left, right, kerbs = tr
            keep = np.array([np.hypot(path[:, 0] - x, path[:, 1] - z).min() < MARGIN for x, z in G])
            if keep.sum() > 20:
                j0, j1 = np.nonzero(keep)[0][[0, -1]]
                sl = slice(j0, j1 + 1)
                L = G[sl] + N[sl] * left[sl][:, None]
                Rr = G[sl] - N[sl] * right[sl][:, None]
                out["track"] = {"l": [v for p in L for v in pt(*p)], "r": [v for p in Rr for v in pt(*p)]}
                ks = []
                for side, ka_, kb_ in kerbs:
                    ka_, kb_ = max(ka_, j0), min(kb_, j1)
                    if kb_ - ka_ < 4:
                        continue
                    e = left if side > 0 else right
                    js = np.arange(ka_, kb_ + 1)
                    inner = G[js] + side * N[js] * e[js][:, None]
                    outer = G[js] + side * N[js] * (e[js] + 1.2)[:, None]
                    ks.append([v for p in np.r_[inner, outer[::-1]] for v in pt(*p)])
                out["track"]["kerbs"] = ks
        return out


def main():
    cache = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(LEAGUE, "safety.json")
    data = json.load(open(path))
    todo = collections.defaultdict(list)
    for d in data["drivers"]:
        for s in d["sessions"]:
            for it in s["items"]:
                if it.get("inc"):
                    todo[s["file"]].append(it)
    # every collision for the Incidents tab, also the ones that cost nobody points
    ipath = os.path.join(LEAGUE, "incidents.json")
    incs = json.load(open(ipath)) if os.path.exists(ipath) else {"incidents": []}
    for it in incs["incidents"]:
        todo[it["file"]].append(it)
    try:
        assets = sorted(a["name"] for a in http_json(RELEASE)["assets"] if a["name"].endswith(".gmtel.gz"))
    except Exception as ex:
        print("telemetry release not reachable:", ex)
        assets = []
    outdir = os.path.join(LEAGUE, "replays")
    os.makedirs(os.path.join(cache, "replays"), exist_ok=True)
    os.makedirs(outdir, exist_ok=True)
    idx_path = os.path.join(cache, "replay-index.json")    # recordings known to hold no field rows
    try:
        index = json.load(open(idx_path))
    except Exception:
        index = {}
    made = 0
    pending = {}
    for file, items in sorted(todo.items()):
        left = []
        for it in items:
            inc = it["inc"]
            rid = hashlib.sha1(f"{file}|{inc['t']:.2f}|{sorted(inc['pair'])}|{VERSION}".encode()).hexdigest()[:12]
            kept = os.path.join(cache, "replays", rid + ".json")   # replays are kept between builds
            if os.path.exists(kept):
                shutil.copy(kept, os.path.join(outdir, rid + ".json"))
                it["replay"] = rid
            else:
                left.append((it, rid))
        if left:
            pending[file] = left
    by_day = collections.defaultdict(list)
    for file in pending:
        by_day[day_of(file)].append(file)
    for day, files in sorted(by_day.items()):
        if not day:
            continue
        pngs = {}
        for file in files:
            sp = os.path.join(LEAGUE, "sessions", file if file.endswith(".json") else file + ".json")
            if os.path.exists(sp):
                pngs[file] = json.load(open(sp))
        if not pngs:
            continue
        cands = [n for n in assets if n.startswith(day) and index.get(n) is not False]
        best = {}    # file -> (share, asset, offset)
        for n in cands:
            try:
                if index.get(n) is None:
                    index[n] = has_field(download(n, cache))
                if not index[n]:
                    continue
                sess = gmtel.Session(download(n, cache))
            except Exception as ex:
                print("  skipped", n, ex)
                continue
            for file, png in pngs.items():
                o, share = offset(png, sess)
                if o is not None and share >= 0.5 and share > best.get(file, (0,))[0]:
                    best[file] = (share, n, o)
            del sess
        for n in sorted({b[1] for b in best.values()}):
            race = Race(gmtel.Session(download(n, cache)))
            for file, (share, bn, off) in best.items():
                if bn != n:
                    continue
                print(file, "<-", n, f"({share:.0%} of contacts matched)")
                for it, rid in pending[file]:
                    try:
                        r = race.replay(it["inc"], off, it["inc"]["names"])
                    except Exception as ex:
                        print("  replay failed:", ex)
                        r = None
                    if not r:
                        continue
                    # team of every car, for the car drawings (public/cars)
                    r["teams"] = {str(c["index"]): (c.get("participant-data") or {}).get("team-id") or c.get("team")
                                  for c in pngs[file].get("classification-data") or []}
                    out_path = os.path.join(outdir, rid + ".json")
                    json.dump(r, open(out_path, "w"), separators=(",", ":"))
                    shutil.copy(out_path, os.path.join(cache, "replays", rid + ".json"))
                    it["replay"] = rid
                    made += 1
            del race
        for file in files:
            if file not in best:
                print(file, ": no recording with every car")
    json.dump(index, open(idx_path, "w"))
    for d in data["drivers"]:
        for s in d["sessions"]:
            for it in s["items"]:
                it.pop("inc", None)
    json.dump(data, open(path, "w"), separators=(",", ":"))
    for it in incs["incidents"]:
        it.pop("inc", None)
    json.dump(incs, open(ipath, "w"), separators=(",", ":"))
    print("replays written:", made)


if __name__ == "__main__":
    main()
