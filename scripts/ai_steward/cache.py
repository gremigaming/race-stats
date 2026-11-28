"""Recording (.gmtel.gz) -> npz + meta json that scene.py reads (copy of rulebook-v17/v19/cache.py)."""
import sys, os, json
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'telemetry'))
import gmtel

K = ['x', 'z', 'vx', 'vz', 'fx', 'fz', 'rx', 'rz', 'speed', 'throttle', 'brake', 'steer', 'lap', 'lap_distance',
     'total_distance', 'position', 'pit_status', 'driver_status', 'result_status', 'surface_rl', 'surface_rr',
     'surface_fl', 'surface_fr']


def cache(path, work):
    os.makedirs(os.path.join(work, 'npz'), exist_ok=True)
    base = os.path.basename(path).replace('.gmtel.gz', '')
    if os.path.exists(os.path.join(work, 'npz', base + '.json')):
        return base
    s = gmtel.Session(path)
    ts = sorted(s.field)
    cars = set()
    for t in ts:
        cars |= set(s.field[t])
    out = {}
    for c in cars:
        rows, last = [], {}
        for t in ts:
            r = s.field[t].get(c)
            if r is None:
                continue
            last.update(r)
            if 'x' not in r:
                continue
            rows.append([t] + [float(last.get(k, np.nan)) for k in K])
        if rows:
            out[str(c)] = np.array(rows, dtype=np.float64)
    meta = {'drivers': {str(k): v for k, v in s.drivers.items()}, 'coll': s.collisions, 'info': s.info,
            'weather': s.weather, 'K': ['t'] + K}
    np.savez_compressed(os.path.join(work, 'npz', base + '.npz'), **out)
    json.dump(meta, open(os.path.join(work, 'npz', base + '.json'), 'w'), default=str)
    return base


if __name__ == '__main__':
    print(cache(sys.argv[1], os.environ.get('STEWARD_WORK', '/tmp/ai-steward/')))
