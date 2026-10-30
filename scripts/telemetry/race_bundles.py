"""Full-race bundles for the Live Race Viewer (/:formulaKey/race/:id), made from the
recordings in the "telemetry" release until the live server (gremigaming/race-control-stats,
live/) publishes every race to https://replays.gremigaming.com itself.

Runs in site.yml. For every race recording with rows for every car it writes

    public/league/races/index.json            every bundle, newest first
    public/league/races/<id>/manifest.json    track, cars (shown names only), events, incidents, chunks
    public/league/races/<id>/chunks/00012.bin 10 s of every car, gzip'd

in the same chunk format as live/race.py (encode_chunk below is a copy: keep them equal),
so the viewer reads both the same way. Hidden-name players only get "Car #<number>".

Incidents: see incidents() for the grouping rules (calibrated with GreMi on 30 Oct 2026).
Ghosted cars: see ghosts(); the game sends no ghost flag, so it is read from the motion.

    python3 scripts/telemetry/race_bundles.py /tmp/telemetry-cache [--only NAME] [--out DIR]
"""

import argparse
import bisect
import collections
import gzip
import json
import math
import os
import shutil
import statistics
import struct
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gmtel  # noqa: E402

RELEASE = "https://api.github.com/repos/gremigaming/race-stats/releases/tags/telemetry"
DOWNLOAD = "https://github.com/gremigaming/race-stats/releases/download/telemetry/"

VERSION = 8          # bump to rebuild every bundle
KEEP = 40            # newest races published on the site (R2 keeps everything later)
CHUNK_SECONDS = 10
CHUNK_HEAD = struct.Struct("<4sBBHd")
ON_TRACK = (0, 1)    # surface: tarmac, rumble strip
CORNER_M = 150       # "same corner": contacts this close in lap distance
NORMAL = 0.9         # below 90% of a driver's own normal speed = not back to normal yet
CONTACT_M = 7.0      # centres further apart than this: not a real contact (a car is ~5.6 m long)
SLIP_DEG = 20        # heading this far off the direction of travel = sliding or spinning
AVOID_M = 60         # a non-contact car joins only from this close behind an upset car
GHOST_LON, GHOST_LAT = 3.5, 1.4  # two car centres this close (along, across): driving through each other

# Team ids in the participants packet; the 2026 season pack starts at 476, with Audi in
# Sauber's slot and Cadillac after it (checked against the race files, 25 Oct)
TEAMS = ["Mercedes", "Ferrari", "Red Bull Racing", "Williams", "Aston Martin", "Alpine",
         "Racing Bulls", "Haas", "McLaren", "Sauber"]
TEAMS_26 = TEAMS[:9] + ["Audi", "Cadillac"]


def http_json(url):
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "race-stats"}
    if os.environ.get("GITHUB_TOKEN"):   # unauthenticated calls share 60/hour per runner IP and run out
        headers["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def download(name, cache):
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        urllib.request.urlretrieve(DOWNLOAD + name, path + ".tmp")
        os.replace(path + ".tmp", path)
    return path


def test_windows():
    """Time windows from races/test-sessions.json (Amsterdam time, as in the recording
    names): test lobbies and personal races, kept in the release but off the viewer."""
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "races", "test-sessions.json")
    try:
        windows = json.load(open(path)).get("windows", [])
    except (OSError, ValueError):
        return []
    digits = lambda s: "".join(c for c in s if c.isdigit()).ljust(14, "0")
    return [(digits(w["from"]), digits(w["to"])) for w in windows]


def is_test(name, windows):
    key = "".join(c for c in os.path.basename(name)[:19] if c.isdigit())
    return len(key) == 14 and any(a <= key < b for a, b in windows)


def has_field(path):
    """True when the recording has rows for every car (recorded since 19 Oct 2026)."""
    return any(kind == 2 for _, _, kind in gmtel.records(path))


