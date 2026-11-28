"""AI steward fact sheets: one recording -> every contact incident with per-touch facts.

Touches count only when the game logged a contact (COLL) for that pair within 0.6 s (ghosted / pass-through
overlaps are not touches, GreMi 26 Nov). COLL events are grouped into incidents: same pair within 6 s, or a
shared car within 3 s (aftermath / chain). Output: <work>/facts/<rec>.json, read by the steward routine.

usage: python3 facts.py <recording name without .gmtel.gz>   (recording cached by cache.py first)
"""
import json, os, sys, itertools, collections
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene, incident as I

WORK = scene.W


def mmss(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def names(R):
    out = {}
    for c, p in R.drivers.items():
        shown = p.get('shown') if p.get('shown') is not None else p.get('public')
        if (p.get('ai') or shown) and p.get('name') not in (None, '', 'Player'):
            out[c] = f"#{p.get('race_number', 0)} {p['name']}"
        else:
            out[c] = f"Car #{p.get('race_number', 0)} (hidden name, slot {c})"
    cnt = collections.Counter(out.values())
    for c in out:
        if cnt[out[c]] > 1:
            out[c] += f" (slot {c})"
    return out


def phase_txt(R, cx):
    ph = cx.get('phase')
    if ph == 'straight' or cx.get('apex') is None:
        return 'on a straight'
    k = R.apex.index(cx['apex']) + 1
    return {'approach': f'on the run to T{k}', 'entry': f'braking into T{k}', 'apex': f'at the apex of T{k}',
            'exit': f'on the exit of T{k}'}.get(ph, f'at T{k}')


def in_race(R, c, t):
    C = R.cars.get(c)
    if C is None or not (C['t'][0] <= t <= C['t'][-1]):
        return False
    return True


def group(colls):
    groups = []
    for e in sorted(colls, key=lambda e: e['t']):
        p = {e['a'], e['b']}
        hit = None
        for g in groups:
            last = g[-1]['t']
            if any({x['a'], x['b']} == p and e['t'] - x['t'] <= 6.0 for x in g) or \
               (e['t'] - last <= 3.0 and p & {c for x in g for c in (x['a'], x['b'])}):
                hit = g
                break
        if hit is None:
            groups.append([e])
        else:
            hit.append(e)
    return groups


def recovered(R, c, t):
    C = R.cars[c]
    if np.interp(t, C['t'], C['res']) > 2:
        return True
    sl = abs(float(np.interp(t, C['t'], C['slip'])))
    ov = R.tyres_over(c, t) or 0
    j = int(np.interp(t, C['t'], C['j']))
    ev = R.own[c]['V'][j] if c in R.own else R.R[j, 2]
    v = float(np.interp(t, C['t'], C['v']))
    return sl < 10 and ov < 4 and v >= 0.6 * ev


def touch_facts(R, N, a, b, t, t_end, game_only):
    nm = lambda c: N.get(c, f'car {c}')
    A = I.analyse_touch(R, a, b, t)
    f, k = A['front'], A['back']
    cw, cx = A['cars'], A['ctx']
    cd = {c: (A['corner'].get(c) or {}) for c in (f, k)}
    aft = {}
    for c in (f, k):
        C = R.cars[c]
        m = (C['t'] > t) & (C['t'] <= t_end + 2.5)
        aft[nm(c)] = dict(max_slip_deg=round(float(np.max(np.abs(C['slip'][m])))) if m.any() else 0,
                          off_track_s=sum(0.25 for tt in np.arange(t, t_end + 2.5, 0.25) if (R.tyres_over(c, tt) or 0) >= 4),
                          speed_drop_kmh=round(float(np.interp(t - 0.2, C['t'], C['v']) - (np.min(C['v'][m]) if m.any() else 0))))
    def own(c, key):
        v = cw[c].get(key)
        return None if v is None else v
    per = {}
    for c in (f, k):
        w = cw[c]
        per[nm(c)] = dict(
            role='front' if c == f else 'behind',
            speed_kmh=w.get('speed'),
            moved_toward_other_last_1s_m=w.get('moved_toward_1s'),
            moved_vs_expected_line_toward_other_1s_m=w.get('off_expected_toward_1s'),
            deviation_from_expected_line_m=w.get('dev_from_expected'),
            room_left_on_far_side_m=w.get('room_away_m'),
            brake_now=w.get('brk'), brake_normal_own=w.get('own_brk'), brake_normal_field=w.get('field_brk'),
            off_track_before_s=w.get('off_before_s'), slip_before_deg=w.get('slip_max_before'),
            brake_point_later_than_own_pct=cd[c].get('late_vs_own_pct'),
            apex_speed_over_own_pct=cd[c].get('apex_over_own_pct'))
    return dict(
        t=round(float(t), 2), time=mmss(t), t_end=round(float(t_end), 2), cars=[nm(a), nm(b)],
        where=phase_txt(R, cx), lap=A['lap'], game_logged_only=game_only,
        front=nm(f), behind=nm(k),
        overlap_m=A['overlap'], overlap_note='metres the car behind has its nose past the front car tail; 5.1 = level, <1 = behind',
        overlap_history_m=A['overlap_hist'], side_gap_m=A['lat_gap'], closing_kmh=A['closing_kmh'],
        inside_car=nm(A['inside']) if A['inside'] is not None else None,
        hold_line_sim_min_gap_m=A['sim'], per_car=per, after=aft)


def run(rec):
    R = scene.race(rec)
    N = names(R)
    nm = lambda c: N.get(c, f'car {c}')
    colls = [dict(e) for e in R.m['coll'] if e['a'] in R.cars and e['b'] in R.cars and e['t'] > 5
             and in_race(R, e['a'], e['t']) and in_race(R, e['b'], e['t'])]
    # skip pit-lane contacts
    colls = [e for e in colls if not any(np.interp(e['t'], R.cars[c]['t'], R.raw[c][:, scene.I['pit_status']]) >= 1 for c in (e['a'], e['b']))]
    out = []
    for n, g in enumerate(group(colls), 1):
        t0, t1 = g[0]['t'], g[-1]['t']
        pairs = sorted({(min(e['a'], e['b']), max(e['a'], e['b'])) for e in g})
        T = []
        for a, b in pairs:
            ev = [e['t'] for e in g if {e['a'], e['b']} == {a, b}]
            runs = I.touches(R, a, b, t0 - 1.0, t1 + 1.0)
            used = set()
            for r in runs:
                if any(abs(r['t'] - x) <= 0.6 or r['t'] - 0.6 <= x <= r['t_end'] + 0.6 for x in ev):
                    T.append((r['t'], r['t_end'], a, b, False))
                    used |= {x for x in ev if r['t'] - 0.6 <= x <= r['t_end'] + 0.6}
            for x in ev:
                if x not in used and not any(abs(x - q[0]) < 1.0 and {q[2], q[3]} == {a, b} for q in T):
                    T.append((x, x, a, b, True))
        T.sort()
        cars = sorted({c for q in T for c in q[2:4]})
        touches = []
        for (t, te, a, b, gm) in T[:8]:
            try:
                touches.append(touch_facts(R, N, a, b, t, te, gm))
            except Exception as ex:
                touches.append(dict(t=round(t, 2), time=mmss(t), cars=[nm(a), nm(b)], error=str(ex)[:120]))
        start = T[0][0] - 1.0
        end = T[-1][1]
        for tt in np.arange(T[-1][1], T[-1][1] + 6.01, 0.25):
            end = tt
            if all(recovered(R, c, tt) for c in cars):
                break
        cons = []
        for c in cars:
            C = R.cars[c]
            lt = I.lost_time(R, c, T[0][0])
            p0 = int(round(np.interp(start - 1, C['t'], C['pos'])))
            p1 = int(round(np.interp(end + 3, C['t'], C['pos'])))
            m = (C['t'] >= T[0][0]) & (C['t'] <= end + 1)
            sl = int(np.max(np.abs(C['slip'][m]))) if m.any() else 0
            off = sum(0.25 for tt in np.arange(T[0][0], end + 1, 0.25) if (R.tyres_over(c, tt) or 0) >= 4)
            ret = bool(np.interp(end + 5, C['t'], C['res']) >= 4) if C['t'][-1] > end + 5 else bool(C['res'][-1] >= 4)
            cons.append(dict(car=nm(c), lost_s=lt if lt is not None and lt < 29 else None, from_pos=p0, to_pos=p1,
                             max_slip_deg=sl, spun=sl > 45, off_track_s=off, retired=ret))
        out.append(dict(n=n, start=mmss(start), end=mmss(float(end)), t_start=round(float(start), 1),
                        lap=touches[0].get('lap') if touches else None, cars=[nm(c) for c in cars],
                        touch_count=len(T), game_contact_severity_max=max(e.get('severity', 0) for e in g),
                        touches=touches, consequences=cons))
    info = dict(R.m['info'])
    res = dict(recording=rec, track=R.track, info=info, drivers={nm(c): c for c in R.cars}, incidents=out)
    os.makedirs(os.path.join(WORK, 'facts'), exist_ok=True)
    json.dump(res, open(os.path.join(WORK, 'facts', rec + '.json'), 'w'), indent=1, default=float)
    return res


if __name__ == '__main__':
    r = run(sys.argv[1])
    print(r['track'], len(r['incidents']), 'incidents')
