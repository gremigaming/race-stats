#!/usr/bin/env python3
"""Performance Rating (PR): how fast and how good in a battle each league driver is.

GreMi approved this on 25 Nov 2026 (Hexagon emblem, Bronze/Silver/Gold I-III, 1.0-10.0).
Reads the race files build-league-data.mjs wrote (aliases, hidden names, backups, test
sessions and non-stream races already handled) and writes league/performance.json.

    PR = race pace 35% + one lap 15% + consistency 15% + overtaking 15% + defending 10%
         + track discipline 10%, every part 1.0-10.0 (1 + 9 * q, q in 0..1)

Battle tells (brake points, steering corrections, off-tracks) come from the all-car rows of
the .gmtel.gz race recordings that the fault engine matched to each race (verdicts/<file>).
Each recording is measured once and kept in <cache>/perf-tells/. No recordings: no
telemetry tells, the rest still works.

    python3 scripts/performance_rating.py [telemetry cache]
"""
import collections, datetime, glob, json, math, os, re, statistics, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "telemetry"))

SESSIONS = os.environ.get("LEAGUE_SESSIONS_DIR", os.path.join("public", "league", "sessions"))
OUT = os.environ.get("PR_OUT", os.environ.get("SR_OUT", os.path.join("public", "league")))
CACHE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/telemetry-cache"
VERDICTS = os.environ.get("SR_VERDICTS", os.path.join(CACHE, "verdicts"))
FIRST_DAY = datetime.datetime(2026, 10, 19)   # telemetry for every car starts here
MIN_RACES = 5
ACTIVE_DAYS = 30          # ranked: raced within this many days of the newest race
TELL_VERSION = 1
WEIGHTS = {"pace": .35, "onelap": .15, "consistency": .15, "overtaking": .15, "defending": .10, "awareness": .10}

AI_RE = re.compile(r" #\d+$|^Player$")
nm = lambda n: re.sub(r"\s+", " ", n or "").strip()   # noqa: E731
REAL = set()


def stamp(f):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)", os.path.basename(f))
    return datetime.datetime(*map(int, m.groups())) if m else None


def is_real(c):
    p = c.get("participant-data")
    if not p:
        return not AI_RE.search(nm(c.get("driver-name")))
    return p.get("show-online-names") is not False and not (p.get("ai-controlled") and p.get("driver-id") not in (255, 65535))


def hidden(n):
    return bool(AI_RE.search(n)) and n not in REAL


files = sorted((f for f in glob.glob(os.path.join(SESSIONS, "*.json")) if stamp(f) and stamp(f) >= FIRST_DAY), key=stamp)
files = [f for f in files if re.match(r"(Race|One_Shot_Qualifying|Qualifying|Short_Qualifying)_", os.path.basename(f))]
loaded = []
for f in files:
    try:
        d = json.load(open(f, encoding="utf-8"))
    except Exception:
        continue
    if not d.get("classification-data"):
        continue
    loaded.append((f, d))
    for c in d["classification-data"]:
        if c.get("driver-name") and is_real(c):
            REAL.add(nm(c["driver-name"]))

