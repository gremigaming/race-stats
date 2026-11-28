"""Engine v3 scene: one race rebuilt in track coordinates.

For every car and every sample: along-track position s (m on the lap), lateral position d (m, + = side the
track turns to when curvature > 0), white lines (from race-stats-maps) at that spot, heading vs the track,
slip angle, speed, throttle, brake, steer, tyres over the white line.
Field reference: median line of all racing laps (lap 2+, no pit) per 4 m bin, with the field's speed,
brake and throttle, and per car its own clean-lap profile (time, speed, brake) for consequences and
'late vs own' checks.
"""
import json, math, sys, os, collections
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'telemetry'))
_maps = os.path.join(HERE, '..', '..', '..', 'race-stats-maps')
if os.path.isdir(_maps):
    os.environ.setdefault('TRACK_MAPS_DIR', _maps)
import track_map

W = os.environ.get('STEWARD_WORK', '/tmp/ai-steward/') 
K = ['t', 'x', 'z', 'vx', 'vz', 'fx', 'fz', 'rx', 'rz', 'speed', 'throttle', 'brake', 'steer', 'lap', 'lap_distance',
     'total_distance', 'position', 'pit_status', 'driver_status', 'result_status', 's_rl', 's_rr', 's_fl', 's_fr']
I = {k: i for i, k in enumerate(K)}
BIN = 4.0
HALF_W, HALF_L = 0.97, 2.55     # body box calibrated from the game's contact events


def wrap(ds, L):
    return (ds + L / 2) % L - L / 2


