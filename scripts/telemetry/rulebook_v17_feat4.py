"""Round 11 data (GreMi's notes on the 9 disagreements, 24 Nov): measures the engine did not have.
For every contact pair in h/<rec>.json:
  body gap      do the two car bodies really touch at the contact time (data check)
  walls         did the car hit a wall (map walls layer) and how hard (speed drop), with no car near
  ground        wheels on gravel/grass (game surfaces) and 4-over-line (map), first time vs the contact
  room          metres from the car's side to the white line, towards the other car and away from it
  map moves     sideways moves measured from the white lines (no reference lap needed)
  expected line where the field is at the contact spot when it came in on the same entry line (turn-in early)
  throttle      throttle vs the field at the same spot (on the power too early)
  slide         slip angle before/after
"""
import sys, json, math, os, bisect, collections, statistics, re
import numpy as np
import gmtel, race_bundles as rb, track_map

rec = os.path.basename(path).replace('.gmtel.gz', '')   # path, H: given by rulebook_v17 (this file is exec'd, not imported)
s = gmtel.Session(path); frames = rb.frames_of(s)
tm = track_map.load(s.info.get('track'))
L = s.info.get('track_length', 0) or 5000
HALF_W, HALF_L = 1.0, 2.8

TS = collections.defaultdict(list)
for t, cars in frames:
    for i, c in cars.items(): TS[i].append((t, c[0], c[1], c[3], c[4], c[5], c[6], c[7], c[9], c[10], c[11]))
TT = {i: [r[0] for r in v] for i, v in TS.items()}
def at(i, t):
    v = TS.get(i)
    if not v: return None
    k = bisect.bisect_left(TT[i], t)
    if k <= 0 or k >= len(v): return None
    a, b = v[k-1], v[k]
    if b[0]-a[0] > 0.5: return None
    w = (t-a[0])/(b[0]-a[0]) if b[0] > a[0] else 0
    lerp = lambda j: a[j]+(b[j]-a[j])*w
    dh = math.atan2(math.sin(b[3]-a[3]), math.cos(b[3]-a[3]))
    return {'t': t, 'x': lerp(1), 'z': lerp(2), 'h': a[3]+dh*w, 'v': lerp(4), 'thr': lerp(5), 'brk': lerp(6), 'st': lerp(7),
            'off': b[8], 'ld': lerp(9) if abs(b[9]-a[9]) < 100 else b[9], 'lap': b[10]}

# raw rows: surfaces and velocity
SURF = collections.defaultdict(list); MV = collections.defaultdict(list)
for t in sorted(s.field):
    for i, r in s.field[t].items():
        if 'surface_rl' in r: SURF[i].append((t, tuple(r.get('surface_'+k, 0) for k in ('rl', 'rr', 'fl', 'fr'))))
        if 'vx' in r and 'fx' in r: MV[i].append((t, r['vx'], r['vz'], r['fx'], r['fz']))
ST = {i: [r[0] for r in v] for i, v in SURF.items()}; MT = {i: [r[0] for r in v] for i, v in MV.items()}
SOFT = {3, 4, 5, 6, 7, 8}
def soft_n(i, t):
    v = SURF.get(i)
    if not v: return None
    k = min(max(bisect.bisect_left(ST[i], t), 0), len(v)-1)
    return sum(1 for x in v[k][1] if x in SOFT)
def slip(i, t0, t1):
    v = MV.get(i)
    if not v: return None
    a = bisect.bisect_left(MT[i], t0); b = bisect.bisect_right(MT[i], t1); m = 0
    for r in v[a:b]:
        sp = math.hypot(r[1], r[2])
        if sp < 8: continue
        m = max(m, math.degrees(math.acos(max(-1, min(1, (r[1]*r[3]+r[2]*r[4])/(sp*(math.hypot(r[3], r[4]) or 1)))))))
    return round(m, 1)