def team_name(tid):
    if tid is None:
        return None
    for base, teams, suffix in ((476, TEAMS_26, " '26"), (0, TEAMS, "")):
        if base <= tid < base + len(teams):
            return teams[tid - base] + suffix
    return None


def shown_name(p):
    """Same rule as live/race.py: hidden-name players (and the game's anonymous "Player") only by race number."""
    if (p.get("ai") or p.get("public")) and p.get("name") not in (None, "", "Player"):
        return p["name"]
    return f"Car #{p.get('race_number', 0)}"


def encode_chunk(t0, frames):
    """Copy of live/race.py encode_chunk. frames: [(t, {slot: (x, z, y, heading, speed, throttle,
    brake, steer, gear, offtrack, lap_distance, lap, position, gap_front_ms)})]."""
    cars = max((max(c) for _, c in frames if c), default=-1) + 1
    n = len(frames)
    blank = (0.0, 0.0, 0.0, 0.0, 0, 0.0, 0.0, 0.0, 0, 0, 0.0, 0, 0, 0)
    flat = [c.get(i, blank) for _, c in frames for i in range(cars)]
    clamp = lambda v, lo, hi: max(lo, min(hi, v))  # noqa: E731
    out = [CHUNK_HEAD.pack(b"GMLC", 2, cars, n, float(t0)), struct.pack(f"<{n}f", *(t for t, _ in frames))]
    for k in (0, 1, 2, 10):
        out.append(struct.pack(f"<{len(flat)}f", *(r[k] for r in flat)))
    out.append(struct.pack(f"<{len(flat)}h", *(clamp(round(r[3] * 10000), -32768, 32767) for r in flat)))
    out.append(struct.pack(f"<{len(flat)}H", *(clamp(round(r[4] * 10), 0, 65535) for r in flat)))
    out.append(bytes(clamp(round(r[5] * 255), 0, 255) for r in flat))
    out.append(bytes(clamp(round(r[6] * 255), 0, 255) for r in flat))
    out.append(struct.pack(f"<{len(flat)}b", *(clamp(round(r[7] * 127), -127, 127) for r in flat)))
    out.append(struct.pack(f"<{len(flat)}b", *(clamp(r[8], -1, 9) for r in flat)))
    out.append(bytes(r[9] & 15 for r in flat))
    out.append(bytes(clamp(r[11], 0, 255) for r in flat))
    out.append(bytes(clamp(r[12], 0, 255) for r in flat))
    out.append(struct.pack(f"<{len(flat)}H", *(clamp(round(r[13] / 10), 0, 65535) for r in flat)))
    return b"".join(out)


SURFACES = ["Tarmac", "Kerb", "Concrete", "Rock", "Gravel", "Mud", "Sand", "Grass", "Water",
            "Cobblestone", "Metal", "Ridged"]


def add_surfaces(sess, incs):
    """What every involved car's wheels touched around the incident (the chunks only say on/off)."""
    times = sorted(sess.field)
    for inc in incs:
        k0, k1 = bisect.bisect_left(times, inc["t0"] - 1), bisect.bisect_right(times, inc["t1"] + 2)
        for d in inc["drivers"]:
            seen = collections.defaultdict(collections.Counter)
            for t in times[k0:k1]:
                r = sess.field[t].get(d["car"])
                for w in ("rl", "rr", "fl", "fr"):
                    v = r.get("surface_" + w) if r else None
                    if v is not None and v not in ON_TRACK:
                        seen[w][v] += 1
            if seen:
                d["surfaces"] = {w: SURFACES[c.most_common(1)[0][0]] if c.most_common(1)[0][0] < len(SURFACES) else "Other"
                                 for w, c in seen.items()}