RACEMEDS = []
D = collections.defaultdict(lambda: collections.defaultdict(list))
last_seen = {}
race_files = []       # (file, {car index: name}) for the telemetry tells
nraces = 0
for f, d in loaded:
    st = (d.get("session-info") or {}).get("session-type", "")
    track = (d.get("session-info") or {}).get("track-id")
    cars = [dict(c, **{"driver-name": nm(c["driver-name"])}) for c in d["classification-data"] if c.get("driver-name")]
    humans = [c for c in cars if not hidden(c["driver-name"])]
    if "Qualifying" in st:
        best = [(c["driver-name"], (c.get("final-classification") or {}).get("best-lap-time-ms") or 0) for c in cars]
        best = [(n, t) for n, t in best if t > 0]
        if len(best) < 5:
            continue
        pole = min(t for _, t in best)
        for n, t in best:
            if not hidden(n):
                D[n]["quali_gap"].append((t - pole) / pole * 100)
        continue
    if st != "Race" or len(cars) < 6:
        continue
    # race pace: median of valid laps 2+ within 4% of the driver's own median
    med, laps = {}, {}
    for c in cars:
        lh = (c.get("session-history") or {}).get("lap-history-data") or []
        ls = [l["lap-time-in-ms"] for k, l in enumerate(lh) if k > 0 and l.get("lap-time-in-ms", 0) > 0 and (l.get("lap-valid-bit-flags", 15) & 1)]
        if len(ls) < 2:
            continue
        m0 = statistics.median(ls)
        ls = [x for x in ls if x < m0 * 1.04]
        if len(ls) < 2:
            continue
        laps[c["driver-name"]] = ls
        med[c["driver-name"]] = statistics.median(ls)
    if len(med) < 5:
        continue
    nraces += 1
    race_files.append((os.path.basename(f), {c.get("index"): c["driver-name"] for c in humans if c.get("index") is not None}))
    ref = min(med.values())
    RACEMEDS.append({k: v for k, v in med.items() if not hidden(k)})
    fastest = min(min(v) for v in laps.values())
    for n, m in med.items():
        if hidden(n):
            continue
        D[n]["pace_gap"].append((m - ref) / ref * 100)
        D[n]["best_gap"].append((min(laps[n]) - fastest) / fastest * 100)
        if len(laps[n]) >= 3:
            D[n]["cv"].append(statistics.pstdev(laps[n]) / statistics.mean(laps[n]) * 100)
    made, lost_slower = collections.Counter(), collections.Counter()
    for o in (d.get("overtakes") or {}).get("records") or []:
        a, b = nm(o.get("overtaking-driver-name")), nm(o.get("overtaken-driver-name"))
        if o.get("overtaking-driver-lap", 0) <= 1:
            continue   # lap 1 counts as the start
        made[a] += 1
        if a in med and b in med and med[a] > med[b]:
            lost_slower[b] += 1
    ph = {nm(p["name"]): p["driver-position-history"] for p in d.get("position-history") or [] if p.get("name")}
    traps = {nm(s["name"]): s["speed-trap-record-kmph"] for s in d.get("speed-trap-records") or [] if s.get("speed-trap-record-kmph")}
    trap_med = statistics.median(traps.values()) if len(traps) >= 5 else None
    for c in humans:
        n = c["driver-name"]
        fc = c.get("final-classification") or {}
        D[n]["races"].append(track)
        last_seen[n] = stamp(f)
        D[n]["slower_cars"].append(sum(1 for v in med.values() if n in med and v > med[n]))
        D[n]["made"].append(made[n])
        D[n]["lost_slower"].append(lost_slower[n])
        h = ph.get(n) or []
        p0 = next((x["position"] for x in h if x.get("lap-number") == 0), None)
        p1 = next((x["position"] for x in h if x.get("lap-number") == 1), None)
        if p0 and p1:
            D[n]["lap1"].append(p0 - p1)
        w = c.get("warning-penalty-history") or []
        D[n]["cuts"].append(sum(1 for e in w if "Corner Cutting" in (e.get("entry-type") or "")))
        D[n]["pens"].append(fc.get("num-penalties") or 0)
        if trap_med and n in traps:
            D[n]["trap"].append(traps[n] - trap_med)
print("performance rating: races used", nraces)

# ---- telemetry tells, measured once per recording
OFF = {3, 4, 5, 6, 7, 8}  # water, rock, gravel, mud, sand, grass


