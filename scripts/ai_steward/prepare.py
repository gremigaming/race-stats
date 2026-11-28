"""AI steward, step 1 (no AI): find today's new race recordings, build fact sheets for the steward.

  python3 scripts/ai_steward/prepare.py 2026-11-28 [--from 13:30 --to 17:30]

For each new '<date>_..._Race.gmtel.gz' in the telemetry release that has no grading/ai-steward/<date>/<rec>.verdicts.json
yet: download -> cache.py -> facts.py -> grading/ai-steward/<date>/<rec>.facts.json (compact) with the live engine's
call for each incident added (engine_call) for comparison. Prints the fact files that still need verdicts.
"""
import json, os, re, sys, urllib.request, argparse
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
os.environ.setdefault('STEWARD_WORK', '/tmp/ai-steward/')
WORK = os.environ['STEWARD_WORK']
sys.path.insert(0, HERE)

REL = 'https://api.github.com/repos/gremigaming/race-stats/releases/tags/telemetry'
DL = 'https://github.com/gremigaming/race-stats/releases/download/telemetry/'
LIVE = 'https://replays.gremigaming.com/league/'


def get(url, path=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'race-stats-ai-steward'})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    if path:
        open(path, 'wb').write(data)
    return data


def rnd(x):
    if isinstance(x, float):
        return round(x, 2)
    if isinstance(x, dict):
        return {k: rnd(v) for k, v in x.items() if v is not None and k != 'overlap_note'}
    if isinstance(x, list):
        return [rnd(v) for v in x]
    return x


def engine_calls():
    try:
        idx = json.loads(get(LIVE + 'index.json'))
        p = idx.get('assetPaths', {}).get('incidents.json')
        inc = json.loads(get(LIVE + p if p else LIVE + 'incidents.json'))['incidents']
    except Exception as e:
        print('engine calls unavailable:', e)
        return []
    out = []
    for x in inc:
        m = re.search(r'/race/([^?]+)_Race\?inc=([\d.]+)', x.get('watch') or '')
        if m:
            out.append(dict(rec=m.group(1), t=float(m.group(2)), pair=set((x.get('inc') or {}).get('pair') or []), names=x.get('names'), sev=x.get('sev'), type=x.get('type'),
                            steps=[dict(call=s.get('call'), why=s.get('why')) for s in x.get('steps', [])]))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('date')
    ap.add_argument('--from', dest='frm', default='00:00')
    ap.add_argument('--to', default='23:59')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    outdir = os.path.join(ROOT, 'grading', 'ai-steward', a.date)
    os.makedirs(outdir, exist_ok=True)
    os.makedirs(os.path.join(WORK, 'rec'), exist_ok=True)
    rel = json.loads(get(REL))
    names = sorted(x['name'] for x in rel.get('assets', []))
    want = []
    for n in names:
        m = re.match(r'(\d{4}-\d{2}-\d{2})_(\d{2})-(\d{2})-\d{2}_(.+)_Race\.gmtel\.gz$', n)
        if not m or m.group(1) != a.date:
            continue
        hm = f'{m.group(2)}:{m.group(3)}'
        if not (a.frm <= hm <= a.to):
            continue
        rec = n[:-len('_Race.gmtel.gz')]
        if a.only and a.only not in rec:
            continue
        if os.path.exists(os.path.join(outdir, rec + '.verdicts.json')):
            continue
        want.append((n, rec))
    if not want:
        print('NOTHING NEW')
        return
    eng = engine_calls()
    import cache, facts
    todo = []
    for n, rec in want:
        fp = os.path.join(outdir, rec + '.facts.json')
        if not os.path.exists(fp):
            p = os.path.join(WORK, 'rec', n)
            if not os.path.exists(p):
                get(DL + n, p)
            cache.cache(p, WORK)
            res = facts.run(rec)
            for x in res['incidents']:
                t = x['t_start'] + 1.0
                ids = set(x['car_ids'])
                x['engine_call'] = [dict(sev=e['sev'], type=e['type'], drivers=e['names'], steps=e['steps']) for e in eng
                                    if e['rec'] == rec and abs(e['t'] - t) <= 4.0 and e['pair'] and e['pair'] <= ids] or 'none (engine saw no incident here)'
            json.dump(rnd(res), open(fp, 'w'), indent=0, ensure_ascii=False, separators=(',', ':'))
        todo.append(fp)
        print('FACTS', os.path.relpath(fp, ROOT), len(json.load(open(fp))['incidents']), 'incidents')


if __name__ == '__main__':
    main()
