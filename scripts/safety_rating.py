"""Safety rating (SR) for the race stats site.

Reads the session files build-league-data.mjs wrote to public/league/sessions
and writes public/league/safety.json. The rules are in the GreMi Gang SR rules
(penalty points per incident, bonus points for clean driving; the SR comes from
your average points per race, older streams count 10% less each stream).
"""
import json, glob, re, sys, os, collections, statistics, math
AI = re.compile(r" #\d+$")  # AI and hidden names, e.g. "Ferrari '26 #28", "RB #46"
SEV = {"LOW": 0, "MEDIUM": 1, "HIGH": 2}
BASE = {"LOW": 0, "MEDIUM": 2, "HIGH": 4}
NAME = {"LOW": "light", "MEDIUM": "medium", "HIGH": "heavy"}
CAP = 25
SESSIONS = os.path.join("public", "league", "sessions")  # written by build-league-data.mjs (aliases applied, backups dropped)
nm_ = lambda n: re.sub(r"\s+", " ", n).strip()  # same as the leaderboard: "conor\xa0\xa0racing1" is "conor racing1"
stamp = lambda f: re.search(r"(\d{4}_\d\d_\d\d_\d\d_\d\d_\d\d)", f).group(1)

# ---- history over every race file: race count per driver, best laps for pace ratios
ALL = sorted(glob.glob(os.path.join(SESSIONS, "Race_*.json")), key=stamp)
race_no = {}            # (file, driver) -> how many races the driver had before this one
best = {}               # file -> {driver: best lap ms}
seen = collections.Counter()
for f in ALL:
    try: d = json.load(open(f))
    except Exception: continue
    best[f] = {}
    for c in d.get("classification-data") or []:
        n = nm_(c["driver-name"])
        if AI.search(n): continue
        race_no[(f, n)] = seen[n]; seen[n] += 1
        laps = [l["lap-time-in-ms"] for l in ((c.get("session-history") or {}).get("lap-history-data") or []) if l.get("lap-time-in-ms")]
        if laps: best[f][n] = min(laps)

def pace_ratio(x, y, skip):
    """Typical lap-time ratio x/y over earlier shared races (median), or None."""
    r = [b[x] / b[y] for f, b in best.items() if f != skip and x in b and y in b]
    return statistics.median(r) if len(r) >= 2 else None