def measure(path):
    """Per car index: brake onset gaps to the field per zone, steering reversals, off-tracks, km."""
    import gmtel
    s = gmtel.Session(path)
    L = s.info.get("track_length") or 5000
    last, per = {}, collections.defaultdict(list)
    for t in sorted(s.field):
        for i, r in s.field[t].items():
            st = last.setdefault(i, {})
            st.update(r)
            if "speed" in r and "lap_distance" in st:
                per[i].append((t, dict(st)))
    onsets = {}
    for i, rows in per.items():
        o, prev = [], None
        for _, r in rows:
            if r.get("lap", 0) < 2 or r.get("pit_status"):
                prev = r
                continue
            if prev is not None and prev.get("brake", 0) < 0.15 and r.get("brake", 0) >= 0.4 and r["speed"] > 140:
                o.append((r["lap"], r["lap_distance"]))
            prev = r
        onsets[i] = o
    ds = sorted(x for o in onsets.values() for _, x in o if 0 < x < L)
    zones, cur = [], []
    for x in ds:
        if cur and x - cur[-1] > 60:
            zones.append(cur)
            cur = []
        cur.append(x)
    if cur:
        zones.append(cur)
    nlapcars = sum(len(set(l for l, _ in o)) for o in onsets.values()) or 1
    zones = [statistics.median(z) for z in zones if len(z) >= 0.35 * nlapcars]
    zone_pts = collections.defaultdict(dict)
    for i, o in onsets.items():
        for _, x in o:
            if not zones:
                break
            zi = min(range(len(zones)), key=lambda k: abs(zones[k] - x))
            if abs(zones[zi] - x) <= 120:
                zone_pts[zi].setdefault(i, []).append(x)
    zone_med = {}
    for zi, cs in zone_pts.items():
        meds = [statistics.median(v) for v in cs.values()]
        if len(meds) >= 5:
            zone_med[zi] = statistics.median(meds)
    res = {}
    for i, rows in per.items():
        if len(rows) < 300:
            continue
        brake = [zone_med[zi] - statistics.median(cs[i]) for zi, cs in zone_pts.items() if zi in zone_med and i in cs]
        dist = rev = offs = 0
        off_on = False
        sdir, ext = 0, None
        for k in range(1, len(rows)):
            t0, _ = rows[k - 1]
            t1, b = rows[k]
            if b.get("lap", 0) < 2 or b.get("pit_status"):
                continue
            dt = t1 - t0
            if dt <= 0 or dt > 0.5:
                continue
            dist += b["speed"] / 3.6 * dt
            if b["speed"] > 120 and b.get("brake", 0) < 0.05:
                st = b.get("steer", 0)
                if ext is None:
                    ext = st
                dd = st - ext
                if sdir >= 0 and dd < -0.06:
                    rev += sdir > 0
                    sdir, ext = -1, st
                elif sdir <= 0 and dd > 0.06:
                    rev += sdir < 0
                    sdir, ext = 1, st
                elif (sdir > 0 and st > ext) or (sdir < 0 and st < ext):
                    ext = st
            off = sum(1 for x in (b.get("surface_rl"), b.get("surface_rr"), b.get("surface_fl"), b.get("surface_fr")) if x in OFF) >= 3
            if off and not off_on:
                offs += 1
            off_on = off
        if dist > 2000:
            res[str(i)] = {"brake": [round(x, 1) for x in brake], "rev": rev, "offs": offs, "km": round(dist / 1000, 2)}
    return res


TELL = collections.defaultdict(lambda: collections.defaultdict(list))
tdir = os.path.join(CACHE, "perf-tells")
measured = 0
for file, idx in race_files:
    vf = os.path.join(VERDICTS, file)
    try:
        rec = json.load(open(vf, encoding="utf-8")).get("recording")
    except Exception:
        continue
    if not rec:
        continue
    cf = os.path.join(tdir, rec + ".json")
    data = None
    try:
        c = json.load(open(cf, encoding="utf-8"))
        if c.get("v") == TELL_VERSION:
            data = c["cars"]
    except Exception:
        pass
    if data is None:
        path = os.path.join(CACHE, rec)
        if not os.path.exists(path):
            try:
                import incident_replays as ir
                path = ir.download(rec, CACHE)
            except Exception as ex:
                print(file, ": recording not available for tells:", ex)
                continue
        try:
            data = measure(path)
        except Exception as ex:
            print(file, ": tells not measured:", ex)
            continue
        os.makedirs(tdir, exist_ok=True)
        json.dump({"v": TELL_VERSION, "cars": data}, open(cf + ".tmp", "w"))
        os.replace(cf + ".tmp", cf)
        measured += 1
    for i, n in idx.items():
        x = data.get(str(i))
        if not x:
            continue
        o = TELL[n]
        o["races"].append(file)
        o["brake"] += x["brake"]
        o["rev_km"].append(x["rev"] / x["km"])
        o["offs"].append(x["offs"])
        o["km"].append(x["km"])
