"""Where the track is, from our own track maps (gremigaming/race-stats-maps).

Each map tile's `marks` layer clips the white lines to a polygon called "tarmac": the racing surface,
with the white lines on its edge. That polygon is drawn into a grid of RES metres, in the same world
x/z metres as the telemetry. A tyre is over the white line when its inner edge is outside the polygon.

GreMi's track limits (24 Nov 2026): a car is off the track only when all four tyres are fully over the
white line. Kerbs are outside the line, so riding them with up to three wheels is still on track.
Run-off tarmac past the line is off. Pit entry and exit lines are left out for now.

Maps come from TRACK_MAPS_DIR (a checkout of race-stats-maps) or from GitHub Pages, cached in
TRACK_MAPS_CACHE. No map for a track = None, and callers fall back to the game's surface data.
"""
import json
import math
import os
import re
import urllib.request

import numpy as np
from PIL import Image, ImageDraw

PAGES = "https://gremigaming.github.io/race-stats-maps/"
RES = 0.1            # metres per grid cell
TILE = 100.0         # metres per map tile (index.json says so too)
TYRE_HALF_M = 0.2    # wheel centre to the inner edge of the tyre
WHEELS = ((-1.9, -0.8), (-1.9, 0.8), (1.6, -0.8), (1.6, 0.8))   # rl rr fl fr: metres along / across (+ = right)

_CACHE = {}


def _norm(t):
    t = re.sub(r"reverse|manual|[^a-z]", "", t.lower())
    return "bahrain" if t == "sakhir" else t


def folder(index, track):
    """Track name ("Abu Dhabi", "Spa") to its map folder ("abu_dhabi", "spa_francorchamps"), like the site."""
    want, rev = _norm(track), bool(re.search("reverse", track, re.I))
    keys = [k for k in index if _norm(k) == want or want in _norm(k) or _norm(k) in want]
    return next((k for k in keys if bool(re.search("rev", k, re.I)) == rev), keys[0] if keys else None)


def _read(rel):
    local = os.environ.get("TRACK_MAPS_DIR")
    if local:
        p = os.path.join(local, rel)
        return open(p, encoding="utf-8").read() if os.path.exists(p) else None
    cache = os.environ.get("TRACK_MAPS_CACHE", os.path.join("cache", "track-maps"))
    p = os.path.join(cache, rel)
    if not os.path.exists(p):
        os.makedirs(os.path.dirname(p), exist_ok=True)
        try:
            req = urllib.request.Request(PAGES + rel, headers={"User-Agent": "race-stats"})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read().decode("utf-8")
        except Exception:
            return None
        with open(p + ".tmp", "w", encoding="utf-8") as fh:
            fh.write(data)
        os.replace(p + ".tmp", p)
    return open(p, encoding="utf-8").read()


def _subpaths(d):
    """'M x z L x z ... M ...' -> [[(x, z), ...], ...] (the maps only use M, L and Z)."""
    out = []
    for part in re.split(r"(?=M)", d):
        nums = [float(v) for v in re.findall(r"-?\d+(?:\.\d+)?(?:e-?\d+)?", part)]
        if len(nums) >= 6:
            out.append(list(zip(nums[0::2], nums[1::2])))
    return out