def frames_of(sess):
    """One frame per all-car motion row, each car's newest telemetry and lap data carried along,
    re-timed by the game's frame counter (see retime)."""
    tel, lap, frames = {}, {}, []
    for t in sorted(sess.field):
        rows = sess.field[t]
        for i, r in rows.items():
            if "throttle" in r:
                off = sum(1 << w for w, k in enumerate(("rl", "rr", "fl", "fr"))
                          if r.get("surface_" + k, 0) not in ON_TRACK)
                tel[i] = (r["speed"], r["throttle"], r["brake"], r["steer"], r["gear"], off)
            if "lap" in r:
                lap[i] = (r["lap_distance"], r["lap"], r["position"], r.get("gap_front_ms", 0))
        cars = {i: (r["x"], r["z"], r["y"], math.atan2(r["fz"], r["fx"]))
                + tel.get(i, (0, 0.0, 0.0, 0.0, 0, 0)) + lap.get(i, (0.0, 0, 0, 0))
                for i, r in rows.items() if "x" in r}
        if cars:
            frames.append((t, cars))
    return retime(frames, sess.field_frames)


def retime(frames, ids):
    """The session time on a motion row can be ~20 ms off from when its positions were taken,
    while the positions themselves move in whole game frames (1/60 s): in the viewer cars stop
    and lurch. Count the game frames between rows from how far the moving cars went at their
    speed (the frame id when nobody is moving fast), time each row by that count (pulled slowly
    towards the session time so it never drifts) and drop rows that repeat the previous one."""
    out = []
    prev = None  # (frame id, corrected time, cars)
    period = 1 / 60
    for t, cars in frames:
        f = ids.get(t)
        if prev is None:
            tc = t
        else:
            df = moved_frames(prev[2], cars)
            if df is None and f is not None and prev[0] is not None:
                df = f - prev[0]
            if df == 0 and t - out[-1][2] < 0.1:
                continue
            if df is not None and 0 < df <= 120 and 0 < t - out[-1][2] < 3:
                period += 0.002 * (min(max((t - out[-1][2]) / df, 0.008), 0.03) - period)
                tc = prev[1] + df * period
                tc += 0.05 * (t - tc)
                if abs(tc - t) > 0.1 or tc <= prev[1]:
                    tc = t
            else:
                tc = t  # flashback, pause or a gap in the recording
        prev = (f, tc, cars)
        out.append((round(tc, 4), cars, t))
    return [(tc, cars) for tc, cars, _ in out]


def moved_frames(a, b):
    """Game frames between two rows, from the distance the cars over 80 km/h covered at their speed."""
    est = []
    for i, v in b.items():
        p = a.get(i)
        if p and v[4] > 80 and p[4] > 80:
            est.append(math.hypot(v[0] - p[0], v[1] - p[1]) / ((v[4] + p[4]) / 7.2) * 60)
    if len(est) < 2:
        return None
    return round(statistics.median(est))


