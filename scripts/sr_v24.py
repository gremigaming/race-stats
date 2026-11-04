"""SR v2.4 simulation (GreMi, 4 Nov 2026; NOT live, the site stays on v2.2).

"Dynamic gravity, clustering and dirty race momentum". Runs on the v2.2 safety.json
(same races, same fault-engine calls, same staff changes) and scores it again:

  Points   contact sev 1-3 0.5, 4-5 1.5, 6-7 3, 8-10 5 (huge crash), R9 (deliberate) 10,
           shared blame half; track limits / pit exit / DNF 1. (= v2.1 table, half of v2.2)
  Ledger   as v2.2: net = min(bonus, 4) - 0.5 x incident pts - other pts, 3 neutral buffer races,
           last 50 races, 0.8 per 10 races back; base = min(100, 50 + K x average).
  Sting    0.5 x incident pts, fading like v2.2.     SR = max(0, base - sting) - gravity.
  Rule 1   penalty x tier of your SR before the race: <60 1.0, 60s 1.2, 70s 1.4, 80s 1.6, 90s 1.8, 100 2.0.
  Rule 2   dirty race = 1 big (sev 6+ / R9) or 2 medium or 3 small incidents. Penalties after the
           trigger use the next streak step (1.5, 2.0, 2.5 ...); the step carries into your next
           races and only resets after a clean race. Applies to every penalty (also track limits).
  Rule 3   gravity after every league race (raced or skipped, from your first race on):
           SR 50-60 -0.25, 60-90 -0.5, 90+ -1, never below 50. Gravity replaces the v2.2 drift.
           Gravity that is no longer above 50 (your base fell) is dropped, so it never builds debt.

simulate(data, **params) -> {name: result}; params override DEFAULT (used for the tuned variants).
"""
import math
import re

DEFAULT = dict(
    K=25.0, CAP=4.0, DILUTE=0.5, STING=0.5, BUFFER=3, WINDOW=50, DECAY=0.8,
    POS=[(100, 2.0), (90, 1.8), (80, 1.6), (70, 1.4), (60, 1.2)],      # SR >= x -> multiplier
    STREAK_FIRST=1.5, STREAK_STEP=0.5, STREAK_MAX=None,
    DIRTY=dict(big=1, medium=2, small=3),
    GRAV=[(90, 1.0), (60, 0.5), (50, 0.25)],                           # SR >= x -> per race
    GRAV_SKIPPED_ONLY=False,     # True: only league races you skip pull you down
    GRAV_MAX_SKIPS=None,         # stop pulling after this many skipped races in a row
    STREAK_RESET_SKIPS=None,     # a streak ends after this many skipped league races
    STREAK_SCALES_OTHER=True,    # rule 2 also scales track limits / DNF
    POS_SCALES_OTHER=True,
    INC_SCALE=1.0,
    TABLE=None,                  # {v2.4 points: new points} for contact calls, e.g. {0.5: 0.75, 1.5: 2, 3: 4, 5: 6, 10: 12}               # x the incident points (2.0 = the v2.2 table)
)

half = lambda x: math.floor(x * 2 + 0.5) / 2
SEV_RE = re.compile(r"severity (\d+)/10")


def cls_of(item, p):
    """small / medium / big for a v2.4 incident of p points."""
    m = SEV_RE.search(item.get("text", ""))
    if m and not item.get("staff") and p < 5:
        s = int(m.group(1))
        return "small" if s <= 3 else "medium" if s <= 5 else "big"
    return "small" if p <= 0.5 else "medium" if p <= 1.5 else "big"


