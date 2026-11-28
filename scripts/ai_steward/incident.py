"""Engine v3: rebuild one incident completely.

scene -> every touch between the involved cars (body boxes at 20 Hz) + nearby cars -> per touch:
geometry (who is ahead, overlap in metres, inside/outside of the corner), each car's path vs the
field line, vs its EXPECTED line (field laps that came from the same lateral spot 1.5 s earlier),
vs the white lines, inputs (throttle/brake/steer) vs the field and vs its own laps at the same spot,
corner context (phase, apex speed vs own and field, brake point vs own and field),
a hold-the-line simulation (would the touch still happen if one car had kept its expected line?),
and consequences (time lost vs own laps, spin, off track, places).
"""
import math, re, numpy as np
from scene import race, box, gap, wrap, BIN, HALF_L, HALF_W

DT = 0.05


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def car_ids(R, names):
    out = []
    for nm in names:
        m = re.match(r'#(\d+)\s+(.*)', nm.replace('\xa0', ' '))
        num, nn = (int(m.group(1)), norm(m.group(2))) if m else (None, norm(nm))
        cands = [c for c, d in R.drivers.items() if c in R.cars]
        best = [c for c in cands if norm(R.drivers[c]['name']) == nn and (num is None or R.drivers[c]['race_number'] == num)]
        if not best: best = [c for c in cands if nn and (nn in norm(R.drivers[c]['name']) or norm(R.drivers[c]['name']) in nn)]
        if not best and num is not None: best = [c for c in cands if R.drivers[c]['race_number'] == num]
        out.append(best[0] if len(best) == 1 else (best if best else None))
    return out


def resolve(R, names, t):
    """names -> car ids; ambiguous ones (same name 'Player' / same number) picked by closeness to the others at t"""
    ids = car_ids(R, names)
    fixed = [i for i in ids if isinstance(i, (int, np.integer))]
    out = []
    for i in ids:
        if isinstance(i, list):
            ref = fixed or [c for c in R.cars]
            def dist(c):
                return min(math.hypot(R.at(c, t, 'x') - R.at(o, t, 'x'), R.at(c, t, 'z') - R.at(o, t, 'z')) for o in ref if o != c) if any(o != c for o in ref) else 0
            i = min(i, key=dist)
        if i is not None: out.append(int(i))
    return list(dict.fromkeys(out))


def pose(R, c, t):
    C = R.cars[c]
    return [float(np.interp(t, C['t'], C[k])) for k in ('x', 'z', 'fx', 'fz')]


def alive(R, c, t):
    C = R.cars[c]; return C['t'][0] <= t <= C['t'][-1]


def touches(R, a, b, t0, t1, mx=0.10):
    """runs of body-box gap <= mx between cars a and b"""
    out = []; cur = None
    for t in np.arange(t0, t1, DT):
        if not (alive(R, a, t) and alive(R, b, t)): continue
        pa, pb = pose(R, a, t), pose(R, b, t)
        if math.hypot(pa[0] - pb[0], pa[1] - pb[1]) > 8: g = 9
        else: g = gap(box(*pa), box(*pb))
        if g <= mx:
            if cur is None: cur = [t, t, g]
            cur[1] = t; cur[2] = min(cur[2], g)
        elif cur is not None:
            out.append(cur); cur = None
    if cur: out.append(cur)
    # merge runs < 0.3 s apart
    m = []
    for r in out:
        if m and r[0] - m[-1][1] < 0.3: m[-1][1] = r[1]; m[-1][2] = min(m[-1][2], r[2])
        else: m.append(r)
    return [dict(t=round(r[0], 2), t_end=round(r[1], 2), gap=round(r[2], 2)) for r in m]


def nearby(R, cars, t0, t1, rad=12.0):
    out = set()
    for c in R.cars:
        if c in cars: continue
        for t in np.arange(t0, t1, 0.25):
            if not alive(R, c, t): continue
            for o in cars:
                if alive(R, o, t) and math.hypot(R.at(c, t, 'x') - R.at(o, t, 'x'), R.at(c, t, 'z') - R.at(o, t, 'z')) < rad:
                    out.add(c)
    return sorted(out)