class Normal:
    """Each driver's normal speed by lap distance: the median over their laps 2+, 20 m bins.
    Lap 1 is the start, slower for everyone: there the reference is the field's median on lap 1."""

    def __init__(self, frames):
        bins, first = collections.defaultdict(list), collections.defaultdict(list)
        for _, cars in frames:
            for i, c in cars.items():
                if c[10] <= 0:
                    continue
                if c[11] >= 2:
                    bins[(i, int(c[10] // 20))].append(c[4])
                elif c[11] == 1:
                    first[int(c[10] // 20)].append(c[4])
        self.v = {k: statistics.median(v) for k, v in bins.items() if len(v) >= 2}
        self.lap1 = {k: statistics.median(v) for k, v in first.items() if len(v) >= 5}

    def ratio(self, i, c):
        b = int(c[10] // 20)
        ref = self.lap1.get(b) if c[11] <= 1 else self.v.get((i, b))
        return c[4] / ref if ref else 1.0


def timing_of(sess):
    """Per car: grid slot, completed laps [lap, session time, ms], result status changes
    [session time, status] (2 active, 3 finished, 4 DNF, 5 DSQ, 6 not classified, 7 retired)
    and pit stops (session time it entered the pit lane)."""
    out = {}
    for t in sorted(sess.field):
        for i, r in sess.field[t].items():
            if "result_status" not in r:
                continue
            d = out.setdefault(i, {"grid": 0, "laps": [], "status": [], "pits": [], "_last": None, "_pit": 0})
            if r.get("grid"):
                d["grid"] = r["grid"]
            ms = r.get("last_lap_ms", 0)
            if ms and d["_last"] is not None and ms != d["_last"]:
                d["laps"].append([len(d["laps"]) + 1, round(t, 2), ms])
            if d["_last"] is None or ms:
                d["_last"] = ms
            pit = r.get("pit_status", 0)
            if pit and not d["_pit"] and d["laps"]:  # lap 1 starts on the grid, never in the pits
                d["pits"].append(round(t, 2))
            d["_pit"] = pit
            if not d["status"] or d["status"][-1][1] != r["result_status"]:
                d["status"].append([round(t, 2), r["result_status"]])
    for d in out.values():
        del d["_last"], d["_pit"]
    return out


def lap_starts(frames):
    """Session time at which the leader started each lap (lap 1 = the first frame)."""
    out, lap = [], 0
    for t, cars in frames:
        lead = next((c for c in cars.values() if c[12] == 1), None)
        if lead and lead[11] > lap:
            out.extend([round(t, 2)] * (lead[11] - lap if lap else 1))
            lap = lead[11]
    return out


def overlaps(cars):
    """Pairs of cars (a, b) driving through each other in one frame: centres under GHOST_LON along
    and GHOST_LAT across, both over 30 km/h. Real cars can't get that close (~5.6 x 2 m).
    Copy of live/race.py overlaps: keep them equal."""
    out = []
    items = [(i, c) for i, c in cars.items() if c[4] > 30]
    for k, (i, a) in enumerate(items):
        fx, fz = math.cos(a[3]), math.sin(a[3])
        for j, b in items[k + 1:]:
            dx, dz = b[0] - a[0], b[1] - a[1]
            if dx * dx + dz * dz > 25 or abs(b[2] - a[2]) > 2:
                continue
            if abs(dx * fx + dz * fz) < GHOST_LON and abs(dz * fx - dx * fz) < GHOST_LAT:
                out.append((i, j))
    return out


def ghosts(hits, collisions):
    """When each car was ghosted, {car: [[t0, t1], ...]}. The game sends no ghost flag (GreMi's lobbies
    ghost griefing cars: slow, wrong way, rejoining), so: two cars driving through each other with no
    game contact means one of them was ghosted. It is the one that went through more different cars
    in the race (a tie marks both). hits: [(t, a, b)] from overlaps(). Copy of live/race.py ghosts."""
    contact = collections.defaultdict(list)
    for c in collisions:
        contact[frozenset((c["a"], c["b"]))].append(c["t"])
    episodes = collections.defaultdict(list)   # pair -> [[t0, t1, frames]]
    for t, a, b in sorted(hits):
        eps = episodes[frozenset((a, b))]
        if eps and t - eps[-1][1] <= 1:
            eps[-1][1] = t
            eps[-1][2] += 1
        else:
            eps.append([t, t, 1])
    kept, partners = [], collections.defaultdict(set)
    for pair, eps in episodes.items():
        for t0, t1, n in eps:
            if n >= 2 and not any(t0 - 1.5 <= ct <= t1 + 1.5 for ct in contact[pair]):
                kept.append((pair, t0, t1))
                a, b = sorted(pair)
                partners[a].add(b)
                partners[b].add(a)
    wins = collections.defaultdict(list)
    for pair, t0, t1 in kept:
        a, b = sorted(pair)
        na, nb = len(partners[a]), len(partners[b])
        for i in ([a] if na > nb else [b] if nb > na else [a, b]):
            wins[i].append([t0 - 1, t1 + 1])
    out = {}
    for i, ws in wins.items():
        merged = []
        for t0, t1 in sorted(ws):
            if merged and t0 - merged[-1][1] < 3:
                merged[-1][1] = max(merged[-1][1], t1)
            else:
                merged.append([t0, t1])
        out[str(i)] = [[round(max(t0, 0), 2), round(t1, 2)] for t0, t1 in merged]
    return out


def ghosted(windows, car, t):
    return any(t0 <= t <= t1 for t0, t1 in windows.get(str(car), ()))


def incidents(frames, collisions, track_len, ghost_windows=None):
    """Group the game's contacts into incidents (rules calibrated with GreMi, batch 1, 30 Oct 2026).

    - A contact counts only when the two cars really were together (centres under CONTACT_M
      apart): the game sometimes reports contacts between cars that are metres apart.
    - A car is "upset" while it is below 90% of its normal speed there, slides (heading 20+
      degrees off its direction of travel) or has 2+ wheels off the track.
    - A contact opens a new incident unless one of its cars is already in an open incident and
      still upset (or touched in it less than 1.5 s ago): then it joins that one. So a battle over
      several corners stays one incident, a chain (A hits B, B hits C) is one incident, and two
      separate contacts at the same corner stay apart.
    - A contact after which nobody gets upset is a tap: kind "tap", not an incident.
    - Cars that never touched anyone join as "avoided" only when they were close behind an upset
      car of the incident (same lap, under AVOID_M behind) and then braked hard, slid or went off.
      Cars ahead of it never join.
    - An incident ends when all its cars have been back to normal for 2 s (15 s at most).
    - Ghosted cars (ghosts()) never join: not by contact, not as avoiders.
    """
    gw = ghost_windows or {}
    times = [t for t, _ in frames]
    normal = Normal(frames)
    slip = slip_angles(frames)

    def at(t):
        k = min(max(bisect.bisect_left(times, t), 0), len(frames) - 1)
        return frames[k][1]

    def behind(a, b):
        """Metres car a is behind car b along the lap (negative: a is ahead)."""
        d = (b[11] - a[11]) * track_len + b[10] - a[10] if track_len else b[10] - a[10]
        return d

    def upset_within(i, t0, t1):
        k0, k1 = bisect.bisect_left(times, t0), bisect.bisect_right(times, t1)
        for t, cars in frames[k0:k1]:
            c = cars.get(i)
            if c and (normal.ratio(i, c) < NORMAL or slip.get((i, t), 0) > SLIP_DEG or bin(c[9]).count("1") >= 2):
                return True
        return False

    out, open_ = [], []
    for c in sorted(collisions, key=lambda c: c["t"]):
        cars = at(c["t"])
        A, B = cars.get(c["a"]), cars.get(c["b"])
        if not A or not B or math.hypot(A[0] - B[0], A[1] - B[1]) > CONTACT_M:
            continue
        if ghosted(gw, c["a"], c["t"]) or ghosted(gw, c["b"], c["t"]):
            continue
        open_ = [x for x in open_ if x["end"] is None or x["end"] > c["t"]]
        joined = None
        for inc in reversed(open_):
            for i in (c["a"], c["b"]):
                if i in inc["cars"] and (c["t"] - inc["last"].get(i, -99) < 1.5 or upset_within(i, c["t"] - 0.5, c["t"])):
                    joined = inc
                    break
            if joined:
                break
        if joined is None:
            joined = {"t0": c["t"], "t1": c["t"], "lap": max(A[11], B[11]), "dist": A[10], "cars": [], "last": {},
                      "contacts": [], "x": round((A[0] + B[0]) / 2, 1), "z": round((A[1] + B[1]) / 2, 1), "end": None}
            out.append(joined)
            open_.append(joined)
        joined["t1"] = c["t"]
        joined["contacts"].append({"t": round(c["t"], 2), "a": c["a"], "b": c["b"], "severity": c.get("severity", 0)})
        for i in (c["a"], c["b"]):
            joined["last"][i] = c["t"]
            if i not in joined["cars"]:
                joined["cars"].append(i)
        joined["end"] = ending(joined, frames, times, normal, slip, joined["t1"])
    res = []
    for inc in out:
        role = {i: "contact" for i in inc["cars"]}
        hurt = [i for i in inc["cars"] if upset_within(i, inc["t0"], inc["t1"] + 2)]
        # avoiders: close behind an upset car of the incident, then braked hard, slid or went off
        k0, k1 = bisect.bisect_left(times, inc["t0"] - 0.5), bisect.bisect_right(times, inc["end"])
        calm = {}
        for t, cars in frames[k0:k1]:
            for i, c in cars.items():
                if i in role or ghosted(gw, i, t):
                    continue
                if t < inc["t0"] + 0.3:   # already in trouble before the incident: not ours
                    calm[i] = calm.get(i, True) and not upset_within(i, t, t)
                    continue
                if not calm.get(i, True):
                    continue
                near = any(m in cars and 0 < behind(c, cars[m]) < AVOID_M and upset_within(m, t - 0.2, t) for m in hurt)
                if not near:
                    continue
                if bin(c[9]).count("1") >= 2:
                    role[i] = "off track"
                elif slip.get((i, t), 0) > SLIP_DEG:
                    role[i] = "spun"
                elif c[6] > 0.8 and normal.ratio(i, c) < 0.75:
                    role[i] = "hard braking"
        res.append({"t0": round(inc["t0"], 2), "t1": round(ending(inc, frames, times, normal, slip, inc["t1"], list(role)), 2),
                    "lap": inc["lap"], "dist": round(inc["dist"]), "x": inc["x"], "z": inc["z"],
                    "kind": "incident" if hurt else "tap", "contacts": inc["contacts"],
                    "drivers": [{"car": i, "role": r} for i, r in role.items()]})
    return res


def ending(inc, frames, times, normal, slip, t1, cars=None):
    """When every car of the incident has been back to normal for 2 s (15 s after the last contact at most)."""
    cars = cars or inc["cars"]
    calm_since = None
    for t, row in frames[bisect.bisect_left(times, t1):]:
        if t - t1 > 15:
            return t
        ok = all(i not in row or (normal.ratio(i, row[i]) >= NORMAL and slip.get((i, t), 0) <= SLIP_DEG
                                  and bin(row[i][9]).count("1") < 2) for i in cars)
        if not ok:
            calm_since = None
        elif calm_since is None:
            calm_since = t
        elif t - calm_since >= 2:
            return calm_since
    return frames[-1][0]


def slip_angles(frames):
    """Degrees between each car's heading and its direction of travel, {(car, time): deg}, for cars over 30 km/h."""
    out, prev = {}, {}
    for t, cars in frames:
        for i, c in cars.items():
            p = prev.get(i)
            if p and c[4] > 30:
                dx, dz = c[0] - p[0], c[1] - p[1]
                if math.hypot(dx, dz) > 0.5:
                    d = math.degrees(math.atan2(dz, dx) - c[3])
                    out[(i, t)] = abs((d + 180) % 360 - 180)
            prev[i] = c
    return out


def bundle(path, rid, outdir):
    sess = gmtel.Session(path)
    if sess.info.get("session_type") not in ("Race", "Race 2", "Race 3") or not sess.field:
        return None
    frames = frames_of(sess)
    if len(frames) < 100:
        return None
    rdir = os.path.join(outdir, rid)
    shutil.rmtree(rdir, ignore_errors=True)
    os.makedirs(os.path.join(rdir, "chunks"))
    chunks, by = [], collections.defaultdict(list)
    for t, cars in frames:
        by[int(t // CHUNK_SECONDS)].append((t, cars))
    for k in sorted(by):
        name = f"{k:05d}.bin"
        with open(os.path.join(rdir, "chunks", name), "wb") as f:
            f.write(gzip.compress(encode_chunk(k * CHUNK_SECONDS, by[k]), 9))
        chunks.append(name)
    seen = {i for _, c in frames for i in c}
    ghost_windows = ghosts([(t, a, b) for t, c in frames for a, b in overlaps(c)], sess.collisions)
    cars = {str(i): {"name": shown_name(p), "team": p.get("team"), "team_name": team_name(p.get("team")),
                     "number": p.get("race_number"), "ai": bool(p.get("ai"))}
            for i, p in sess.drivers.items() if i in seen}
    events = [{"t": round(c["t"], 3), "code": "COLL", "a": c["a"], "b": c["b"]} for c in sess.collisions]
    events += [{"t": t, "code": code} for t, code in sess.events if code not in ("COLL", "STLG", "RTMT")]
    events += sess.event_detail
    events.sort(key=lambda e: e["t"])
    base = os.path.basename(path).replace(".gmtel.gz", "")
    manifest = {"v": 1, "uid": rid, "started": base[:10] + "T" + base[11:19].replace("-", ":"),
                "track": sess.info.get("track") or "Unknown", "session": sess.info.get("session_type"),
                "laps": sess.info.get("total_laps", 0), "track_length": sess.info.get("track_length", 0),
                "chunk_seconds": CHUNK_SECONDS, "chunks": chunks, "duration": round(frames[-1][0], 2),
                "lap_starts": lap_starts(frames),
                "timing": {str(i): v for i, v in timing_of(sess).items() if str(i) in cars},
                "cars": cars, "events": events, "finished": True, "source": "recording", "bundle": VERSION,
                "ghosts": ghost_windows, "weather": sess.weather, "tod": sess.tod,
                "incidents": incidents(frames, sess.collisions, sess.info.get("track_length", 0), ghost_windows)}
    add_surfaces(sess, manifest["incidents"])
    with open(os.path.join(rdir, "manifest.json"), "w") as f:
        json.dump(manifest, f, separators=(",", ":"))
    return manifest


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cache", nargs="?", default="/tmp/telemetry-cache")
    ap.add_argument("--only", help="one recording file name (local test)")
    ap.add_argument("--out", default=os.path.join("public", "league", "races"))
    a = ap.parse_args()
    os.makedirs(a.cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    keep = os.path.join(a.cache, "race-bundles")   # bundles are kept between builds
    if a.only:
        names = [a.only]
    else:
        try:
            names = sorted((x["name"] for x in http_json(RELEASE)["assets"]
                            if x["name"].endswith("_Race.gmtel.gz")), reverse=True)
        except Exception as ex:
            # never publish an empty viewer: fall back to the bundles kept from earlier builds
            print("telemetry release not reachable, using the kept bundles:", ex)
            names = sorted((d + ".gmtel.gz" for d in os.listdir(keep)), reverse=True) if os.path.isdir(keep) else []
    windows = test_windows()
    index = []
    for n in names:
        if len(index) >= KEEP:
            break
        if is_test(n, windows):
            print("  skipped (test or personal session)", n)
            continue
        rid = os.path.basename(n).replace(".gmtel.gz", "")
        kept = os.path.join(keep, rid)
        try:
            m = json.load(open(os.path.join(kept, "manifest.json")))
            if m.get("bundle") != VERSION:
                raise ValueError
            shutil.copytree(kept, os.path.join(a.out, rid), dirs_exist_ok=True)
        except (OSError, ValueError):
            try:
                path = n if os.path.exists(n) else download(n, a.cache)
                if not has_field(path):
                    continue
                m = bundle(path, rid, a.out)
            except Exception as ex:
                print("  skipped", n, ex)
                continue
            if not m:
                continue
            if not a.only:
                shutil.rmtree(kept, ignore_errors=True)
                shutil.copytree(os.path.join(a.out, rid), kept)
            print(rid, f"{len(m['chunks'])} chunks, {len(m['incidents'])} incidents")
        index.append({"uid": rid, "started": m["started"], "track": m["track"], "session": m["session"],
                      "laps": m["laps"], "cars": len(m["cars"]), "incidents": len(m["incidents"])})
    with open(os.path.join(a.out, "index.json"), "w") as f:
        json.dump({"races": index}, f, separators=(",", ":"))
    print("race bundles:", len(index))


if __name__ == "__main__":
    main()