def race_rows(driver, skip_bonus=()):
    """Per race of a driver: (file, bonus, [(order, kind, cls, pts)]) with qualifying joined to the next race."""
    out = []; pend_b = 0.0; pend = []
    for s in driver["sessions"]:
        b = 0.0; its = []
        for it in s["items"]:
            v = it["pts"]
            if v > 0:
                if it["cat"] not in skip_bonus: b += v
                continue
            if v == 0: continue
            q = 0 if not s["race"] else 1
            lap = it.get("lap"); t = (it.get("inc") or {}).get("t") or 0
            order = (q, lap if isinstance(lap, int) else 999, t)
            if it["cat"] in ("contact", "staff"):
                p = -v / 2                      # v2.2 table is double v2.4's
                its.append((order, "inc", cls_of(it, p), p))
            else:
                its.append((order, "other", None, -v))   # track limits, pit exit, DNF: 1 in both
        if not s["race"]:
            pend_b += b; pend += its; continue
        out.append((s["file"], b + pend_b, sorted(pend + its)))
        pend_b = 0.0; pend = []
    return out


def tier(table, sr, default):
    for x, v in table:
        if sr >= x: return v
    return default


def simulate(data, **kw):
    P = dict(DEFAULT, **kw)
    league = [f for st in data["streams"] for f in st["files"] if f.startswith("Race_")]
    pos_of = {f: k for k, f in enumerate(league)}
    rows = {d["name"]: {pos_of[f]: (b, its) for f, b, its in race_rows(d) if f in pos_of} for d in data["drivers"]}
    st = {n: dict(ledger=[], level=0, G=0.0, sr=50.0, started=False, skips=0, dirty=0, best=0, grav=0.0, adj=0.0, raw=0.0,
                  stung=0.0) for n in rows}

    def score(s):
        win = ([(0.0, 0.0, 0.0)] * P["BUFFER"] + s["ledger"])[-P["WINDOW"]:]
        ws = [P["DECAY"] ** (k / 10) for k in range(len(win) - 1, -1, -1)]
        avg = sum(w * (min(b, P["CAP"]) - P["DILUTE"] * i_ - o) for w, (b, o, i_) in zip(ws, win)) / sum(ws)
        sting = P["STING"] * sum(w * i_ for w, (_, _, i_) in zip(ws, win))
        comp = max(0.0, min(100.0, 50 + P["K"] * avg) - sting)
        s["G"] = min(s["G"], max(0.0, comp - 50))
        s["sr"] = comp - s["G"]; s["base"] = min(100.0, 50 + P["K"] * avg); s["sting"] = sting

    for k in range(len(league)):
        for n, r in rows.items():
            s = st[n]
            if k not in r:
                if s["started"]: s["skips"] += 1
                if P["STREAK_RESET_SKIPS"] is not None and s["skips"] >= P["STREAK_RESET_SKIPS"]: s["level"] = 0
                continue
            b, its = r[k]; s["started"] = True; s["skips"] = 0
            pos = tier(P["POS"], s["sr"], 1.0)
            cnt = dict(big=0, medium=0, small=0); dirty = False; I = O = 0.0
            lvl = s["level"]
            for _, kind, c, p in its:
                sm = 1.0 if lvl == 0 else P["STREAK_FIRST"] + P["STREAK_STEP"] * (lvl - 1)
                if P["STREAK_MAX"]: sm = min(sm, P["STREAK_MAX"])
                if kind == "other":
                    m = (pos if P["POS_SCALES_OTHER"] else 1.0) * (sm if P["STREAK_SCALES_OTHER"] else 1.0)
                    O += p * m
                else:
                    t_ = P["TABLE"] or {}
                    q = t_[p] if p in t_ else t_[p * 2] / 2 if p * 2 in t_ else p * P["INC_SCALE"]   # p*2: shared blame
                    I += q * pos * sm
                    cnt[c] += 1
                    if not dirty and any(cnt[x] >= P["DIRTY"][x] for x in cnt):
                        dirty = True; lvl = s["level"] + 1     # penalties after the trigger use the next step
                s["raw"] += p
            s["adj"] += I + O; s["stung"] += P["STING"] * I
            if dirty: s["level"] += 1; s["dirty"] += 1; s["best"] = max(s["best"], s["level"])
            else: s["level"] = 0
            s["ledger"].append((b, O, I))
            score(s)
        for n, s in st.items():   # gravity after every league race
            if not s["started"]: continue
            if P["GRAV_SKIPPED_ONLY"] and k in rows[n]: continue
            if P["GRAV_MAX_SKIPS"] is not None and s["skips"] > P["GRAV_MAX_SKIPS"]: continue
            if s["sr"] > 50:
                g = min(tier(P["GRAV"], s["sr"], 0.0), s["sr"] - 50)
                s["G"] += g; s["grav"] += g; s["sr"] -= g
    return {n: dict(sr=half(s["sr"]), races=len(rows[n]), dirty=s["dirty"], streak_now=s["level"], streak_max=s["best"],
                    gravity=round(s["G"], 1), base=round(s.get("base", 50.0), 1), sting=round(s.get("sting", 0.0), 1),
                    pts_raw=round(s["raw"], 1), pts_adj=round(s["adj"], 1))
            for n, s in st.items() if rows[n]}


