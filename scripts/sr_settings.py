"""SR v2.5 settings: every number of the safety rating, editable on the staff page.

races/sr-settings.json holds {"values": {key: number}, "updated", "by", "reason"}; the staff page
(race-control-stats staff/app.py, SR settings tab) writes it to main, which rebuilds the site and,
within a few minutes, the live server's league data. A missing file, a missing key or a bad value
never stops a build: that one value falls back to its default below and the build log says so.

FIELDS is the single list of settings (key, default, min, max, kind); the staff page keeps the
same list (staff/app.py SR_FIELDS) so it can refuse bad values before saving.
"""
import json
import os

# (key, default, min, max, kind) - kind: num, int, bool, list (comma-separated numbers)
FIELDS = [
    # penalty points of a contact you are to blame for (shared blame: half), by severity
    ("contact_small", 0.75, 0, 100, "num"),     # severity 1-3
    ("contact_medium", 2.25, 0, 100, "num"),    # severity 4-5
    ("contact_big", 4.5, 0, 100, "num"),        # severity 6-7
    ("contact_huge", 7.5, 0, 100, "num"),       # severity 8-10
    ("contact_r9", 15.0, 0, 200, "num"),        # hitting the same car again on purpose
    ("contact_other", 0.5, 0, 20, "num"),       # staff contact penalties with another value: x their v2.2 points
    ("penalty_track", 1.5, 0, 20, "num"),       # track limits, pit exit, disqualified: x their v2.2 points (1, DSQ 10)
    ("penalty_dnf", 1.5, 0, 20, "num"),         # retiring from a race: x its v2.2 point (1)
    # bonuses: v2.2 bonus points x bonus_scale x the bonus type's own multiplier
    ("bonus_scale", 2.0, 0, 20, "num"),
    ("bonus_finish", 1.0, 0, 10, "num"),        # finishing (0.5, 1 without qualifying)
    ("bonus_clean", 1.0, 0, 10, "num"),         # clean laps (0.3 each) and a perfect race (+1)
    ("bonus_close", 1.0, 0, 10, "num"),         # close racing
    ("bonus_overtakes", 1.0, 0, 10, "num"),     # clean overtakes (0.5 per 3)
    ("bonus_quali", 1.0, 0, 10, "num"),         # clean qualifying (0.5)
    ("bonus_stream", 1.0, 0, 10, "num"),        # first race of the stream (1), full telemetry (1)
    ("bonus_cut", 0.10, 0, 1, "num"),           # bonus cut per 10 SR above 50 (0.10 = 10% less per 10 SR)
    ("no_bonus_dirty", True, None, None, "bool"),
    # dirty races and the dirty streak
    ("dirty_big", 1, 1, 20, "int"),             # a dirty race: this many big incidents (severity 6+ / R9) ...
    ("dirty_medium", 2, 1, 20, "int"),          # ... or medium (severity 4-5) ...
    ("dirty_small", 3, 1, 20, "int"),           # ... or small (severity 1-3)
    ("streak_first", 1.5, 1, 10, "num"),        # penalty multiplier from the first dirty race in a row
    ("streak_step", 0.5, 0, 10, "num"),         # added for every next dirty race in a row
    ("streak_max", 0.0, 0, 20, "num"),          # highest streak multiplier (0 = no limit)
    # penalty multiplier by your SR before the race
    ("tier_60", 1.2, 0, 10, "num"),
    ("tier_70", 1.4, 0, 10, "num"),
    ("tier_80", 1.6, 0, 10, "num"),
    ("tier_90", 1.8, 0, 10, "num"),
    ("tier_100", 2.0, 0, 10, "num"),
    # gravity: share of (SR - 50) taken after every league race, booked on your latest race
    ("gravity_joined", 0.04, 0, 0.5, "num"),
    ("gravity_skipped", 0.02, 0, 0.5, "num"),
    # the window: races per step and each step's weight (newest first; older races count 0)
    ("window_step", 6, 1, 50, "int"),
    ("window_weights", [1.0, 0.8, 0.6, 0.4, 0.2], 0, 1, "list"),
    # staff alerts
    ("kick_race", 30.0, 1, 1000, "num"),        # points lost in one race
    ("kick_stream", 60.0, 1, 1000, "num"),      # points lost in one stream
]
DEFAULTS = {k: d for k, d, *_ in FIELDS}
PATH = os.environ.get("SR_SETTINGS", os.path.join(os.environ.get("LEAGUE_RACES_DIR", "races"), "sr-settings.json"))