print("performance rating: recordings measured now", measured, "· drivers with telemetry", len(TELL))


def tell_stats(n):
    o = TELL.get(n)
    if not o:
        return {}
    km = sum(o["km"])
    return {"races": len(o["races"]), "km": round(km, 1),
            "brake_early_m": round(statistics.median(o["brake"]), 1) if len(o["brake"]) >= 8 else None,
            "steer_rev_km": round(statistics.mean(o["rev_km"]), 2) if o["rev_km"] else None,
            "offs_per_10km": round(sum(o["offs"]) / (km / 10), 2) if km else None}


# ---- scores
mean = lambda v: statistics.mean(v) if v else None      # noqa: E731
median = lambda v: statistics.median(v) if v else None  # noqa: E731
P = {}
for n, o in D.items():
    if len(o["races"]) < MIN_RACES or n not in last_seen:
        continue
    P[n] = {"races": len(o["races"]), "last": last_seen[n],
            "pace_gap": median(o["pace_gap"]), "best_gap": median(o["best_gap"]),
            "quali_gap": median(o["quali_gap"]), "quali_n": len(o["quali_gap"]), "cv": median(o["cv"]),
            "made": mean(o["made"]), "lost_slower_sum": sum(o["lost_slower"]), "slower_cars_sum": sum(o["slower_cars"]),
            "lap1": mean(o["lap1"]), "cuts": mean(o["cuts"]), "pens": mean(o["pens"]), "trap": mean(o["trap"]),
            "recent": mean(o["pace_gap"][-6:]), "older": mean(o["pace_gap"][:-6]) if len(o["pace_gap"]) > 8 else None}
newest = max((p["last"] for p in P.values()), default=datetime.datetime.now())
P = {n: p for n, p in P.items() if p["pace_gap"] is not None and (newest - p["last"]).days <= ACTIVE_DAYS}
cl = lambda x: max(0.0, min(1.0, x))        # noqa: E731
sc = lambda q: round(1 + 9 * cl(q), 1)      # noqa: E731
LEAGUE_DEF = sum(o["lost_slower_sum"] for o in P.values()) / max(1, sum(o["slower_cars_sum"] for o in P.values()))
PRIOR = 20
rows = []
for n, o in P.items():
    t = tell_stats(n)
    onelap = o["quali_gap"] if o["quali_n"] >= 2 else o["best_gap"]
    def_rate = (o["lost_slower_sum"] + LEAGUE_DEF * PRIOR) / (o["slower_cars_sum"] + PRIOR)
    cat = {
        "pace": sc(math.exp(-o["pace_gap"] / 2.5)),
        "onelap": sc(math.exp(-(onelap or 0) / 2.5)),
        "consistency": sc(1 - ((o["cv"] or 1) - 0.4) / 1.2),
        "overtaking": sc(((o["made"] or 0) + max(o["lap1"] or 0, 0) * 0.5) / 7),
        "defending": sc(1 - def_rate / 0.6),
        "awareness": sc(1 - ((o["cuts"] or 0) * 0.18 + (o["pens"] or 0) * 0.15 + (t.get("offs_per_10km") or 0) * 0.04)),
    }
    pr = sum(cat[k] * WEIGHTS[k] for k in WEIGHTS)
    rows.append({"name": n, "pr": round(pr, 1), "prx": pr, "cat": cat, "o": o, "t": t, "onelap": onelap or 0,
                 "def_rate": def_rate, "def_n": o["slower_cars_sum"]})
rows.sort(key=lambda r: -r["prx"])