def table(data, variants):
    """Markdown: driver, races, live v2.2, then one column per variant (name, params)."""
    live = {d["name"]: d["sr"] for d in data["drivers"]}
    res = [(lbl, simulate(data, **kw)) for lbl, kw in variants]
    names = sorted(res[0][1], key=lambda n: (-res[0][1][n]["sr"], n.lower()))
    head = "| # | Driver | Races | Dirty races | Max streak | Gravity lost | v2.2 live | " + " | ".join(l for l, _ in res) + " |"
    lines = [head, "|" + "---|" * (7 + len(res))]
    for k, n in enumerate(names, 1):
        r0 = res[0][1][n]
        lines.append(f"| {k} | {n} | {r0['races']} | {r0['dirty']} | {r0['streak_max']} | {r0['gravity']:.1f} | {live.get(n, 50.0):.1f} | "
                     + " | ".join(f"{r[n]['sr']:.1f}" for _, r in res) + " |")
    return "\n".join(lines)


# columns in the build log: v2.4 as GreMi wrote it, then tuned variants
TUNED = dict(TABLE={0.5: 0.75, 1.5: 2.0, 3.0: 4.0, 5.0: 6.0, 10.0: 12.0}, INC_SCALE=1.25, STREAK_MAX=2.0,
             GRAV=[(90, 0.5), (60, 0.25), (50, 0.1)], GRAV_SKIPPED_ONLY=True)
VARIANTS = [
    ("v2.4", {}),
    ("v2.4, gravity only when skipped", dict(GRAV_SKIPPED_ONLY=True)),
    ("v2.4 tuned", TUNED),
]


# ---- SR v2.4 linear (GreMi, 4 Nov 2026, second draft): no averages, no stings.
#   Every race: SR += min(bonus, BONUS_CAP) - penalties x Rule 1 x Rule 2, within 0..100,
#   then gravity after every league race (raced or skipped). Qualifying joins the next race.
LINEAR = dict(DEFAULT, BONUS_CAP=4.0, START=50.0, STREAK_MAX=None,
              GAIN=1.0,       # x bonus and penalties
              GRAV_PCT=None,  # proportional gravity: -pct x (SR - 50) per league race instead of the flat tiers
              GRAV_PCT_SKIP=None,  # proportional gravity on races you skip (None: same as GRAV_PCT)
              BONUS_DIM=0.0)  # bonus x (1 - BONUS_DIM x (SR - 50) / 10) above 50 (third draft: 0.10)