# centre line (field median, laps 2+) for along-track position and a stable normal
B = collections.defaultdict(list)
for i, v in TS.items():
    for r in v:
        if r[10] >= 2 and r[9] > 0 and r[4] > 60: B[int(r[9]//5)].append((r[1], r[2]))
C0 = {k: (statistics.median(p[0] for p in v), statistics.median(p[1] for p in v)) for k, v in B.items() if len(v) >= 5}
C = {}
for k in C0:
    nb = [C0[j] for j in range(k-3, k+4) if j in C0]
    C[k] = (sum(p[0] for p in nb)/len(nb), sum(p[1] for p in nb)/len(nb))
def proj(x, z, ld):
    """(along-track m, lateral m (+ = left), unit tangent) from the nearest centre-line segment near lap distance ld"""
    k0 = int(ld//5); best = None
    for k in range(k0-14, k0+15):
        a, b = C.get(k % (int(L//5)+1)), C.get((k+1) % (int(L//5)+1))
        if not a or not b: continue
        tx, tz = b[0]-a[0], b[1]-a[1]; tl = math.hypot(tx, tz) or 1; ux, uz = tx/tl, tz/tl
        dx, dz = x-a[0], z-a[1]
        u = max(0, min(tl, dx*ux+dz*uz)); d = math.hypot(dx-ux*u, dz-uz*u)
        if best is None or d < best[0]: best = (d, (k*5+u) % L, dx*(-uz)+dz*ux, (ux, uz))
    return None if best is None else best[1:]

# map: distance to the white line along a direction
SS = np.arange(0, 40, 0.1)
def edge_dist(x, z, nx, nz):
    """metres from (x, z) to the white line along (nx, nz); negative when the point is already outside (distance back in)"""
    if tm is None: return None
    ins = tm.inside(x+nx*SS, z+nz*SS)
    if ins[0]:
        return float(SS[np.argmin(ins)]) if not ins.all() else 40.0
    back = tm.inside(x-nx*SS[:150], z-nz*SS[:150])
    return -float(SS[np.argmax(back)]) if back.any() else None
def track_pos_ray(p):
    """(metres to left line, metres to right line) from the car centre, along the centre-line normal"""
    pr = proj(p['x'], p['z'], p['ld'])
    if not pr or tm is None: return None
    ux, uz = pr[2]; nx, nz = -uz, ux        # left normal
    l = edge_dist(p['x'], p['z'], nx, nz); r = edge_dist(p['x'], p['z'], -nx, -nz)
    return None if l is None or r is None else (l, r, pr[0], pr[1])


# boundary points of the white-line mask (cells on the surface with a neighbour off it), bucketed in 2 m cells
BP = collections.defaultdict(list)
if tm is not None:
    for (ti, tj), g in tm.tiles.items():
        e = g.copy(); e[1:, :] &= g[:-1, :]; e[:-1, :] &= g[1:, :]; e[:, 1:] &= g[:, :-1]; e[:, :-1] &= g[:, 1:]
        zz, xx = np.nonzero(g & ~e)
        X = ti*track_map.TILE+(xx+0.5)*track_map.RES; Z = tj*track_map.TILE+(zz+0.5)*track_map.RES
        for x_, z_ in zip(X[::2], Z[::2]): BP[(int(x_//2), int(z_//2))].append((x_, z_))
BPA = {k: np.array(v) for k, v in BP.items()}
def track_pos(p):
    """(nearest metres to the + side white line, to the - side white line, along, lateral) using straight-line nearest
    distances (works in hairpins), only boundary points the car can 'see' across the surface"""
    pr = proj(p['x'], p['z'], p['ld'])
    if not pr or tm is None: return None
    ux, uz = pr[2]; nx, nz = -uz, ux
    cx, cz = int(p['x']//2), int(p['z']//2)
    pts = [BPA[(cx+i, cz+j)] for i in range(-10, 11) for j in range(-10, 11) if (cx+i, cz+j) in BPA]
    if not pts: return None
    Pn = np.concatenate(pts); dx = Pn[:, 0]-p['x']; dz = Pn[:, 1]-p['z']
    d = np.hypot(dx, dz); side = dx*nx+dz*nz; fwd = dx*ux+dz*uz
    ok = (d < 20) & (np.abs(fwd) < np.maximum(8, 0.9*np.abs(side)+2))
    on = bool(tm.inside(p['x'], p['z']))
    res = []
    for sg in (1, -1):
        idx = np.nonzero(ok & (side*sg > 0))[0]
        idx = idx[np.argsort(d[idx])]
        best = None
        for k in idx[:40]:
            if not on: best = d[k]; break
            f = np.linspace(0, 1, 12)[:-1]
            if tm.inside(p['x']+dx[k]*f, p['z']+dz[k]*f).all(): best = d[k]; break
        res.append(None if best is None else float(best))
    if res[0] is None or res[1] is None: return None
    if not on:   # outside: the line the car is past is negative
        if res[0] < res[1]: res[0] = -res[0]
        else: res[1] = -res[1]
    return (res[0], res[1], pr[0], pr[1])

# walls (map walls layer: stroked polylines)
WSEG = collections.defaultdict(list)
# concrete walls (#c4c0b8, #9c9a95) and tyre barriers (#262626); the thin #a3a8ad / #8a8a8a lines run along the white line on open straights (not walls)
WALL_COLS = {'#c4c0b8', '#9c9a95', '#262626', '#b9483a'}
if tm is not None:
    for (ti_, tj_) in tm.tiles:
        txt = track_map._read(f"{tm.name}/{ti_}_{tj_}.walls.svg")
        if not txt: continue
        for m_ in re.finditer(r'<path d="([^"]+)"[^>]*stroke="(#[0-9a-f]+)"', txt):
            if m_.group(2) not in WALL_COLS: continue
            for q in re.split(r'(?=M)', m_.group(1)):
                nums = [float(v) for v in re.findall(r'-?\d+(?:\.\d+)?', q)]
                poly = list(zip(nums[0::2], nums[1::2]))
                for (xa, za), (xb, zb) in zip(poly, poly[1:]):
                    for cell in {(int(xa//10), int(za//10)), (int(xb//10), int(zb//10)), (int((xa+xb)/2//10), int((za+zb)/2//10))}:
                        WSEG[cell].append((xa, za, xb, zb))
def wall_dist(p):
    """metres from the car body (rectangle) to the nearest wall segment, None = no wall within ~15 m"""
    if not WSEG: return None
    cx, cz = p['x'], p['z']; fx, fz = math.cos(p['h']), math.sin(p['h'])
    best = None
    for du in (-1, 0, 1):
        for dv in (-1, 0, 1):
            for xa, za, xb, zb in WSEG.get((int(cx//10)+du, int(cz//10)+dv), ()):
                # sample segment points, distance to rectangle in car frame
                n = max(1, int(math.hypot(xb-xa, zb-za)/0.3))
                for k in range(n+1):
                    x = xa+(xb-xa)*k/n-cx; z = za+(zb-za)*k/n-cz
                    a = x*fx+z*fz; c = -x*fz+z*fx
                    d = math.hypot(max(abs(a)-HALF_L, 0), max(abs(c)-HALF_W, 0))
                    if best is None or d < best: best = d
    return best
def rect_gap(P, Q):
    """smallest distance between two car rectangles (0 = touching/overlapping), by corner/edge sampling"""
    def pts(p):
        fx, fz = math.cos(p['h']), math.sin(p['h']); out = []
        for a in np.linspace(-HALF_L, HALF_L, 9):
            for c in (-HALF_W, HALF_W): out.append((p['x']+fx*a-fz*c, p['z']+fz*a+fx*c))
        for c in np.linspace(-HALF_W, HALF_W, 5):
            for a in (-HALF_L, HALF_L): out.append((p['x']+fx*a-fz*c, p['z']+fz*a+fx*c))
        return out
    def inside(p, x, z):
        fx, fz = math.cos(p['h']), math.sin(p['h']); x -= p['x']; z -= p['z']
        a = x*fx+z*fz; c = -x*fz+z*fx
        return math.hypot(max(abs(a)-HALF_L, 0), max(abs(c)-HALF_W, 0))
    return round(min(min(inside(Q, x, z) for x, z in pts(P)), min(inside(P, x, z) for x, z in pts(Q))), 2)

# field laps (2+): per car and lap, samples sorted by along-track metres -> interpolate anything at any spot
LAPS = {}
for i, v in TS.items():
    for r in v:
        if r[10] >= 2 and r[4] > 30:
            pr = proj(r[1], r[2], r[9])
            if pr and abs(pr[1]) < 25: LAPS.setdefault((i, r[10]), []).append((pr[0], pr[1], r[0], r[5], r[6], r[7], r[4]))
LAPA = {}
for k, v in LAPS.items():
    v.sort(key=lambda q: q[2]); A_ = np.array(v)
    if len(A_) < 50: continue
    al = A_[:, 0].copy()
    for n in range(1, len(al)):        # unwrap the start/finish line so along grows through the lap
        while al[n] < al[n-1]-L/2: al[n] += L
    A_[:, 0] = al; LAPA[k] = A_
def lap_at(A_, al):
    """interpolated row (along, lat, t, thr, brk, steer, v) of one lap at along-track metres al (or None when not covered)"""
    for off_ in (0, L, -L):
        x = al+off_
        if A_[0, 0] <= x <= A_[-1, 0]:
            k = int(np.searchsorted(A_[:, 0], x))
            if k == 0 or A_[k, 0]-A_[k-1, 0] > 15: return None
            w = (x-A_[k-1, 0])/(A_[k, 0]-A_[k-1, 0]); return A_[k-1]+(A_[k]-A_[k-1])*w
    return None
def field_at(al, excl=None):
    out = []
    for (i, lp), A_ in LAPA.items():
        if i == excl: continue
        r = lap_at(A_, al)
        if r is not None: out.append((i, lp, r[1], r[3], r[4], r[5], r[6], r[2]))
    return out
def expected_lat(entry_al, entry_lat, cont_al, excl=None):
    """field laps (2+) that passed both spots: regression of lateral at the contact spot on lateral at entry"""
    pairs = []
    for (i, lp), A_ in LAPA.items():
        if i == excl: continue
        e = lap_at(A_, entry_al); c = lap_at(A_, cont_al)
        if e is not None and c is not None and 0 < c[2]-e[2] < 6: pairs.append((e[1], c[1]))
    if len(pairs) < 8: return None
    xs = np.array([p[0] for p in pairs]); ys = np.array([p[1] for p in pairs])
    if xs.std() < 0.2: k, c = 0.0, ys.mean()
    else: k, c = np.polyfit(xs, ys, 1)
    res = ys-(k*xs+c)
    near = [y for x_, y in pairs if abs(x_-entry_lat) < 1.0]
    return {'exp': float(k*entry_lat+c), 'sd': float(res.std()), 'n': len(pairs),
            'near_med': float(np.median(near)) if len(near) >= 3 else None, 'near_n': len(near)}

allc = sorted((t, a, b) for inc in H for a, b, t in inc['contacts'])
out = []
for inc in H:
    P_ = []
    for p in inc.get('raw', []):
        for m in p['ms']:
            a, b, t = p['a'], p['b'], m['t']
            f = {'a': a, 'b': b, 't': t}
            A, Bc = at(a, t), at(b, t)
            if not A or not Bc: P_.append(f); continue
            f['body_gap'] = rect_gap(A, Bc)
            f['body_gap_min'] = min(rect_gap(at(a, t+d), at(b, t+d)) for d in (-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3) if at(a, t+d) and at(b, t+d))
            for c, o in ((a, b), (b, a)):
                g = {}
                P = at(c, t-0.1); Q = at(o, t-0.1)
                pp, pq = (proj(P['x'], P['z'], P['ld']) if P else None), (proj(Q['x'], Q['z'], Q['ld']) if Q else None)
                tp, tq = track_pos(P) if P else None, track_pos(Q) if Q else None
                if pp and pq:
                    side = 1 if pq[1] > pp[1] else -1          # +1 = other car is on my + side
                    g['lat_gap_m'] = round(abs(pq[1]-pp[1]), 2)
                    # expected line: where the field (laps 2+) is at this spot when it came in on my line w s earlier
                    for w_ in (1.0, 1.5, 2.5):
                        E = at(c, t-0.1-w_); pe = proj(E['x'], E['z'], E['ld']) if E else None
                        if pe:
                            ex = expected_lat(pe[0], pe[1], pp[0])
                            if ex:
                                g[f'exp_dev{w_}'] = round((pp[1]-ex['exp'])*side, 2)   # + = further towards the other car than the field would be
                                if w_ == 1.5: g['exp_sd'] = round(ex['sd'], 2); g['exp_n'] = ex['n']
                    # throttle / brake / steer vs the field at this spot
                    fb = field_at(pp[0], excl=c)
                    if len(fb) >= 8:
                        g['thr'] = round(P['thr'], 2); g['field_thr'] = round(statistics.median(q[3] for q in fb), 2)
                        g['brk'] = round(P['brk'], 2); g['field_brk'] = round(statistics.median(q[4] for q in fb), 2)
                        g['v'] = round(P['v']); g['field_v'] = round(statistics.median(q[6] for q in fb))
                        g['steer_tw'] = round(-(P['st']-statistics.median(q[5] for q in fb))*side, 2)
                    for which, fn in (('', track_pos), ('ray_', track_pos_ray)):
                        tp = fn(P)
                        if not tp: continue
                        g[which+'room_toward_m'] = round((tp[0] if side > 0 else tp[1])-HALF_W, 2)
                        g[which+'room_away_m'] = round((tp[1] if side > 0 else tp[0])-HALF_W, 2)
                        for w in (0.5, 1.0, 1.5, 2.0):
                            P0 = at(c, t-0.1-w); tp0 = fn(P0) if P0 else None
                            if tp0: g[f'{which}map_mv{w}'] = round((tp[1] if side > 0 else tp[0])-(tp0[1] if side > 0 else tp0[0]), 2)
                # walls: closest the body came to a wall, and a hard hit (speed drop) near it with no car within 2 m
                hits = []
                for k in range(-10, 31):
                    tt = t+k*0.1; R = at(c, tt); R1 = at(c, tt+0.3)
                    if not R or not R1: continue
                    if any(b[0] <= R['x'] <= b[2] and b[1] <= R['z'] <= b[3] for b in tm.bridges): continue   # bridge: the lower road's walls cross it on the map
                    wd = wall_dist(R)
                    if wd is None or wd > 0.6: continue
                    drop = R['v']-R1['v']
                    near_car = any(abs(ct-tt) < 0.4 and c in (ca, cb) for ct, ca, cb in allc)
                    hits.append((round(k*0.1, 1), round(wd, 2), round(drop), near_car, R['brk']))
                g['wall_min_m'] = min((h[1] for h in hits), default=None)
                hard = [h for h in hits if (h[2] >= 50 or (h[2] >= 20 and h[4] < 0.3)) and not h[3]]
                if hard: g['wall_hit'] = {'dt': hard[0][0], 'drop_kmh': max(h[2] for h in hard), 'speed': round(at(c, t+hard[0][0])['v'])}
                # ground: soft surfaces and fully-over-the-line, first time vs the contact
                sb = soft_n(c, t-0.3); g['soft_before'] = sb
                first_soft = next((round(k*0.1, 1) for k in range(-20, 41) if (soft_n(c, t+k*0.1) or 0) >= 2), None)
                g['soft_first_dt'] = first_soft
                first_off = next((round(k*0.1, 1) for k in range(-20, 41) if at(c, t+k*0.1) and at(c, t+k*0.1)['off'] == 15), None)
                g['off4_first_dt'] = first_off
                g['slip_pre'] = slip(c, t-1.5, t-0.05); g['slip_post'] = slip(c, t, t+2.5)
                # closing from far back: gap and closing speed 2 s before
                P2, Q2 = at(c, t-2.0), at(o, t-2.0)
                if P2 and Q2: g['dist_2s'] = round(math.hypot(P2['x']-Q2['x'], P2['z']-Q2['z']), 1); g['dv_2s'] = round(P2['v']-Q2['v'])
                f[str(c)] = g
            P_.append(f)
    out.append(P_)
