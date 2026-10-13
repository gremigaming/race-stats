"""The five award roles in GreMi's Discord, ranked over the last 5 streams.

Writes public/league/awards.json after build-league-data.mjs. Race Control (the
Discord bot) reads it, keeps only drivers linked to a Discord member (never
GreMi) and hands each role to the best of them, for at least a week at a time.

  wins       most race wins
  fastest    most fastest laps
  overtakes  most overtakes
  clean      fewest incident points per race (min. MIN_RACES races)
  dotd       best all-round driver: quick, clean and racing often (min. MIN_RACES races)

Incident points per race: corner cutting warning 0.5, other warning 1, time
penalty 2, drive through or stop go 3, each collision 1.
"""
import collections
import datetime
import glob
import json
import os
import re

SESSIONS = os.path.join("public", "league", "sessions")
OUT = os.path.join("public", "league", "awards.json")
STREAMS = 5
STREAM_GAP_H = 3
MIN_RACES = 3
FINISHED = {"FINISHED", "ACTIVE", ""}
HIDDEN = re.compile(r"^\d+ #\d+$")
WARN = {"Corner Cutting Warning": 0.5, "Other Warning": 1, "Time Penalty": 2,
        "Dt Penalty": 3, "Sg Penalty": 3}
DOTD_WEIGHTS = {"quick": 0.4, "clean": 0.3, "often": 0.3}


def stamp(path):
    m = re.search(r"(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)\.json$", path)
    return datetime.datetime(*map(int, m.groups())) if m else None


def display(name):
    return re.sub(r"[\s ]+", " ", name or "").strip()


def group_streams(files):
    streams = []
    for f in sorted(files, key=stamp):
        if not streams or (stamp(f) - stamp(streams[-1][-1])).total_seconds() > STREAM_GAP_H * 3600:
            streams.append([])
        streams[-1].append(f)
    return streams


def named(d):
    p = d.get("participant-data") or {}
    name = display(d.get("driver-name"))
    if not name or p.get("ai-controlled") or p.get("show-online-names") is False or HIDDEN.match(name):
        return None
    return name


def race_stats(data, stats):
    """Adds one race to stats {lower name: {...}}."""
    rows = []
    for d in data["classification-data"]:
        name = named(d)
        if not name:
            continue
        fc = d.get("final-classification") or {}
        ld = d.get("lap-data") or {}
        status = fc.get("result-status", ld.get("result-status", "")) or ""
        pos = fc.get("position") or (ld.get("car-position") or None)
        rows.append((name, status, pos, d))
    field = len(data["classification-data"])
    seen = set()
    for name, status, pos, d in rows:
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        s = stats.setdefault(key, {"name": name, "races": 0, "wins": 0, "fastest": 0, "overtakes": 0,
                                    "incidents": 0.0, "quick": 0.0})
        s["name"] = name
        s["races"] += 1
        done = status in FINISHED and pos
        if done and pos == 1:
            s["wins"] += 1
        s["quick"] += (1 - (pos - 1) / max(1, field - 1)) if done else 0
        s["incidents"] += sum(WARN.get(w.get("entry-type"), 0) for w in d.get("warning-penalty-history") or [])
    for pair in ((data.get("collisions") or {}).get("collision-pairs") or []):
        for k in ("driver-1-name", "driver-2-name"):
            key = display(pair.get(k)).lower()
            if key in seen:
                stats[key]["incidents"] += 1
    fl = (((data.get("records") or {}).get("fastest") or {}).get("lap") or {}).get("driver-name")
    if display(fl).lower() in seen:
        stats[display(fl).lower()]["fastest"] += 1
    for o in ((data.get("overtakes") or {}).get("records") or []):
        key = display(o.get("overtaking-driver-name")).lower()
        if key in seen:
            stats[key]["overtakes"] += 1


def rank(stats):
    """{award: [{"name", "value", "races", "text"}, best first]}."""
    rows = list(stats.values())
    for s in rows:
        s["per_race"] = s["incidents"] / s["races"]
        s["quick_avg"] = s["quick"] / s["races"]
    regular = [s for s in rows if s["races"] >= MIN_RACES]
    most = max((s["races"] for s in regular), default=1)
    worst = max((s["per_race"] for s in regular), default=0) or 1
    for s in regular:
        s["dotd"] = (DOTD_WEIGHTS["quick"] * s["quick_avg"]
                     + DOTD_WEIGHTS["clean"] * (1 - s["per_race"] / worst)
                     + DOTD_WEIGHTS["often"] * s["races"] / most)

    def plural(n, word):
        return f"{n:g} {word}{'' if n == 1 else 's'}"

    def table(pool, key, reverse, text):
        pool = [s for s in pool if not reverse or s[key] > 0]
        pool.sort(key=lambda s: ((-s[key] if reverse else s[key]), -s["races"], s["name"].lower()))
        return [{"name": s["name"], "value": round(s[key], 3), "races": s["races"], "text": text(s)} for s in pool]

    return {
        "wins": table(rows, "wins", True, lambda s: plural(s["wins"], "win")),
        "fastest": table(rows, "fastest", True, lambda s: plural(s["fastest"], "fastest lap")),
        "overtakes": table(rows, "overtakes", True, lambda s: plural(s["overtakes"], "overtake")),
        "clean": table(regular, "per_race", False,
                       lambda s: f"{s['per_race']:.1f} incident points per race over {plural(s['races'], 'race')}"),
        "dotd": table(regular, "dotd", True,
                      lambda s: (f"{plural(s['races'], 'race')}, {s['per_race']:.1f} incident points per race, "
                                 f"finishing ahead of {s['quick_avg']:.0%} of the field")),
    }


def main():
    files = [f for f in glob.glob(os.path.join(SESSIONS, "Race_*.json")) if stamp(f)]
    streams = group_streams(files)[-STREAMS:]
    stats = {}
    for stream in streams:
        for f in stream:
            with open(f, encoding="utf-8") as fh:
                race_stats(json.load(fh), stats)
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "streams": [stamp(s[0]).strftime("%Y-%m-%d") for s in streams],
           "awards": rank(stats)}
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print(f"awards: {len(stats)} drivers over {len(streams)} streams")


if __name__ == "__main__":
    main()