def check(key, value):
    """The value as stored, or ValueError with a short reason."""
    spec = next((f for f in FIELDS if f[0] == key), None)
    if spec is None:
        raise ValueError(f"unknown setting {key}")
    _, _, lo, hi, kind = spec
    if kind == "bool":
        if isinstance(value, bool): return value
        if isinstance(value, str) and value.lower() in ("true", "on", "1", "yes", "false", "off", "0", "no", ""):
            return value.lower() in ("true", "on", "1", "yes")
        raise ValueError(f"{key}: not yes/no")
    if kind == "list":
        parts = value if isinstance(value, list) else str(value).replace(";", ",").split(",")
        out = [check_num(key, p, lo, hi) for p in parts if str(p).strip() != ""]
        if not 1 <= len(out) <= 20: raise ValueError(f"{key}: give 1 to 20 numbers")
        return out
    v = check_num(key, value, lo, hi)
    if kind == "int":
        if v != int(v): raise ValueError(f"{key}: must be a whole number")
        return int(v)
    return v


def check_num(key, value, lo, hi):
    if isinstance(value, bool): raise ValueError(f"{key}: not a number")
    try: v = float(str(value).strip().replace(",", "."))
    except ValueError: raise ValueError(f"{key}: not a number") from None
    if v != v or v in (float("inf"), float("-inf")): raise ValueError(f"{key}: not a number")
    if not lo <= v <= hi: raise ValueError(f"{key}: must be between {lo:g} and {hi:g}")
    return v


def load(path=PATH):
    """(values, problems): every setting, with the default for anything missing or bad."""
    vals = dict(DEFAULTS); problems = []
    try:
        with open(path, encoding="utf-8") as fh: raw = json.load(fh)
        given = raw.get("values") if isinstance(raw, dict) else None
        if not isinstance(given, dict): raise ValueError("no 'values' object")
    except FileNotFoundError:
        return vals, []
    except Exception as ex:
        return vals, [f"{path} unreadable ({ex}), all defaults"]
    for k, v in given.items():
        try: vals[k] = check(k, v)
        except ValueError as ex: problems.append(f"{ex}; " + (f"default {DEFAULTS[k]!r} used" if k in DEFAULTS else "ignored"))
    return vals, problems


def params(vals):
    """sr_v24.simulate_window parameters for these settings."""
    return dict(
        TABLE={0.5: vals["contact_small"], 1.5: vals["contact_medium"], 3.0: vals["contact_big"],
               5.0: vals["contact_huge"], 10.0: vals["contact_r9"]},
        INC_SCALE=vals["contact_other"] * 2,   # sr_v24 works on half v2.2 points
        OTHER_SCALE=1.0, OTHER_CAT={"retirement": vals["penalty_dnf"], "*": vals["penalty_track"]},
        BONUS_SCALE=vals["bonus_scale"],
        BONUS_CAT={c: vals["bonus_" + c] for c in ("finish", "clean", "close", "overtakes", "quali", "stream")},
        BONUS_DIM=vals["bonus_cut"], NO_BONUS_DIRTY=vals["no_bonus_dirty"],
        DIRTY=dict(big=vals["dirty_big"], medium=vals["dirty_medium"], small=vals["dirty_small"]),
        STREAK_FIRST=vals["streak_first"], STREAK_STEP=vals["streak_step"], STREAK_MAX=vals["streak_max"] or None,
        POS=[(100, vals["tier_100"]), (90, vals["tier_90"]), (80, vals["tier_80"]), (70, vals["tier_70"]), (60, vals["tier_60"])],
        GRAV_PCT=vals["gravity_joined"], GRAV_PCT_SKIP=vals["gravity_skipped"],
        STEP_LEN=vals["window_step"], STEPS=list(vals["window_weights"]),
    )