def simulate_linear(data, **kw):
    P = dict(LINEAR, **kw)
    league = [f for st in data["streams"] for f in st["files"] if f.startswith("Race_")]
    pos_of = {f: k for k, f in enumerate(league)}
    rows = {d["name"]: {pos_of[f]: (b, its) for f, b, its in race_rows(d) if f in pos_of} for d in data["drivers"]}
    st = {n: dict(sr=P["START"], level=0, started=False, skips=0, dirty=0, best=0, grav=0.0, bonus=0.0, raw=0.0, adj=0.0,
                  hit100=0, hit0=0, worst=0.0) for n in rows}
    for k in range(len(league)):
        for n, r in rows.items():
            s = st[n]
            if k not in r:
                if s["started"]: s["skips"] += 1
                if P["STREAK_RESET_SKIPS"] is not None and s["skips"] >= P["STREAK_RESET_SKIPS"]: s["level"] = 0
                continue
            b, its = r[k]; s["started"] = True; s["skips"] = 0
            pos = tier(P["POS"], s["sr"], 1.0)
            cnt = dict(big=0, medium=0, small=0); dirty = False; pen = 0.0; lvl = s["level"]
            for _, kind, c, p in its:
                sm = 1.0 if lvl == 0 else P["STREAK_FIRST"] + P["STREAK_STEP"] * (lvl - 1)
                if P["STREAK_MAX"]: sm = min(sm, P["STREAK_MAX"])
                if kind == "inc":
                    t_ = P["TABLE"] or {}
                    p = t_[p] if p in t_ else t_[p * 2] / 2 if p * 2 in t_ else p * P["INC_SCALE"]
                pen += p * pos * sm; s["raw"] += p
                if kind == "inc":
                    cnt[c] += 1
                    if not dirty and any(cnt[x] >= P["DIRTY"][x] for x in cnt):
                        dirty = True; lvl = s["level"] + 1
            if dirty: s["level"] += 1; s["dirty"] += 1; s["best"] = max(s["best"], s["level"])
            else: s["level"] = 0
            bm = 1.0 - max(0.0, (s["sr"] - 50.0) / 10.0) * P["BONUS_DIM"]   # SR before this race
            bb = (min(b, P["BONUS_CAP"]) if P["BONUS_CAP"] else b) * bm * P["GAIN"]; pen *= P["GAIN"]; s["bonus"] += bb; s["adj"] += pen
            s["worst"] = max(s["worst"], pen - bb)
            s["sr"] = max(0.0, min(100.0, s["sr"] + bb - pen))
            s["hit100"] += s["sr"] >= 100; s["hit0"] += s["sr"] <= 0
        for n, s in st.items():
            if not s["started"]: continue
            if P["GRAV_SKIPPED_ONLY"] and k in rows[n]: continue
            if s["sr"] > 50:
                pct = P["GRAV_PCT_SKIP"] if P["GRAV_PCT_SKIP"] is not None and k not in rows[n] else P["GRAV_PCT"]
                g = pct * (s["sr"] - 50) if pct else min(tier(P["GRAV"], s["sr"], 0.0), s["sr"] - 50)
                s["sr"] -= g; s["grav"] += g
    return {n: dict(sr=half(s["sr"]), races=len(rows[n]), dirty=s["dirty"], streak_now=s["level"], streak_max=s["best"],
                    gravity=round(s["grav"], 1), bonus=round(s["bonus"], 1), pts_raw=round(s["raw"], 1), pts_adj=round(s["adj"], 1),
                    hit100=s["hit100"], hit0=s["hit0"], worst=round(s["worst"], 1))
            for n, s in st.items() if rows[n]}

LINEAR_TUNED = dict(GAIN=3.0, GRAV_PCT=0.04)
# third draft (GreMi, 4 Nov 2026): no bonus cap, bonus -10% per 10 SR above 50, gravity 4% raced / 2% skipped
LINEAR_V3 = dict(BONUS_CAP=None, BONUS_DIM=0.10, GRAV_PCT=0.04, GRAV_PCT_SKIP=0.02)
LINEAR_V3_TUNED = dict(LINEAR_V3, GAIN=2.0)   # same rules, every point x2