def fmed(vals):
    v = [x for x in vals if x is not None]
    return statistics.median(v) if v else None


fm = {"steer_rev_km": fmed(r["t"].get("steer_rev_km") for r in rows),
      "offs_per_10km": fmed(r["t"].get("offs_per_10km") for r in rows),
      "cuts": fmed(r["o"]["cuts"] for r in rows), "cv": fmed(r["o"]["cv"] for r in rows), "def_rate": LEAGUE_DEF}
TEL = "Telemetry from {} races"
for r in rows:
    o, t = r["o"], r["t"]
    tells = []   # (strength, kind, title, means, how)
    tel_ok = t.get("km", 0) >= 80
    b = t.get("brake_early_m")
    how_b = "Where they start braking for each big braking zone, compared with the middle of the field in the same race. " + TEL.format(t.get("races", 0)) + "."
    if b is not None and abs(b) >= 5 and tel_ok:
        if b > 0:
            tells.append((b / 4, "brake", f"Brakes {b:.0f} m earlier than most drivers",
                          "When you're behind them going into a big stop, you can brake later and get alongside or past.", how_b))
        else:
            tells.append((-b / 4, "brake", f"Brakes {-b:.0f} m later than most drivers",
                          "They're strong on the brakes and will try a late lunge. When they're close behind, protect the inside before the braking zone.", how_b))
    s = t.get("steer_rev_km")
    how_s = "How often they flick the wheel back and forth at speed (not braking), per km, compared with the field. " + TEL.format(t.get("races", 0)) + "."
    if s is not None and fm["steer_rev_km"] and tel_ok:
        rel = s / fm["steer_rev_km"] - 1
        if rel > 0.15:
            tells.append((rel * 6, "steer", f"Fights the car: {rel * 100:.0f}% more steering corrections",
                          "Their car moves around a lot. Stay close on corner exits; pressure can force a slide or a mistake.", how_s))
        elif rel < -0.15:
            tells.append((-rel * 6, "steer", f"Very smooth: {-rel * 100:.0f}% fewer steering corrections",
                          "Calm and tidy in the car. Don't wait for them to make a mistake; you'll need to make the pass yourself.", how_s))
    off = t.get("offs_per_10km")
    if off is not None and fm["offs_per_10km"] is not None and t.get("km", 0) > 40 and off > fm["offs_per_10km"] * 1.6 and off > 0.6:
        tells.append((off / max(fm["offs_per_10km"], .2), "offtrack", f"Runs wide often: {off:.1f} times per 10 km",
                      "Expect a wide moment sooner or later. Stay close and be ready to go for the gap, but don't follow them onto the grass.",
                      f"Three or more wheels on grass or gravel. The middle of the field does this {fm['offs_per_10km']:.1f} times per 10 km. " + TEL.format(t.get("races", 0)) + "."))
    trap = o["trap"]
    if trap is not None and abs(trap) >= 3:
        how_t = "Their speed-trap top speed compared with the middle of the field in the same race."
        if trap > 0:
            tells.append((trap / 3, "speed", f"Fast on the straights: +{trap:.0f} km/h",
                          "Hard to pass with DRS alone. Plan your move in a braking zone or a corner.", how_t))
        else:
            tells.append((-trap / 3, "speed", f"Slow on the straights: {trap:.0f} km/h",
                          "Get a good exit out of the corner before a long straight; a slipstream or DRS pass is likely to work.", how_t))
    lap1 = o["lap1"]
    how_l = "Grid position compared with their position at the end of lap 1, on average."
    if lap1 is not None and abs(lap1) >= 1.5:
        if lap1 > 0:
            tells.append((lap1 / 1.2, "start", f"Strong starter: gains {lap1:.1f} places on lap 1",
                          "If they start behind you, expect them to attack into turn 1. Cover the inside.", how_l))
        else:
            tells.append((-lap1 / 1.2, "start", f"Slow starter: loses {-lap1:.1f} places on lap 1",
                          "If you start behind them, lap 1 is your best chance to get past.", how_l))
    if r["def_n"] >= 15 and r["def_rate"] >= 0.4:
        tells.append((r["def_rate"] * 5, "defend", "Gives places away under pressure",
                      "Slower cars get past them more often than usual. Stay in their mirrors; they may crack.",
                      f"Out of every 10 slower cars in their races, {r['def_rate'] * 10:.0f} got past them on track (league: {LEAGUE_DEF * 10:.0f})."))
    if (o["cuts"] or 0) >= 2:
        tells.append((o["cuts"] / 1.2, "limits", f"Track limits: {o['cuts']:.1f} warnings a race",
                      "They are often close to a time penalty. Late in the race, they may have to back off or give a place back.",
                      f"Corner-cutting warnings from the game per race (league middle: {fm['cuts']:.1f})."))
    cv = o["cv"]
    if cv is not None and cv <= 0.55:
        tells.append((1.4, "metronome", "Like clockwork lap after lap",
                      "They won't drop off. If they're ahead, you need real pace to catch them, not just patience.",
                      f"Their clean laps differ by only {cv:.2f}% on average (league middle: {fm['cv']:.2f}%)."))
    if cv is not None and cv >= 1.1:
        tells.append((cv, "variable", "Up and down lap times",
                      "Some laps are much slower than others. Hang on; a chance will come.",
                      f"Their clean laps differ by {cv:.1f}% on average (league middle: {fm['cv']:.2f}%)."))
    tells.sort(key=lambda x: -x[0])
    r["tells"] = [{"kind": k, "title": a, "means": m, "how": h} for _, k, a, m, h in tells[:4]]