# ---------------- per-car measures ----------------
def track_pos(R, c, t):
    C = R.cars[c]
    S = float(np.interp(t, C['t'], C['S'])); d = float(np.interp(t, C['t'], C['d']))
    j = int((S % R.L) // BIN) % R.nb
    return S, d, j


def expected_line(R, c, t, lead=1.5):
    """field laps that were at this car's lateral spot `lead` s earlier: their median lateral along the next bins"""
    C = R.cars[c]
    S0, d0, j0 = track_pos(R, c, t - lead)
    lap = int(np.interp(t, C['t'], C['lap']))
    if not len(R.D): return None, 0
    keep = np.array([not (k[0] == c and k[1] == lap) for k in R.Dkey])
    D = R.D[keep]
    for tol in (0.75, 1.25, 2.0, 3.0):
        m = np.abs(D[:, j0] - d0) < tol
        if m.sum() >= 4: break
    if m.sum() < 2: return None, int(m.sum())
    return np.median(D[m], 0), int(m.sum())


def dev_series(R, c, ex, ts):
    out = []
    for t in ts:
        S, d, j = track_pos(R, c, t)
        out.append(d - ex[j] if ex is not None else np.nan)
    return np.array(out)


def lost_time(R, c, t, ahead=700.0):
    """seconds lost vs own (else field) median time between the spot 1 s before t and `ahead` m later"""
    C = R.cars[c]
    prof = R.own.get(c, {}).get('T') if c in R.own and R.own[c]['n'] >= 2 else R.fieldT
    if prof is None: return None
    S0, _, j0 = track_pos(R, c, t - 1.0)
    S1 = S0 + ahead
    k = np.searchsorted(C['S'], S1) if np.all(np.diff(C['S'][C['t'] > t - 1]) >= -5) else None
    tt = C['t']; SS = C['S']
    after = np.where((tt > t - 1.0) & (SS >= S1))[0]
    if not len(after):
        return 30.0     # never got there (retired / stopped)
    t_arr = float(np.interp(S1, SS[after[0] - 1:after[0] + 1], tt[after[0] - 1:after[0] + 1])) if after[0] > 0 else float(tt[after[0]])
    j1 = int((S1 % R.L) // BIN) % R.nb
    exp = (prof[j1] - prof[j0]) % (prof[-1] + (prof[1] - prof[0]))
    lap = int(np.interp(t, C['t'], C['lap']))
    if lap <= 1 and R.lap1T is not None and j1 > j0:
        seg = R.lap1T[:, j1] - R.lap1T[:, j0]; seg = seg[~np.isnan(seg)]
        if len(seg) >= 4: exp = float(np.median(seg))
    # lap 1 / pack: compare with the field on lap 1 is not available -> own laps (biased fast); keep as is
    return round(t_arr - (t - 1.0) - exp, 2)


def corner_ctx(R, j):
    co = R.corner_of(j)
    if co is None: return dict(phase='straight', apex=None)
    a, dd = co
    vmin = float(R.R[a, 2]); turn = R.turn[a]
    bp = R.cbrake.get(a)
    if dd > 40: ph = 'entry' if bp is not None and ((j - bp) % R.nb) * BIN < 600 and ((a - j) % R.nb) * BIN < ((a - bp) % R.nb) * BIN + 10 else 'approach'
    elif dd >= -25: ph = 'apex'
    else: ph = 'exit'
    if vmin > 265: ph = 'straight'
    return dict(phase=ph, apex=a, to_apex=round(dd), vmin=round(vmin), turn_deg=round(math.degrees(turn)), inside=1 if turn > 0 else -1,
                cls='low' if vmin < 130 else 'med' if vmin < 210 else 'high' if vmin <= 265 else 'straight',
                brake_bin=bp)


def corner_driving(R, c, t, ctx):
    """this car through this corner vs its own laps and the field: brake point, apex speed, lift"""
    if ctx.get('apex') is None: return {}
    C = R.cars[c]; a = ctx['apex']; nb = R.nb
    lap = int(np.interp(t, C['t'], C['lap']))
    S_ap = (lap - 1) * R.L + a * BIN
    if ctx['to_apex'] < -200: S_ap += 0
    prev = [p for p in R.apex if 0 < ((a - p) % nb) * BIN < 500]
    back_m = min([((a - p) % nb) * BIN - 30 for p in prev] + [500])
    m = (C['S'] > S_ap - back_m) & (C['S'] < S_ap + 30)
    out = {}
    if m.sum() < 5: return out
    SS = C['S'][m]; brk = C['brk'][m]; v = C['v'][m]; thr = C['thr'][m]
    k = np.where(brk > 0.15)[0]
    if len(k):
        d_car = S_ap - SS[k[0]]
        bp = R.cbrake.get(a)
        if bp is not None:
            d_field = ((a - bp) % nb) * BIN
            out['brake_dist_m'] = round(d_car); out['field_brake_dist_m'] = round(d_field)
            out['late_vs_field_pct'] = round(100 * (d_field - d_car) / max(d_field, 1))
        if c in R.own:
            ob = R.own[c]['B']; js = [(a - o) % nb for o in range(int(back_m / BIN), 0, -1)]
            kk = [q for q in js if ob[q] > 0.15]
            if kk:
                d_own = ((a - kk[0]) % nb) * BIN
                out['own_brake_dist_m'] = round(d_own); out['late_vs_own_pct'] = round(100 * (d_own - d_car) / max(d_own, 1))
    near = np.abs(SS - S_ap) < 12
    tap = float(np.interp(S_ap, C['S'], C['t'])) if C['S'][0] < S_ap < C['S'][-1] else None
    out['apex_after_touch'] = bool(tap is not None and tap > t)
    if near.any():
        va = float(v[near].min()); out['apex_kmh'] = round(va)
        out['field_apex_kmh'] = round(float(R.R[a, 2]))
        if c in R.own: out['own_apex_kmh'] = round(float(R.own[c]['V'][a])); out['apex_over_own_pct'] = round(100 * (va - R.own[c]['V'][a]) / max(R.own[c]['V'][a], 1))
        out['apex_over_field_pct'] = round(100 * (va - R.R[a, 2]) / max(R.R[a, 2], 1))
    return out


def car_window(R, c, tc, other):
    """lateral story of one car around touch time tc"""
    ex, nexp = expected_line(R, c, tc, 1.5)
    ts = np.array([tc - 2.0, tc - 1.5, tc - 1.0, tc - 0.5, tc - 0.2, tc, tc + 0.5, tc + 1.0])
    dv = dev_series(R, c, ex, ts)
    ds = [track_pos(R, c, t)[1] for t in ts]
    do = [track_pos(R, other, t)[1] for t in ts]
    side = np.sign(do[5] - ds[5]) or 1.0      # + = other car is on the + side
    S, d, j = track_pos(R, c, tc)
    eL, eR = R.white(j)
    C = R.cars[c]; k = R.idx(c, tc)
    kk = (C['t'] >= tc - 1.5) & (C['t'] <= tc)
    kafter = (C['t'] > tc) & (C['t'] <= tc + 3)
    out = dict(
        d=round(d, 2), white_plus=round(eL, 1), white_minus=round(eR, 1),
        room_to_white_on_other_side=None,
        exp_n=nexp,
        dev_from_expected=round(float(dv[5]), 2) if not np.isnan(dv[5]) else None,
        moved_toward_1s=round(float((ds[5] - ds[2]) * side), 2),
        moved_toward_05s=round(float((ds[5] - ds[3]) * side), 2),
        off_expected_toward_1s=round(float((dv[5] - dv[2]) * side), 2) if not np.isnan(dv[2]) else None,
        off_expected_toward_05s=round(float((dv[5] - dv[3]) * side), 2) if not np.isnan(dv[3]) else None,
        steer_toward=round(float(np.mean(C['steer'][kk][-5:]) * side), 2) if kk.any() else None,
        speed=round(float(np.interp(tc, C['t'], C['v']))),
        thr=round(float(np.interp(tc, C['t'], C['thr'])), 2), brk=round(float(np.interp(tc, C['t'], C['brk'])), 2),
        field_brk=round(float(R.R[j, 5]), 2), field_thr=round(float(R.R[j, 4]), 2), field_v=round(float(R.R[j, 2])),
        own_v=round(float(R.own[c]['V'][j])) if c in R.own else None,
        own_brk=round(float(R.own[c]['B'][j]), 2) if c in R.own else None,
        slip_max_before=round(float(np.max(np.abs(C['slip'][kk]))), 1) if kk.any() else None,
        head_max_before=round(float(np.max(np.abs(C['head'][kk]))), 1) if kk.any() else None,
        head_max_after=round(float(np.max(np.abs(C['head'][kafter]))), 1) if kafter.any() else None,
    )
    # was the car off track just before (rejoin) / after (pushed off)
    tob = [R.tyres_over(c, t) for t in np.arange(tc - 2.0, tc + 0.01, 0.25)]
    toa = [R.tyres_over(c, t) for t in np.arange(tc, tc + 3.0, 0.25)]
    out['off_before_s'] = round(sum(0.25 for q in tob if q is not None and q >= 4), 2)
    out['off_at_touch'] = tob[-1]
    out['off_after_s'] = round(sum(0.25 for q in toa if q is not None and q >= 4), 2)
    # room: distance from this car's body edge on the side away from the other car to the white line
    if side > 0: out['room_away_m'] = round(float((d - HALF_W) - eR), 2)
    else: out['room_away_m'] = round(float(eL - (d + HALF_W)), 2)
    return out


def sim_hold(R, a, b, tc, lead=1.5):
    """counterfactual: car x keeps its expected line from tc-lead on (along-track motion unchanged). min gap."""
    res = {}
    exa, _ = expected_line(R, a, tc, lead); exb, _ = expected_line(R, b, tc, lead)
    def gapmin(fa, fb):
        g = 9
        for t in np.arange(tc - 0.6, tc + 0.3, DT):
            P = []
            for c, ex, f in ((a, exa, fa), (b, exb, fb)):
                x, z, fx, fz = pose(R, c, t)
                if f and ex is not None:
                    S, d, j = track_pos(R, c, t)
                    dd = ex[j] - d
                    nx, nz = -R.tz[j], R.tx[j]
                    x, z = x + nx * dd, z + nz * dd
                P.append((x, z, fx, fz))
            g = min(g, gap(box(*P[0]), box(*P[1])))
        return round(g, 2)
    res['actual'] = gapmin(False, False)
    res['a_holds'] = gapmin(True, False)
    res['b_holds'] = gapmin(False, True)
    res['both_hold'] = gapmin(True, True)
    return res


def analyse_touch(R, a, b, tc):
    Sa, da, ja = track_pos(R, a, tc); Sb, db, jb = track_pos(R, b, tc)
    ds = wrap(Sa - Sb, R.L)
    front, back = (a, b) if ds >= 0 else (b, a)
    gap_long = abs(ds)
    overlap = round(2 * HALF_L - gap_long, 2)   # metres the back car's nose is past the front car's tail (5.1 = level)
    jf = track_pos(R, front, tc)[2]
    ctx = corner_ctx(R, jf)
    # overlap history: back car's nose vs front car's tail at 2, 1, 0.5 s before
    hist = {}
    for dt in (2.0, 1.5, 1.0, 0.5, 0.2):
        Sf = track_pos(R, front, tc - dt)[0]; Sk = track_pos(R, back, tc - dt)[0]
        hist[str(dt)] = round(2 * HALF_L - wrap(Sf - Sk, R.L), 1)
    # alongside at turn-in: the moment the front car passed the field brake point -> or 1.0 s before for no corner
    lat = {}
    for c in (front, back):
        lat[c] = track_pos(R, c, tc)[1]
    inside_car = None
    if ctx.get('apex') is not None:
        inside_car = front if (lat[front] - lat[back]) * ctx['inside'] > 0 else back
    rel_v = float(np.interp(tc, R.cars[back]['t'], R.cars[back]['v']) - np.interp(tc, R.cars[front]['t'], R.cars[front]['v']))
    out = dict(t=round(tc, 2), front=front, back=back, gap_long=round(gap_long, 2), overlap=overlap, overlap_hist=hist,
               lat_gap=round(abs(lat[front] - lat[back]), 2), closing_kmh=round(rel_v), ctx=ctx, inside=inside_car,
               lap=int(np.interp(tc, R.cars[front]['t'], R.cars[front]['lap'])),
               cars={c: car_window(R, c, tc, b if c == a else a) for c in (a, b)},
               corner={c: corner_driving(R, c, tc, ctx) for c in (a, b)},
               sim=sim_hold(R, front, back, tc))
    return out


def build(rec, t, names, extra_window=8.0):
    R = race(rec)
    cars = resolve(R, names, t)
    t0, t1 = t - 2.0, t + extra_window
    near = nearby(R, cars, t0, t1) if len(cars) else []
    pool = cars + [c for c in near if c not in cars]
    tl = []
    for i, a in enumerate(pool):
        for b in pool[i + 1:]:
            if a not in cars and b not in cars: continue
            for r in touches(R, a, b, t0, t1):
                tl.append(dict(r, a=a, b=b))
    # game contact events in the window
    coll = [c for c in R.m['coll'] if t0 <= c['t'] <= t1]
    tl.sort(key=lambda r: r['t'])
    # consequences per car
    cons = {}
    for c in set([x['a'] for x in tl] + [x['b'] for x in tl] + cars):
        if c not in R.cars: continue
        tf = min([x['t'] for x in tl if c in (x['a'], x['b'])] or [t])
        C = R.cars[c]; m = (C['t'] > tf) & (C['t'] < tf + 5)
        p0 = float(np.interp(tf - 1, C['t'], C['pos'])); p1 = float(np.interp(tf + 8, C['t'], C['pos']))
        cons[c] = dict(lost_s=lost_time(R, c, tf), spin=bool(m.any() and np.max(np.abs(C['head'][m])) > 60),
                       head_max=round(float(np.max(np.abs(C['head'][m]))), 0) if m.any() else None,
                       off_s=round(sum(0.25 for q in [R.tyres_over(c, tt) for tt in np.arange(tf, tf + 3, 0.25)] if q is not None and q >= 4), 2),
                       places=int(round(p1 - p0)))
    return R, cars, tl, coll, cons