class TrackMap:
    bridges = ()

    def __init__(self, name, tiles, line=None):
        self.name, self.tiles = name, tiles      # (i, j) -> bool array [z, x], True = racing surface
        self.n = int(round(TILE / RES))
        self.line = line                         # racing line: [(x, z), ...] every ~0.5 m (the map's dark stripe)
        self._cells = None

    def to_line(self, x, z):
        """(metres to the map's racing line, nearest point index) or (None, None) when it is over 40 m away."""
        if self.line is None or not len(self.line):
            return None, None
        if self._cells is None:
            self._cells = {}
            for k, (a, b) in enumerate(self.line):
                self._cells.setdefault((int(a // 20), int(b // 20)), []).append(k)
        ks = [k for du in (-2, -1, 0, 1, 2) for dv in (-2, -1, 0, 1, 2)
              for k in self._cells.get((int(x // 20) + du, int(z // 20) + dv), ())]
        if not ks:
            return None, None
        q = self.line[ks]
        d = np.hypot(q[:, 0] - x, q[:, 1] - z)
        m = int(np.argmin(d))
        return float(d[m]), ks[m]

    def inside(self, x, z):
        """True where (x, z) is on the racing surface (arrays or scalars)."""
        x, z = np.asarray(x, float), np.asarray(z, float)
        i, j = np.floor(x / TILE).astype(int), np.floor(z / TILE).astype(int)
        cx = np.clip(((x - i * TILE) / RES).astype(int), 0, self.n - 1)
        cz = np.clip(((z - j * TILE) / RES).astype(int), 0, self.n - 1)
        out = np.zeros(np.broadcast(x, z).shape, bool)
        flat_i, flat_j = np.broadcast_to(i, out.shape), np.broadcast_to(j, out.shape)
        for key in set(zip(flat_i.ravel().tolist(), flat_j.ravel().tolist())):
            g = self.tiles.get(key)
            if g is None:
                continue
            m = (flat_i == key[0]) & (flat_j == key[1])
            out[m] = g[np.broadcast_to(cz, out.shape)[m], np.broadcast_to(cx, out.shape)[m]]
        return out

    def tyres_over(self, x, z, fx, fz):
        """How many tyres are fully over the white line (0-4), for a car at (x, z) pointing (fx, fz)."""
        n = math.hypot(fx, fz) or 1.0
        fx, fz = fx / n, fz / n
        px = [x + fx * a - fz * (c - math.copysign(TYRE_HALF_M, c)) for a, c in WHEELS]
        pz = [z + fz * a + fx * (c - math.copysign(TYRE_HALF_M, c)) for a, c in WHEELS]
        return int(4 - self.inside(px, pz).sum())

    def edges(self, G, N, reach=60.0):
        """For each point of a line G with normals N: metres to the white line on the + and - side.
        A point off the surface first looks for the surface along its normal (up to 20 m)."""
        s = np.arange(0, reach, RES)
        left, right = np.full(len(G), np.nan), np.full(len(G), np.nan)
        for k in range(len(G)):
            pl = self.inside(G[k, 0] + N[k, 0] * s, G[k, 1] + N[k, 1] * s)
            pr = self.inside(G[k, 0] - N[k, 0] * s, G[k, 1] - N[k, 1] * s)
            if not pl[0]:   # start on the surface: go to its nearest bit along the normal
                a = np.argmax(pl[:200]) if pl[:200].any() else None
                b = np.argmax(pr[:200]) if pr[:200].any() else None
                if a is None and b is None:
                    continue
                if b is None or (a is not None and a <= b):
                    e = np.argmin(pl[a:]) if not pl[a:].all() else len(pl) - a
                    left[k], right[k] = s[a] + e * RES, -s[a]
                else:
                    e = np.argmin(pr[b:]) if not pr[b:].all() else len(pr) - b
                    left[k], right[k] = -s[b], s[b] + e * RES
                continue
            left[k] = s[np.argmin(pl)] if not pl.all() else reach
            right[k] = s[np.argmin(pr)] if not pr.all() else reach
        return left, right


def load(track):
    """The TrackMap for a track name, or None when there is no map for it."""
    if not track:
        return None
    if track in _CACHE:
        return _CACHE[track]
    tm = None
    try:
        raw = _read("index.json")
        index = json.loads(raw) if raw else {}
        name = folder(index, track)
        if name:
            n = int(round(TILE / RES))
            tiles, line = {}, []
            over = _read(f"{name}/over.json")
            bridges = [o["bbox"] for o in (json.loads(over) if over else []) if o.get("kind") == "bridge" and o.get("length_m", 0) > 5]
            for t in index[name]["tiles"]:
                f = t["files"].get("marks")
                svg = _read(f"{name}/{f}") if f else None
                m = re.search(r'<clipPath id="tarmac">(.*?)</clipPath>', svg or "", re.S)
                if not m:
                    continue
                g = np.zeros((n, n), bool); anyof = np.zeros((n, n), bool)
                x0, z0 = t["i"] * TILE, t["j"] * TILE
                for d in re.findall(r'\bd="([^"]+)"', m.group(1)):
                    for poly in _subpaths(d):   # even-odd: every ring flips what it covers
                        im = Image.new("1", (n, n), 0)
                        ImageDraw.Draw(im).polygon([((x - x0) / RES, (z - z0) / RES) for x, z in poly], fill=1)
                        g ^= np.array(im, bool); anyof |= np.array(im, bool)
                # where the track crosses itself (Suzuka's bridge) the two road outlines overlap and even-odd turns the
                # crossing into a hole: inside a bridge's box, any outline counts as racing surface
                for b in bridges:
                    bx0, bz0, bx1, bz1 = [int(round(v)) for v in (((b[0] - x0) / RES), ((b[1] - z0) / RES), ((b[2] - x0) / RES), ((b[3] - z0) / RES))]
                    bx0, bz0, bx1, bz1 = max(bx0, 0), max(bz0, 0), min(bx1, n), min(bz1, n)
                    if bx0 < bx1 and bz0 < bz1:
                        g[bz0:bz1, bx0:bx1] |= anyof[bz0:bz1, bx0:bx1]
                tiles[(t["i"], t["j"])] = g
                # racing line: the first stroke of the soft dark stripe group, kept inside this tile
                rl = re.search(r'<g clip-path="url\(#tarmac\)" fill="none" stroke-linecap[^>]*>(.*?)</g>', svg, re.S)
                ds = re.findall(r'\bd="([^"]+)"', rl.group(1)) if rl else []
                for poly in (_subpaths(ds[0]) if ds else []):
                    for (xa, za), (xb, zb) in zip(poly, poly[1:]):
                        n_ = max(1, int(math.hypot(xb - xa, zb - za) / 0.5))
                        for f in range(n_):
                            x_, z_ = xa + (xb - xa) * f / n_, za + (zb - za) * f / n_
                            if x0 <= x_ < x0 + TILE and z0 <= z_ < z0 + TILE:
                                line.append((x_, z_))
            tm = TrackMap(name, tiles, np.array(line) if line else None) if tiles else None
            if tm:
                tm.bridges = bridges   # [x0, z0, x1, z1] of each bridge where the track crosses itself
    except Exception as ex:   # no map = the old way, never a failed build
        print("track map:", track, ex)
        tm = None
    _CACHE[track] = tm
    return tm