r2 = lambda x, n=2: None if x is None else round(x, n)   # noqa: E731
out = [{"name": r["name"], "pr": r["pr"], "cat": r["cat"], "tells": r["tells"], "races": r["o"]["races"],
        "last": r["o"]["last"].strftime("%Y-%m-%d"),
        "pace_gap": r2(r["o"]["pace_gap"]), "onelap_gap": r2(r["onelap"]), "onelap_src": "quali" if r["o"]["quali_n"] >= 2 else "best lap",
        "cv": r2(r["o"]["cv"] or 0), "made": r2(r["o"]["made"] or 0, 1), "def_rate": r2(r["def_rate"]), "def_n": r["def_n"],
        "cuts": r2(r["o"]["cuts"] or 0, 1), "lap1": r2(r["o"]["lap1"] or 0, 1), "trap": r2(r["o"]["trap"] or 0, 1),
        "brake": r["t"].get("brake_early_m"), "steer": r["t"].get("steer_rev_km"), "offs": r["t"].get("offs_per_10km"),
        "tel_races": r["t"].get("races", 0), "tel_km": r["t"].get("km", 0),
        "recent": r2(r["o"]["recent"]), "older": r2(r["o"]["older"])} for r in rows]
names = {r["name"] for r in rows}
pairs = collections.defaultdict(list)
for rm in RACEMEDS:
    for a in rm:
        for b in rm:
            if a < b and a in names and b in names:
                pairs[a + "|" + b].append(rm[b] - rm[a])
os.makedirs(OUT, exist_ok=True)
data = {"version": 1, "built": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "since": FIRST_DAY.strftime("%Y-%m-%d"), "races": nraces, "min_races": MIN_RACES, "active_days": ACTIVE_DAYS,
        "weights": WEIGHTS, "field": {k: r2(v, 3) for k, v in fm.items()},
        "drivers": out, "pairs": {k: [round(statistics.median(v)), len(v)] for k, v in pairs.items()}}
path = os.path.join(OUT, "performance.json")
json.dump(data, open(path + ".tmp", "w", encoding="utf-8"), separators=(",", ":"))
os.replace(path + ".tmp", path)
print(f"performance rating: {len(out)} drivers ranked -> {path}")
for r in out[:40]:
    print(f"  {r['name']:24} {r['pr']:4.1f}  " + " ".join(f"{k}={v}" for k, v in r["cat"].items()) + f"  tel={r['tel_races']}")