def table_linear(data, variants, sim=None):
    live = {d["name"]: d["sr"] for d in data["drivers"]}
    res = [(lbl, (sim or simulate_linear)(data, **kw)) for lbl, kw in variants]
    r0 = res[0][1]; names = sorted(r0, key=lambda n: (-r0[n]["sr"], n.lower()))
    lines = ["| # | Driver | Races | Bonus | Penalty (raw -> scaled) | Dirty | Max streak | Gravity | Worst race | v2.2 live | " + " | ".join(l for l, _ in res) + " |",
             "|" + "---|" * (10 + len(res))]
    for k, n in enumerate(names, 1):
        x = r0[n]
        lines.append(f"| {k} | {n} | {x['races']} | +{x['bonus']:g} | {x['pts_raw']:g} -> {x['pts_adj']:g} | {x['dirty']} | {x['streak_max']} | "
                     f"-{x['gravity']:g} | -{x['worst']:g} | {live.get(n, 50.0):.1f} | " + " | ".join(f"{r[n]['sr']:.1f}" for _, r in res) + " |")
    return "\n".join(lines)


# ---- SR v2.4 draft 4 (GreMi, 4 Nov 2026): linear points in a 50-race recency window.
#   SR = 50 + sum over your last 50 races of weight x race net, within 0..100.
#   weight: races 1-10 back 1.0, 11-20 0.8, 21-30 0.6, 31-40 0.4, 41-50 0.2, older 0.
#   race net = bonus x (1 - 0.01 x (SR - 50)) - penalties x position x streak (SR before the race).
#   Gravity after every league race (-4% of SR - 50 raced, -2% skipped, never below 50) is booked
#   on your latest race, so it ages out of the window with it.
WINDOW4 = dict(DEFAULT, BONUS_DIM=0.10, GRAV_PCT=0.04, GRAV_PCT_SKIP=0.02, STEPS=[1.0, 0.8, 0.6, 0.4, 0.2],
               BONUS_SCALE=1.0, OTHER_SCALE=1.0, CLEAN_ONLY_BONUS=False, STREAK_RESET_SKIPS=None,
               GRAV_ON_SKIP_ONLY=False, BONUS_SKIP_CATS=(), NO_BONUS_DIRTY=False)