class Race:
    def __init__(self, rec):
        self.rec = rec
        z = np.load(W + 'npz/' + rec + '_Race.npz')
        self.m = json.load(open(W + 'npz/' + rec + '_Race.json'))
        self.raw = {int(k): z[k] for k in z.files}
        self.drivers = {int(k): v for k, v in self.m['drivers'].items()}
        self.L = float(self.m['info'].get('track_length') or 5000)
        self.track = self.m['info'].get('track')
        self.nb = int(self.L // BIN) + 1
        self._ref()
        self._edges()
        self.cars = {c: self._car(c, a) for c, a in self.raw.items() if len(a) > 50}
        self._profiles()
        self._corners()

    # ---------- field line ----------
    def _ref(self):
        acc = collections.defaultdict(list)
        for c, a in self.raw.items():
            ok = (a[:, I['lap']] >= 2) & (a[:, I['pit_status']] == 0) & (a[:, I['speed']] > 40) & (a[:, I['lap_distance']] >= 0)
            for r in a[ok]:
                acc[int(r[I['lap_distance']] // BIN) % self.nb].append(r)
        nb = self.nb; R = np.full((nb, 6), np.nan)
        for j in range(nb):
            rs = acc.get(j)
            if not rs or len(rs) < 3: continue
            rs = np.array(rs)
            R[j] = [np.median(rs[:, I[k]]) for k in ('x', 'z', 'speed', 'steer', 'throttle', 'brake')]
        for col in range(6):
            v = R[:, col]; g = ~np.isnan(v)
            R[:, col] = np.interp(np.arange(nb), np.where(g)[0], v[g], period=nb)
        for col in (0, 1, 2):
            v = R[:, col]; k = 5
            R[:, col] = np.convolve(np.concatenate([v[-k:], v, v[:k]]), np.ones(2 * k + 1) / (2 * k + 1), 'same')[k:-k]
        tx = np.roll(R[:, 0], -1) - np.roll(R[:, 0], 1); tz = np.roll(R[:, 1], -1) - np.roll(R[:, 1], 1)
        n = np.hypot(tx, tz) + 1e-9
        self.R, self.tx, self.tz = R, tx / n, tz / n
        hd = np.unwrap(np.arctan2(self.tz, self.tx))
        cv = (np.roll(hd, -3) - np.roll(hd, 3)); cv = (cv + np.pi) % (2 * np.pi) - np.pi
        self.curv = cv / (6 * BIN)

    def _edges(self):
        self.tm = track_map.load(self.track)
        self.eL = np.full(self.nb, 7.0); self.eR = np.full(self.nb, 7.0); self.has_map = False
        if self.tm is None: return
        G = self.R[:, :2]; N = np.stack([-self.tz, self.tx], 1)
        l, r = self.tm.edges(G, N, reach=40.0)
        ok = ~np.isnan(l) & ~np.isnan(r)
        if ok.sum() > self.nb * 0.5:
            self.eL = np.interp(np.arange(self.nb), np.where(ok)[0], l[ok], period=self.nb)
            self.eR = -np.interp(np.arange(self.nb), np.where(ok)[0], r[ok], period=self.nb)   # d of right line (negative)
            self.has_map = True

    def locate(self, x, z, hint):
        nb = self.nb; j0 = (hint // BIN).astype(int)
        offs = np.arange(-25, 26)
        js = (j0[:, None] + offs[None, :]) % nb
        dx = self.R[js, 0] - x[:, None]; dz = self.R[js, 1] - z[:, None]
        k = np.argmin(dx * dx + dz * dz, 1); j = js[np.arange(len(x)), k]
        ex, ez = x - self.R[j, 0], z - self.R[j, 1]
        d = self.tx[j] * ez - self.tz[j] * ex
        s = j * BIN + self.tx[j] * ex + self.tz[j] * ez
        return j, s % self.L, d

    def _car(self, c, a):
        a = a[np.argsort(a[:, 0])]
        hint = np.where(a[:, I['lap_distance']] >= 0, a[:, I['lap_distance']], a[:, I['lap_distance']] + self.L)
        j, s, d = self.locate(a[:, I['x']], a[:, I['z']], np.nan_to_num(hint))
        lap = a[:, I['lap']].copy()
        # lap-consistent progress: s near the line can be on the other side of 0 vs lap_distance
        ld = np.nan_to_num(hint)
        corr = np.where(s - ld > self.L / 2, -self.L, np.where(ld - s > self.L / 2, self.L, 0))
        S = (lap - 1) * self.L + s + corr
        fx, fz, vx, vz = a[:, I['fx']], a[:, I['fz']], a[:, I['vx']], a[:, I['vz']]
        head = np.degrees(np.arctan2(self.tx[j] * fz - self.tz[j] * fx, self.tx[j] * fx + self.tz[j] * fz))
        v = np.hypot(vx, vz)
        slip = np.where(v > 5, np.degrees(np.arctan2(fx * vz - fz * vx, fx * vx + fz * vz)), 0)
        return dict(t=a[:, 0], x=a[:, I['x']], z=a[:, I['z']], fx=fx, fz=fz, vx=vx, vz=vz, j=j, s=s, d=d, S=S, lap=lap,
                    v=a[:, I['speed']], thr=a[:, I['throttle']], brk=a[:, I['brake']], steer=a[:, I['steer']],
                    pit=a[:, I['pit_status']], head=head, slip=slip, pos=a[:, I['position']],
                    res=a[:, I['result_status']], surf=a[:, I['s_rl']:I['s_fr'] + 1])

    # ---------- own / field profiles ----------
    def _profiles(self):
        """per car: clean laps -> per-bin time-on-lap (median), speed; per-bin field lateral samples for expected lines"""
        self.own = {}; self.lapD = []   # lapD rows: (car, lap, D[nb]) lateral per bin
        nb = self.nb
        for c, C in self.cars.items():
            T, V, B = [], [], []
            for lp in np.unique(C['lap']):
                if lp < 2: continue
                m = (C['lap'] == lp)
                if m.sum() < 30 or (C['pit'][m] > 0).any(): continue
                ss = C['S'][m] - (lp - 1) * self.L; tt = C['t'][m]
                o = np.argsort(ss); ss, tt = ss[o], tt[o]
                if ss[0] > 30 or ss[-1] < self.L - 30: continue
                bins = np.arange(nb) * BIN
                ti = np.interp(bins, ss, tt - tt[0]); vi = np.interp(bins, ss, C['v'][m][o]); bi = np.interp(bins, ss, C['brk'][m][o])
                di = np.interp(bins, ss, C['d'][m][o])
                if ti[-1] > 400 or np.max(np.diff(ti)) > 5: continue
                T.append(ti); V.append(vi); B.append(bi); self.lapD.append((c, int(lp), di))
            if T:
                self.own[c] = dict(T=np.median(T, 0), V=np.median(V, 0), B=np.median(B, 0), n=len(T), laps=np.array(V))
        if self.lapD:
            self.D = np.array([r[2] for r in self.lapD]); self.Dkey = [(r[0], r[1]) for r in self.lapD]
        else:
            self.D = np.zeros((0, nb)); self.Dkey = []
        allT = [o['T'] for o in self.own.values()]
        self.fieldT = np.median(allT, 0) if allT else None
        # lap 1: per-car time at each bin on lap 1 (segment times compared with the field's lap 1)
        L1 = []
        for c, C in self.cars.items():
            m = (C['lap'] == 1) & (C['S'] >= 0)
            if m.sum() < 30: continue
            ss = C['S'][m]; tt = C['t'][m]; o = np.argsort(ss); ss, tt = ss[o], tt[o]
            if ss[-1] < self.L - 30: continue
            L1.append(np.interp(np.arange(nb) * BIN, ss, tt, left=np.nan))
        self.lap1T = np.array(L1) if L1 else None

    def _corners(self):
        """corners from the field speed: apex = local min with a drop of >= 25 km/h from the max in the 400 m before"""
        v = self.R[:, 2]; nb = self.nb; ap = []
        for j in range(nb):
            w = [(j + o) % nb for o in range(-6, 7)]
            if v[j] != min(v[w]): continue
            back = [(j - o) % nb for o in range(0, int(400 / BIN))]
            vmax = max(v[back])
            if vmax - v[j] >= 25: ap.append(j)
        # merge apexes closer than 60 m
        out = []
        for j in sorted(ap):
            if out and (j - out[-1]) * BIN < 60:
                if v[j] < v[out[-1]]: out[-1] = j
            else: out.append(j)
        if len(out) > 1 and (out[0] + nb - out[-1]) * BIN < 60: out.pop()
        self.apex = out
        # brake point of the field for each corner: first bin in the 450 m before the apex where field brake > 0.15
        self.cbrake = {}
        for j in out:
            bp = None
            prev = [p for p in out if 0 < ((j - p) % nb) * BIN < 450]
            reach = min([((j - p) % nb) * BIN - 30 for p in prev] + [450])
            for o in range(int(reach / BIN), 0, -1):
                q = (j - o) % nb
                if self.R[q, 5] > 0.15: bp = q; break
            self.cbrake[j] = bp
        self.turn = {}
        for j in out:
            jj = np.arange(j - 10, j + 11) % nb
            self.turn[j] = float(np.sum(self.curv[jj]) * BIN)

    def corner_of(self, j):
        """the corner (apex bin) this spot belongs to: the next apex within 250 m, else the last one within 150 m"""
        nb = self.nb; best = None
        for a in self.apex:
            dd = ((a - j + nb // 2) % nb - nb // 2) * BIN   # apex relative to j (+ ahead)
            if -150 <= dd <= 300:
                if best is None or (dd >= -40 and (best[1] < -40 or dd < best[1])) or (best[1] < -40 and dd > best[1]):
                    best = (a, dd)
        return best

    # ---------- helpers ----------
    def at(self, c, t, key):
        C = self.cars[c]; return np.interp(t, C['t'], C[key])

    def idx(self, c, t):
        C = self.cars[c]; k = int(np.searchsorted(C['t'], t)); return min(max(k, 0), len(C['t']) - 1)

    def name(self, c):
        d = self.drivers.get(c, {}); return f"#{d.get('race_number')} {d.get('name')}"

    def tyres_over(self, c, t):
        if self.tm is None: return None
        x, z, fx, fz = (self.at(c, t, k) for k in ('x', 'z', 'fx', 'fz'))
        return self.tm.tyres_over(float(x), float(z), float(fx), float(fz))

    def white(self, j):
        return float(self.eL[j % self.nb]), float(self.eR[j % self.nb])


def box(x, z, fx, fz, mx=0.0):
    n = math.hypot(fx, fz) or 1.0; fx, fz = fx / n, fz / n
    rx, rz = -fz, fx
    hl, hw = HALF_L + mx, HALF_W + mx
    return np.array([[x + fx * a * hl + rx * b * hw, z + fz * a * hl + rz * b * hw] for a, b in ((1, 1), (1, -1), (-1, -1), (-1, 1))])


def gap(b1, b2):
    """separating-axis gap between two rectangles (m, <=0 = overlapping)"""
    best = -1e9
    for P, Q in ((b1, b2), (b2, b1)):
        for k in range(2):
            e = P[k + 1] - P[k]; nrm = np.array([-e[1], e[0]]); nrm /= (np.hypot(*nrm) + 1e-9)
            p = P @ nrm; q = Q @ nrm
            g = max(q.min() - p.max(), p.min() - q.max())
            best = max(best, g)
    return best


_RC = {}
def race(rec):
    if rec not in _RC:
        _RC.clear(); _RC[rec] = Race(rec)
    return _RC[rec]