def analyse(path):
    quali = "Qualifying" in path
    d = json.load(open(path))
    ev = sorted(d.get("race-control") or [], key=lambda m: m["timestamp"])
    cls = {c["index"]: c for c in d["classification-data"]}
    names = {i: nm_(c["driver-name"]) for i, c in cls.items()}
    public = {i: c.get("telemetry-settings") == "Public" for i, c in cls.items()}
    by_name = {c["driver-name"]: i for i, c in cls.items()}
    pos = {by_name[p["name"]]: {e["lap-number"]: e["position"] for e in p["driver-position-history"]}
           for p in d.get("position-history") or [] if p["name"] in by_name}
    kind = lambda t: [m for m in ev if m["message-type"] == t]
    over, dmg, pens, cols, rets, pits = (kind(k) for k in ("OVERTAKE", "CAR_DAMAGE", "PENALTY", "COLLISION", "RETIREMENT", "PITTING"))
    laps_of = lambda v: (cls[v].get("session-history") or {}).get("lap-history-data") or []
    pit_laps = collections.defaultdict(set)
    weather = (d.get("session-info") or {}).get("weather") or ""
    wet_track = weather in ("Light Rain", "Heavy Rain", "Storm")
    joke = collections.defaultdict(set)  # laps on tyres that don't fit the weather
    for i, c in cls.items():
        fc = c.get("final-classification") or {}
        start = 1
        for vis, end in zip(fc.get("tyre-stints-visual") or [], fc.get("tyre-stints-end-laps") or []):
            wrong = (vis in ("Inter", "Intermediate", "Wet")) != wet_track
            if wrong: joke[i] |= set(range(start, (end or 99) + 1))
            start = (end or 0) + 1
    for p in pits:
        for i in p["involved-drivers"]: pit_laps[i] |= {p["lap-number"], p["lap-number"] + 1}

    def order_before(t, lap):
        order = [i for i, _ in sorted(((i, h.get(lap - 1)) for i, h in pos.items() if h.get(lap - 1)), key=lambda x: x[1])]
        for o in over:
            if o["lap-number"] == lap and o["timestamp"] < t:
                a, b = o["overtaker-index"], o["overtaken-index"]
                if a in order and b in order: order.remove(a); order.insert(order.index(b), a)
        return order

    incs = []
    for c in cols:
        pair = tuple(sorted(c["involved-drivers"]))
        last = next((x for x in reversed(incs) if x["pair"] == pair and c["timestamp"] - x["t_end"] < 3), None)
        if last:
            last["t_end"] = c["timestamp"]
            if SEV[c["severity"]] > SEV[last["sev"]]: last["sev"] = c["severity"]
        else:
            seg = c.get("segment-info") or {}
            incs.append({"pair": pair, "t": c["timestamp"], "t_end": c["timestamp"], "sev": c["severity"], "lap": c["lap-number"],
                         "dist": c.get("lap-distance"), "sector": c.get("sector"),
                         "corner": seg.get("corner_number") if seg.get("type") == "corner" else None,
                         "where": seg.get("name") or (f"turn {seg.get('corner_number')}" if seg.get("corner_number") else c.get("sector"))})

    # ---- when does each car count as damaged
    dmg_time = {}   # Public: first moment a front or rear wing is at 50%+
    for m in dmg:
        i = (m["involved-drivers"] or [None])[0]
        if public.get(i) and m["new-value"] >= 50 and i not in dmg_time: dmg_time[i] = m["timestamp"]
    dmg_lap = {}    # Public: from per-lap damage; Restricted: from pace
    dmg_why = {}
    for i, c in cls.items():
        if public[i]:
            for p in c.get("per-lap-info") or []:
                cd = p.get("car-damage-data") or {}
                if max(cd.get("front-left-wing-damage", 0), cd.get("front-right-wing-damage", 0)) >= 50 or cd.get("rear-wing-damage", 0) >= 50:
                    dmg_lap[i] = p["lap-number"] + 1; dmg_why[i] = f"wing damage 50%+ after lap {p['lap-number']}"; break
    dmg_until = {}  # a pit stop (new wing) ends the damaged state
    for i in cls:
        laps = laps_of(i)
        for inc in incs:
            if i not in inc["pair"] or i in dmg_lap: continue
            c_lap = inc["lap"]
            # a pit stop within 2 laps after a contact: nobody stops for tyres in a 5-lap race
            stop = next((p for p in pits if i in p["involved-drivers"] and p["timestamp"] > inc["t"] and p["lap-number"] <= c_lap + 2), None)
            if stop:
                dmg_lap[i] = c_lap; dmg_until[i] = stop["timestamp"]; dmg_why[i] = f"pitted on lap {stop['lap-number']} after a contact on lap {c_lap}"; break
            if public[i]: continue
            after = [k for k in range(c_lap + 1, len(laps) + 1) if laps[k - 1].get("lap-time-in-ms") and k not in pit_laps[i]]
            if not after: continue
            own = [laps[k - 1]["lap-time-in-ms"] for k in range(2, c_lap) if laps[k - 1].get("lap-time-in-ms") and k not in pit_laps[i]]
            if own:
                base_t = sum(own) / len(own); how = "own laps before the contact"
                ratio = sum(laps[k - 1]["lap-time-in-ms"] for k in after) / len(after) / base_t
            else:
                rs = []; npeers = set()
                for k in after:
                    peers = []
                    for j in cls:
                        if j == i or AI.search(names[i]) or AI.search(names[j]): continue
                        r = pace_ratio(names[i], names[j], path); pl = laps_of(j)
                        if r and abs(r - 1) <= 0.015 and k <= len(pl) and pl[k - 1].get("lap-time-in-ms") and k not in pit_laps[j]:
                            peers.append(pl[k - 1]["lap-time-in-ms"] * r); npeers.add(j)
                    if peers: rs.append(laps[k - 1]["lap-time-in-ms"] / (sum(peers) / len(peers)))
                if not rs: continue
                ratio = sum(rs) / len(rs); how = f"{len(npeers)} driver{'s' if len(npeers) > 1 else ''} usually close in pace"
            if ratio >= 1.03:
                dmg_lap[i] = c_lap + 1; dmg_why[i] = f"laps after lap {c_lap} {ratio - 1:+.0%} on average vs {how}"

    def is_damaged(v, inc):
        if v in dmg_time and dmg_time[v] < inc["t"]: return "front wing 50%+ earlier"
        if v in dmg_lap and dmg_lap[v] <= inc["lap"] and inc["t"] < dmg_until.get(v, 1e18): return dmg_why[v]
        return None

    used = set(); rows = []

    def damage_to(v, inc):
        if not public.get(v): return None
        nxt = min((x["t"] for x in incs if x is not inc and x["t"] > inc["t_end"] and v in x["pair"]), default=1e18)
        tot = 0
        for m in dmg:
            if (m["involved-drivers"] or [None])[0] != v: continue
            if not (inc["t"] - 0.5 <= m["timestamp"] <= min(inc["t_end"] + 1.5, nxt)): continue
            if inc["dist"] is not None and m.get("lap-distance") is not None and abs(m["lap-distance"] - inc["dist"]) > 150: continue
            tot += max(0, m["new-value"] - m["old-value"])
        return tot

    def slowed(v, inc):
        sec = (inc["sector"] or "").lstrip("S")
        if sec not in ("1", "2", "3"): return False, "no sector", 0
        key = f"sector-{sec}-time-in-ms"; laps = laps_of(v); L = inc["lap"]
        if L > len(laps) or not laps[L - 1].get(key):
            return True, "did not finish the sector", 10.0
        this = laps[L - 1][key]
        if L == 1:
            field1 = [laps_of(j)[0][key] for j in cls if laps_of(j) and laps_of(j)[0].get(key)]
            ratios = []
            for k in range(2, len(laps) + 1):
                fk = [laps_of(j)[k - 1][key] for j in cls if len(laps_of(j)) >= k and laps_of(j)[k - 1].get(key)]
                if laps[k - 1].get(key) and fk: ratios.append(laps[k - 1][key] / statistics.median(fk))
            exp = statistics.median(field1) * (statistics.median(ratios) if ratios else 1)
            return this >= exp * 1.05, f"sector {this / exp - 1:+.0%} vs the field's lap 1", (this - exp) / 1000
        others = [l[key] for k, l in enumerate(laps, 1) if k not in (1, L) and l.get(key)]
        if not others: return False, "no data", 0
        avg = sum(others) / len(others)
        return this >= avg * 1.05, f"sector {this / avg - 1:+.0%}", (this - avg) / 1000

    def places_lost(v, inc):
        n = 0
        for o in over:
            if not (inc["t"] <= o["timestamp"] <= inc["t_end"] + 5): continue
            seg = o.get("segment-info") or {}
            if seg.get("type") == "corner" and seg.get("corner_number") not in (None, inc["corner"]) and inc["corner"] is not None:
                break
            if o["overtaken-index"] == v: n += 1
            elif o["overtaker-index"] == v: n -= 1
        return max(0, n)

    time_used = set()

    def extras(x, y, inc, parts):
        pts = 0; m = 1.0 if inc["sev"] == "HIGH" else 0.5
        dm = damage_to(y, inc)
        if dm: k = int(dm // 25) * m; pts += k; k and parts.append(f"other car {dm}% damage +{k:g}")
        lost = places_lost(y, inc)
        slow, why, secs = slowed(y, inc)
        if lost:  # places the other car lost count once per sector, like lost time (pile-ups)
            pk = ("places", y, inc["lap"], inc["sector"])
            if pk in time_used: parts.append("other's lost places already counted in this sector"); lost = 0
            elif slow: time_used.add(pk)
        if not slow:
            if lost: parts.append(f"other lost {lost} place{'s' if lost > 1 else ''} but not slowed ({why}) +0")
            return pts
        secs = min(max(secs, 0), 10); skey = (y, inc["lap"], inc["sector"])
        if inc["lap"] in pit_laps[y]: secs = 0; parts.append("other pitted that lap, time lost not counted")
        elif skey in time_used: secs = 0; parts.append("other's lost time already counted in this sector")
        elif secs >= 2: time_used.add(skey)
        tp = int(secs // 2) * m; pp = lost * m
        if tp >= pp and tp: pts += tp; parts.append(f"other lost {secs:.1f} s ({why}{', ' + str(lost) + ' places' if lost else ''}) +{tp:g}")
        elif pp: pts += pp; parts.append(f"other lost {lost} place{'s' if lost > 1 else ''} ({why}, {secs:.1f} s) +{pp:g}")
        return pts

    def adjust(x, y, inc, pts, parts, game, repeat):
        dmgd = is_damaged(y, inc)
        if dmgd and pts: pts /= 2; parts.append(f"other car was damaged ({dmgd}) half")
        n = names[y]
        if not AI.search(n) and race_no.get((path, n), 99) < 3 and game != x and pts:
            parts.append(f"other driver is new (race {race_no[(path, n)] + 1}) 0"); pts = 0
        return min(pts, CAP)

    pair_count = collections.Counter()
    for inc in incs:
        a, b = inc["pair"]; t, te = inc["t"], inc["t_end"]
        repeat = pair_count[inc["pair"]] > 0; pair_count[inc["pair"]] += 1
        votes = collections.Counter(); why = collections.defaultdict(list); game = None
        # The game's collision calls for this pair: a real penalty is the game's blame;
        # a warning is one hint (the game often warns both cars), both warned = no hint
        hitp = [p for p in pens if "collision" in p["infringement-type"].lower() and p["vehicle-index"] in (a, b) and p["id"] not in used
                and p.get("other-vehicle-index") in (a, b, None) and t - 1 <= p["timestamp"] <= te + 10]
        real = [p for p in hitp if p["penalty-type"] != "Warning"]
        warned = {p["vehicle-index"] for p in hitp if p["penalty-type"] == "Warning"}
        for p in hitp: used.add(p["id"])
        if real:
            game = real[0]["vehicle-index"]; votes[game] += 2; why[game].append(f"game gave a {real[0]['penalty-type'].lower()}")
        elif len(warned) == 1:
            w = next(iter(warned)); votes[w] += 1; why[w].append("game gave a warning")
        da, db = damage_to(a, inc), damage_to(b, inc)
        if da is not None and db is not None:
            if da and not db: votes[a] += 1; why[a].append("only this car broke its front wing")
            if db and not da: votes[b] += 1; why[b].append("only this car broke its front wing")
        order = order_before(t, inc["lap"]); behind = None
        if a in order and b in order and abs(order.index(a) - order.index(b)) == 1:
            behind = a if order.index(a) > order.index(b) else b
        for o in over:
            if te <= o["timestamp"] <= te + 8 and {o["overtaker-index"], o["overtaken-index"]} == {a, b}:
                if o["overtaker-index"] == behind: votes[behind] += 1; why[behind].append("was behind and passed right after")
                break
        # right behind the other car, with no position swap in the 3 s before (so not side
        # by side as far as the data shows): one hint, it needs a second one to decide
        if not real and behind is not None:
            front = b if behind == a else a
            swapped = any(t - 3 <= o["timestamp"] < t and {o["overtaker-index"], o["overtaken-index"]} == {a, b} for o in over)
            if not swapped and warned != {front}: votes[behind] += 1; why[behind].append("was right behind")
        top = votes.most_common()
        culprit, n = (top[0] if top and (len(top) == 1 or top[0][1] > top[1][1]) else (None, 0))
        if culprit is not None and not (game == culprit or n >= 2): culprit = None
        base = BASE[inc["sev"]]; lines = {}
        if culprit is None:
            for x in (a, b):
                y = b if x == a else a
                parts = [f"{NAME[inc['sev']]} contact, shared blame {base / 2:g}"]
                ex = extras(x, y, inc, parts)
                if not ex and game != x: parts.append("no harm done, game did not blame you: 0")
                pts = base / 2 + ex / 2 if (ex or game == x) else 0  # shared: half the base and half the harm
                lines[x] = (adjust(x, y, inc, pts, parts, game, repeat), parts)
        else:
            other = b if culprit == a else a
            parts = [f"{NAME[inc['sev']]} contact, to blame ({', '.join(why[culprit])}) {base}"]
            if damage_to(other, inc) is None: parts.append("other car's damage hidden")
            pts = base + extras(culprit, other, inc, parts)
            r = next((r for r in rets if r["id"] not in used and (r["involved-drivers"] or [None])[0] == other
                      and "damage" in (r.get("reason") or "").lower() and t <= r["timestamp"] <= te + 120
                      and not any(x is not inc and te < x["t"] <= r["timestamp"] and other in x["pair"] for x in incs)), None)
            if r: used.add(r["id"]); pts += 10; parts.append("other retired from the damage +10")
            if pts == base and game != culprit: parts.append("no harm done, game did not blame you: 0"); pts = 0
            lines[culprit] = (adjust(culprit, other, inc, pts, parts, game, repeat), parts)
            p2 = [f"{NAME[inc['sev']]} contact, not to blame 0"]
            extras(other, culprit, inc, [])  # marks the time the culprit lost as counted
            lines[other] = (0, p2)
        rows.append({"file": path.split("/")[-1].rsplit("_2026", 1)[0], **inc, "pn": [names[a], names[b]], "lines": {names[k]: v for k, v in lines.items()},
                     "vs": {names[a]: names[b], names[b]: names[a]}})
    other = []
    for p in pens:
        if p["id"] in used: continue
        n, typ, inf = names.get(p["vehicle-index"]), p["penalty-type"], p["infringement-type"]
        if "Multiple Warnings" in inf or "collision" in inf.lower() or typ == "Retired": continue
        if typ == "Warning": continue
        elif typ == "Time Penalty": v = 2 if "Extreme" in inf else 1
        elif "Drive" in typ: v = 4
        elif "Stop" in typ: v = 6
        else: continue
        if quali and "Corner" in inf: continue  # an invalid qualifying lap costs nothing
        if p["lap-number"] in joke[p["vehicle-index"]]:
            other.append((n, 0, f"{typ.lower()}: {inf.lower()} (on wrong tyres for the weather, not counted)", p["lap-number"], path.split("/")[-1].rsplit("_2026", 1)[0])); continue
        other.append((n, v, f"{typ.lower()}: {inf.lower()}", p["lap-number"], path.split("/")[-1].rsplit("_2026", 1)[0]))
    for i, c in cls.items():
        if not quali and joke[i] and "DISQUALIF" in ((c.get("final-classification") or {}).get("result-status") or ""):
            other.append((names[i], 0, "disqualified on wrong tyres for the weather, not counted", "-", path.split("/")[-1].rsplit("_2026", 1)[0])); continue
        if not quali and "DISQUALIF" in ((c.get("final-classification") or {}).get("result-status") or ""):
            other.append((names[i], 10, "disqualified", "-", path.split("/")[-1].rsplit("_2026", 1)[0]))
    if not quali:
        for i, c in cls.items():
            if (c.get("final-classification") or {}).get("result-status") in ("RETIRED", "DID_NOT_FINISH"):
                if (c["final-classification"].get("num-laps") or 0) >= ((d.get("session-info") or {}).get("total-laps") or 99):
                    other.append((names[i], 0, "retired after crossing the finish line, not counted", "-", path.split("/")[-1].rsplit("_2026", 1)[0])); continue
                r = next((r for r in rets if i in r["involved-drivers"]), None)
                win = next((m["timestamp"] for m in ev if m["message-type"] == "RACE_WINNER"), None)
                if r and win and r["timestamp"] >= win:
                    other.append((names[i], 0, "left after the winner finished, not counted", "-", "")); continue
                if r and "damage" in (r.get("reason") or "").lower():
                    hits = [x for x in rows if names[i] in x["lines"] and x["t"] <= r["timestamp"]]
                    if any(not x["lines"][names[i]][1][0].split(", ")[1].startswith("to blame") for x in hits):
                        other.append((names[i], 0, f"retired ({r['reason'].lower()}) after another driver's contact, excused", "-", path.split("/")[-1].rsplit("_2026", 1)[0])); continue
                other.append((names[i], 1, f"retired from the race ({(next((r for r in rets if i in r['involved-drivers']), {}) or {}).get('reason') or 'no reason given'})", "-", path.split("/")[-1].rsplit("_2026", 1)[0]))
    # positive points
    neg = collections.defaultdict(float)
    for r in rows:
        for n, (p_, _) in r["lines"].items(): neg[n] += p_
    for n, v, *_ in other: neg[n] += v
    fl = path.split("/")[-1].rsplit("_2026", 1)[0]; pos_pts = []
    would = {}  # the clean race / qualifying bonus each driver gets once nothing counts against them
    if quali:
        best = {i: (c.get("final-classification") or {}).get("best-lap-time-ms") or 0 for i, c in cls.items()}
        ok = {i: b for i, b in best.items() if b > 0 and (cls[i].get("final-classification") or {}).get("result-status") != "DISQUALIFIED"}
        pole = min(ok.values()) if ok else None
        for i in cls:
            n = names[i]
            if i in ok and ok[i] <= pole * 1.07:
                would[n] = (0.5, f"clean qualifying, lap {ok[i] / pole * 100:.1f}% of pole")
                if neg[n] == 0: pos_pts.append((n, *would[n]))
    else:
        # finishing: +0.5 (+1 when the stream had no qualifying for this race); clean laps:
        # +0.3 each (race total rounded to 0.5); a perfect race (every lap clean, no warnings): +1
        warned = {p["vehicle-index"] for p in pens}
        badlap = collections.defaultdict(set)
        for r in rows:
            for nn, (p_, _) in r["lines"].items():
                if p_ > 0: badlap[nn].add(r["lap"])
        for nn, v, w, lap, _ in other:
            if v and isinstance(lap, int): badlap[nn].add(lap)
        tot = (d.get("session-info") or {}).get("total-laps") or 5
        trk = os.path.basename(path)[5:].rsplit("_2026", 1)[0].replace("_Just_in_case", "").replace("_Manual", "")
        had_q = any(stamp(q) < stamp(path) and (when(path) - when(q)).total_seconds() < 3600
                    for q in glob.glob(os.path.join(SESSIONS, f"*Qualifying_{trk}_2026*")))
        for i in cls:
            n = names[i]
            if (cls[i].get("final-classification") or {}).get("result-status") != "FINISHED": continue
            if any(v for nn, v, w, lap, _ in other if nn == n and not isinstance(lap, int)): continue  # disqualified
            pos_pts.append((n, 0.5 if had_q else 1.0, "finished the race" + ("" if had_q else " (no qualifying this time)")))
            if joke[i]: pos_pts.append((n, 0, "ran wrong tyres for the weather, no clean-lap points")); continue
            clean = [L for L in range(1, tot + 1) if L not in badlap[n]]
            perfect = len(clean) == tot and i not in warned
            would[n] = (half(0.3 * tot) + (1 if i not in warned else 0), f"{tot} clean laps")
            v = half(0.3 * len(clean)) + (1 if perfect else 0)
            if v: pos_pts.append((n, v, f"{len(clean)} clean lap{'s' if len(clean) != 1 else ''} (+0.3 each)" + (", perfect race +1" if perfect else "")))
        # close racing: within 0.5 s of another car at both ends of a clean sector
        T = {}
        for j, c in cls.items():
            t = 0; m = {}
            for L, l in enumerate(laps_of(j), 1):
                s1, s2, lt = l.get("sector-1-time-in-ms"), l.get("sector-2-time-in-ms"), l.get("lap-time-in-ms")
                if not (s1 and s2 and lt): break
                m[(L, 0)] = t; m[(L, 1)] = t + s1; m[(L, 2)] = t + s1 + s2; t += lt; m[(L + 1, 0)] = t
            T[j] = m
        dirty = {(i_, m_["lap-number"], m_.get("sector")) for m_ in cols + pens for i_ in m_["involved-drivers"]}
        for i in cls:
            n_ok = 0; n_half = 0; with_ = collections.Counter()
            for (L, s), t0 in T[i].items():
                end = (L, s + 1) if s < 2 else (L + 1, 0)
                if end not in T[i] or (L, s) == (1, 0) or (i, L, f"S{s + 1}") in dirty or L in joke[i]: continue
                near = [o for o in T if o != i and (L, s) in T[o] and end in T[o] and abs(T[o][(L, s)] - t0) <= 500 and abs(T[o][end] - T[i][end]) <= 500]
                near1 = [o for o in T if o != i and (L, s) in T[o] and end in T[o] and abs(T[o][(L, s)] - t0) <= 1000 and abs(T[o][end] - T[i][end]) <= 1000]
                if not near and near1: n_ok += 0.5; n_half += 1; continue  # within 1 s: half
                if near:
                    n_ok += 1; with_[names[min(near, key=lambda o: abs(T[o][end] - T[i][end]))]] += 0.2
            cp = round(n_ok * 0.2 * 2) / 2
            if cp: pos_pts.append((names[i], cp, f"close racing: {n_ok - n_half / 2:g} clean sectors within 0.5 s and {n_half} within 1 s of another car ({n_ok * 0.2:.1f}, rounded)", dict(with_)))
        timeline = sorted([(c["timestamp"], "c", c["involved-drivers"]) for c in cols] +
                          [(o["timestamp"], "o", o) for o in over if not o.get("overtaker-pitting") and not o.get("overtaken-pitting")], key=lambda x: x[0])
        for i in cls:
            streak = set(); got = 0.0
            for t, k, x in timeline:
                if k == "c" and i in x: streak = set()
                elif k == "o" and x["overtaker-index"] == i:
                    if any(c["timestamp"] - 5 <= t <= c["timestamp"] + 5 and i in c["involved-drivers"] for c in cols): streak = set(); continue
                    streak.add(x["overtaken-index"])  # passing the same car again doesn't add to the streak
                    if len(streak) == 3: got += 0.5; streak = set()
            got = min(got, 1.5)
            if got: pos_pts.append((names[i], got, f"{int(got * 6)} clean overtakes in a row on different cars (+0.5 per 3)"))
    return rows, other, would, pos_pts


FIRST_DAY = "2026_10_07"  # older files have no blame data
STREAM_GAP_H = 3
half = lambda x: math.floor(x * 2 + 0.5) / 2
when = lambda f: __import__("datetime").datetime.strptime(stamp(f), "%Y_%m_%d_%H_%M_%S")
short = lambda f: os.path.basename(f).rsplit("_2026", 1)[0].replace("_Just_in_case", "")

files = sorted((f for f in glob.glob(os.path.join(SESSIONS, "*.json")) if stamp(f) >= FIRST_DAY
                and ("Race_" in os.path.basename(f) or "Qualifying" in os.path.basename(f))), key=stamp)
streams = []
for f in files:
    if not streams or (when(f) - when(streams[-1][-1])).total_seconds() > STREAM_GAP_H * 3600:
        streams.append([])
    streams[-1].append(f)

# Staff corrections (races/corrections.json, written by the staff page): change
# the points of one item, or add a penalty or bonus by hand. Items are matched
# by an id built from the file, the car index and the kind of item, so a later
# name change doesn't lose the correction.
try:
    CHANGES = json.load(open(os.path.join("races", "corrections.json"))).get("changes", [])
except FileNotFoundError:
    CHANGES = []
FIX = {c["id"]: c for c in CHANGES if c.get("type") == "incident"}
ADD = collections.defaultdict(list)
for c in CHANGES:
    if c.get("type") == "add": ADD[c["file"]].append(c)

def incref(r):
    """Where a contact happened, for scripts/telemetry/incident_replays.py (which swaps it for a replay id)."""
    return {"t": r["t"], "te": r["t_end"], "pair": list(r["pair"]), "names": r["pn"]}

def apply_staff(name, items, car, is_race, would):
    """Gives every item its id and applies the staff corrections for this file."""
    for n, its in items.items():
        k = collections.Counter()
        for it in its:
            key = f"{name}|{car.get(n, '?')}|{it['cat']}|{it['lap'] or 0}"
            it["id"] = f"{key}|{k[key]}"; k[key] += 1
            fx = FIX.get(it["id"])
            if fx:
                it["orig"] = it["pts"]; it["pts"] = half(float(fx["pts"])); it["staff"] = fx.get("reason") or "changed by staff"
    by_car = {v: n for n, v in car.items()}
    for c in ADD[name]:
        n = by_car.get(c.get("car"))
        if n is None or AI.search(n): continue
        items[n].append({"pts": half(float(c["pts"])), "text": c.get("text") or "Staff decision", "lap": c.get("lap"),
                         "cat": "staff", "id": c["id"], "staff": c.get("reason") or ""})
    # a driver cleared by staff still gets the clean race or qualifying bonus
    for n, its in items.items():
        if not any(i.get("staff") for i in its) or any(i["cat"] == "quali" for i in its): continue
        if any(i["pts"] < 0 for i in its) or n not in would: continue
        v, what = would[n]
        its[:] = [i for i in its if i["cat"] != "clean"]  # the full clean-lap points replace the partial ones
        its.append({"pts": v, "text": what[0].upper() + what[1:] + " (after a staff decision)", "lap": None,
                    "cat": "clean" if is_race else "quali", "id": f"{name}|{car.get(n, '?')}|bonus|0|0"})

entries = collections.defaultdict(list)   # driver -> [{file, race, items}]
close_hist = collections.defaultdict(list)
history = collections.defaultdict(list)    # driver -> [{stream, date, sr}]
flags = collections.defaultdict(list)

# ---- SR from the average points per race (rules agreed with GreMi on 19 Oct 2026)
AGE = 0.9          # every stream, older races count 10% less
EMPTY_UP = 5       # a positive average counts as if you had 5 extra empty races
EMPTY_DOWN = 3     # a negative one as if you had 3
RECENT = 10        # penalty points in your last 10 races count 1.5x
RACE_FLOOR = -6    # one race counts for at most -6
STING = 0.25       # a quarter of what you lose also comes straight off, gone after 4 races
FORM_ABOVE, FORM_MARGIN = 70, 15
SCALE = [(0, 50), (1, 60), (2.3, 76), (3.0, 90), (3.8, 100)]  # average per race -> SR; below 0: 10 per point

def scale(a):
    if a <= 0: return 50 + 10 * a
    for (x0, y0), (x1, y1) in zip(SCALE, SCALE[1:]):
        if a <= x1: return y0 + (y1 - y0) * (a - x0) / (x1 - x0)
    return 100.0

def session_net(e, recent):
    pos = sum(i["pts"] for i in e["items"] if i["pts"] > 0); neg = sum(i["pts"] for i in e["items"] if i["pts"] < 0)
    return max(pos + neg * (1.5 if recent else 1), RACE_FLOOR), -neg

def weights(n, now):
    return [AGE ** (now - e["stream"]) for e in entries[n]]

def current(n, now, detail=False):
    """SR of driver n at the end of stream `now` (with detail: also the average per race it came from)."""
    es = entries[n]; total = races_w = sting = 0.0; races_after = 0
    for e, w in zip(reversed(es), reversed(weights(n, now))):
        net, loss = session_net(e, races_after < RECENT)
        sting += STING * min(loss, -RACE_FLOOR) * max(0.0, 1 - races_after / 4)
        total += w * net
        if e["race"]: races_w += w; races_after += 1
    if not races_w: return (50.0, 0.0) if detail else 50.0
    avg = total / (races_w + (EMPTY_UP if total > 0 else EMPTY_DOWN))
    sr = scale(avg) - sting
    if sr > FORM_ABOVE:  # you can be at most 15 above what your latest stream alone gives
        last = max(e["stream"] for e in es)
        ls = [e for e in es if e["stream"] == last]; nr = sum(e["race"] for e in ls)
        if nr >= 2:
            form = scale(sum(session_net(e, True)[0] for e in ls) / nr)
            sr = min(sr, max(float(FORM_ABOVE), half(form + FORM_MARGIN)))
    return (min(100.0, half(sr)), avg) if detail else min(100.0, half(sr))

def stream_avg(n, si):
    """Points per race in stream si, counted the way the SR counts them (recent penalties 1.5x, -6 floor)."""
    es = entries[n]; recent = set(); races_after = 0
    for k in range(len(es) - 1, -1, -1):
        if races_after < RECENT: recent.add(k)
        if es[k]["race"]: races_after += 1
    ks = [k for k, e in enumerate(es) if e["stream"] == si]; nr = sum(es[k]["race"] for k in ks)
    return round(sum(session_net(es[k], k in recent)[0] for k in ks) / nr, 2) if nr else None

all_incs = []
for si, stream in enumerate(streams):
    seen_stream = set(); stream_loss = collections.defaultdict(float)
    for f in stream:
        name = os.path.basename(f); is_race = name.startswith("Race_")
        rows, other, would, pp = analyse(f)
        items = collections.defaultdict(list)
        d = json.load(open(f))
        present = [nm_(c["driver-name"]) for c in d["classification-data"] if not AI.search(nm_(c["driver-name"]))]
        if is_race:
            for c in d["classification-data"]:
                n = nm_(c["driver-name"])
                if AI.search(n) or n in seen_stream: continue
                seen_stream.add(n); pub = c.get("telemetry-settings") == "Public"
                items[n].append({"pts": 1, "text": "First race of the stream", "lap": None, "cat": "stream"})
                if pub: items[n].append({"pts": 1, "text": "Shares full telemetry", "lap": None, "cat": "stream"})
        for item in pp:
            n, v, what = item[:3]
            if AI.search(n) or not v: continue
            if len(item) > 3:
                big = {p for p, x in item[3].items() if x > 1.5}
                close_hist[n].append(big)
                rep = [p for p in big if sum(p in h for h in close_hist[n][-5:]) >= 3]
                if rep and v > 1.5:
                    v = 1.5; what += f"; capped at 1.5 (close with {', '.join(rep)} in 3 of the last 5 races)"
                    flags[n].append(f"{short(f)}: close racing capped, often close with {', '.join(rep)}")
            cat = ("finish" if what.startswith("finished") else "close" if "close racing" in what else "overtakes" if "overtakes" in what
                   else "quali" if "qualifying" in what else "clean")
            items[n].append({"pts": v, "text": what[0].upper() + what[1:], "lap": None, "cat": cat})
        for r in rows:
            # every collision, also the ones that cost nobody points, for the Incidents tab
            all_incs.append({"file": name, "lap": r["lap"], "where": r["where"], "sev": r["sev"], "names": r["pn"],
                             "lines": {n: [-half(pts) or 0, "; ".join(parts)] for n, (pts, parts) in r["lines"].items()},
                             "inc": incref(r)})
            for n, (pts, parts) in r["lines"].items():
                if AI.search(n): continue
                pts = half(pts)
                if not pts: continue
                items[n].append({"pts": -pts, "text": f"{r['where']}, with {r['vs'][n]}: " + "; ".join(parts), "lap": r["lap"], "cat": "contact",
                                 "inc": incref(r)})
        for n, v, what, lap, _fl in other:
            if not n or AI.search(n) or not v: continue
            cat = "retirement" if "retired" in what else "penalty"
            items[n].append({"pts": -v, "text": what[0].upper() + what[1:], "lap": lap if isinstance(lap, int) else None, "cat": cat})
        car = {nm_(c["driver-name"]): c["index"] for c in d["classification-data"]}
        # a driver kicked by staff is gone from this session for everyone else,
        # but still answers for their own incidents (from the untouched copy)
        full = os.path.join(".cache", "kicked", name)
        if os.path.exists(full):
            fd = json.load(open(full))
            kicked = {nm_(c["driver-name"]): c["index"] for c in fd["classification-data"]
                      if c["index"] not in car.values() and not AI.search(nm_(c["driver-name"]))
                      and (c.get("participant-data") or {}).get("show-online-names") is not False}
            if kicked:
                rows2, other2, _, _ = analyse(full)
                for r in rows2:
                    for n, (pts, parts) in r["lines"].items():
                        if n in kicked and half(pts):
                            items[n].append({"pts": -half(pts), "text": f"{r['where']}, with {r['vs'][n]}: " + "; ".join(parts), "lap": r["lap"], "cat": "contact",
                                                     "inc": incref(r)})
                for n, v, what, lap, _fl in other2:
                    if n in kicked and v:
                        items[n].append({"pts": -v, "text": what[0].upper() + what[1:], "lap": lap if isinstance(lap, int) else None,
                                         "cat": "retirement" if "retired" in what else "penalty"})
                for n in kicked:
                    items[n].append({"pts": 0, "text": "Kicked from the lobby by staff: removed from this session's results", "lap": None, "cat": "staff"})
                car.update(kicked); present += list(kicked)
        apply_staff(name, items, car, is_race, would)
        for n in set(present) | set(items):
            loss = -sum(i["pts"] for i in items[n] if i["pts"] < 0)
            stream_loss[n] += loss
            if is_race and loss >= 20: flags[n].append(f"{short(f)}: lost {loss:g} in one race (kick line 20)")
            entries[n].append({"file": name, "race": is_race, "items": items[n], "stream": si})
    for n, loss in stream_loss.items():
        if loss >= 40: flags[n].append(f"Stream of {when(stream[0]):%d %b %Y}: lost {loss:g} (kick line 40)")
    for n in entries:
        sr, avg = current(n, si, True)
        history[n].append({"stream": si, "date": when(stream[0]).strftime("%Y-%m-%d"), "sr": sr, "raced": n in stream_loss,
                           "avg": round(avg, 2), "streamAvg": stream_avg(n, si)})

drivers = []
for n, es in entries.items():
    now = len(streams) - 1; sr = current(n, now); h = history[n]
    races = sum(e["race"] for e in es)
    prev = h[-2]["sr"] if len(h) > 1 else 50.0
    drivers.append({
        "name": n, "sr": sr, "change": half(sr - prev), "races": races,
        "provisional": races < 3, "banned": sr < 0,
        "history": [x for x in h],
        "sessions": [{"file": e["file"], "race": e["race"], "stream": e["stream"], "weight": w,
                      "total": half(sum(i["pts"] for i in e["items"])), "items": e["items"]}
                     for e, w in zip(es, weights(n, now))],
        "flags": flags[n],
    })
drivers.sort(key=lambda x: (-x["sr"], x["name"].lower()))
out = {"generated": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
       "streams": [{"date": when(s[0]).strftime("%Y-%m-%d"), "files": [os.path.basename(f) for f in s]} for s in streams],
       "drivers": drivers}
with open(os.path.join("public", "league", "safety.json"), "w") as fh:
    json.dump(out, fh, separators=(",", ":"))
with open(os.path.join("public", "league", "incidents.json"), "w") as fh:
    json.dump({"incidents": all_incs}, fh, separators=(",", ":"))
print(f"safety rating: {len(drivers)} drivers over {len(streams)} streams, {len(all_incs)} collisions")