def simulate_window(data, **kw):
    P = dict(WINDOW4, **kw)
    league = [f for st in data["streams"] for f in st["files"] if f.startswith("Race_")]
    pos_of = {f: k for k, f in enumerate(league)}
    rows = {d["name"]: {pos_of[f]: (b, its) for f, b, its in race_rows(d, P["BONUS_SKIP_CATS"]) if f in pos_of} for d in data["drivers"]}
    st = {n: dict(nets=[], sr=50.0, level=0, skips=0, dirty=0, best=0, grav=0.0, bonus=0.0, raw=0.0, adj=0.0, worst=0.0,
                  hidden=0.0) for n in rows}
    W = P["STEPS"]

    def total(s):
        nets = s["nets"]; L = len(nets)
        return sum(W[(L - 1 - k) // 10] * v for k, v in enumerate(nets) if (L - 1 - k) // 10 < len(W))

    def rescore(s):
        raw = 50 + total(s); s["hidden"] = max(0.0, raw - 100)
        s["sr"] = max(0.0, min(100.0, raw))

    for k in range(len(league)):
        for n, r in rows.items():
            s = st[n]
            if k not in r:
                if s["nets"]: s["skips"] += 1
                if P["STREAK_RESET_SKIPS"] is not None and s["skips"] >= P["STREAK_RESET_SKIPS"]: s["level"] = 0
                continue
            b, its = r[k]; s["skips"] = 0
            pos = tier(P["POS"], s["sr"], 1.0)
            cnt = dict(big=0, medium=0, small=0); dirty = False; pen = 0.0; lvl = s["level"]; ninc = 0
            for _, kind, c, p in its:
                sm = 1.0 if lvl == 0 else P["STREAK_FIRST"] + P["STREAK_STEP"] * (lvl - 1)
                t_ = P["TABLE"] or {}
                if kind == "inc":
                    p = t_[p] if p in t_ else t_[p * 2] / 2 if p * 2 in t_ else p * P["INC_SCALE"]
                    ninc += 1
                else:
                    p *= P["OTHER_SCALE"]
                pen += p * pos * sm; s["raw"] += p
                if kind == "inc":
                    cnt[c] += 1
                    if not dirty and any(cnt[x] >= P["DIRTY"][x] for x in cnt):
                        dirty = True; lvl = s["level"] + 1
            if dirty: s["level"] += 1; s["dirty"] += 1; s["best"] = max(s["best"], s["level"])
            else: s["level"] = 0
            bm = 1.0 - max(0.0, (s["sr"] - 50.0) / 10.0) * P["BONUS_DIM"]
            bb = b * bm * P["BONUS_SCALE"]
            if P["CLEAN_ONLY_BONUS"] and ninc: bb = 0.0
            if P["NO_BONUS_DIRTY"] and dirty: bb = 0.0
            s["bonus"] += bb; s["adj"] += pen; s["worst"] = max(s["worst"], pen - bb); s["worst_pen"] = max(s.get("worst_pen", 0.0), pen)
            s["nets"].append(bb - pen); rescore(s)
        for n, s in st.items():
            if not s["nets"]: continue
            raced = k in rows[n]
            if P["GRAV_ON_SKIP_ONLY"] and raced: continue
            if s["sr"] > 50:
                g = min((P["GRAV_PCT"] if raced else P["GRAV_PCT_SKIP"]) * (s["sr"] - 50), s["sr"] - 50)
                s["nets"][-1] -= g; s["grav"] += g; rescore(s)
    return {n: dict(sr=half(s["sr"]), races=len(rows[n]), dirty=s["dirty"], streak_now=s["level"], streak_max=s["best"],
                    gravity=round(s["grav"], 1), bonus=round(s["bonus"], 1), pts_raw=round(s["raw"], 1), pts_adj=round(s["adj"], 1),
                    worst=round(s["worst"], 1), worst_pen=round(s.get("worst_pen", 0.0), 1), hidden=round(s["hidden"], 1))
            for n, s in st.items() if rows[n]}

# draft 4 fix (no multipliers or caps): gravity only on races you skip (the window already fades old
# races), contact points 1 / 2 / 4 / 6, R9 12 (track limits / pit exit / DNF stay 1)
WINDOW4_FIX = dict(GRAV_ON_SKIP_ONLY=True, GRAV_PCT_SKIP=0.02, TABLE={0.5: 1.0, 1.5: 2.0, 3.0: 4.0, 5.0: 6.0, 10.0: 12.0})

# draft 5 (GreMi, 4 Nov 2026): draft 4 with gravity -2% of (SR - 50) after every league race, raced or
# skipped; points unchanged. The window counts the races the driver joined (skipping never ages a penalty).
WINDOW5 = dict(GRAV_PCT=0.02, GRAV_PCT_SKIP=0.02)


def table_window(data, variants):
    live = {d["name"]: d["sr"] for d in data["drivers"]}
    res = [(lbl, simulate_window(data, **kw)) for lbl, kw in variants]
    r0 = res[0][1]; names = sorted(r0, key=lambda n: (-r0[n]["sr"], n.lower()))
    lines = ["| # | Driver | Races | Bonus | Penalty (raw -> scaled) | Dirty | Max streak | Gravity | Biggest race penalty | Worst race net | v2.2 live | "
             + " | ".join(l for l, _ in res) + " |", "|" + "---|" * (11 + len(res))]
    for k, n in enumerate(names, 1):
        x = r0[n]
        lines.append(f"| {k} | {n} | {x['races']} | +{x['bonus']:g} | {x['pts_raw']:g} -> {x['pts_adj']:g} | {x['dirty']} | {x['streak_max']} | "
                     f"-{x['gravity']:g} | -{x['worst_pen']:g} | {-x['worst']:+g} | {live.get(n, 50.0):.1f} | "
                     + " | ".join(f"{r[n]['sr']:.1f}" for _, r in res) + " |")
    return "\n".join(lines).replace("| -0 |", "| 0 |").replace("| +0 |", "| 0 |")
