"""Full-race bundles for the Live Race Viewer (/:formulaKey/race/:id), made from the
recordings in the "telemetry" release until the live server (gremigaming/race-control-stats,
live/) publishes every race to https://replays.gremigaming.com itself.

Runs in site.yml. For every race recording with rows for every car it writes

    public/league/races/index.json            every bundle, newest first
    public/league/races/<id>/manifest.json    track, cars (shown names only), events, incidents, chunks
    public/league/races/<id>/chunks/00012.bin 10 s of every car, gzip'd

in the same chunk format as live/race.py (encode_chunk below is a copy: keep them equal),
so the viewer reads both the same way. Hidden-name players only get "Car #<number>".

Incidents follow GreMi's rule from the spec: a contact joins an open incident when it is on
the same lap and near the same corner while a car of that incident is still below 90% of its
own normal speed there. Every driver near it who went off, spun or braked hard is involved too.

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

VERSION = 5          # bump to rebuild every bundle
KEEP = 40            # newest races published on the site (R2 keeps everything later)
CHUNK_SECONDS = 10
CHUNK_HEAD = struct.Struct("<4sBBHd")
ON_TRACK = (0, 1)    # surface: tarmac, rumble strip
CORNER_M = 150       # "same corner": contacts this close in lap distance
NORMAL = 0.9         # below 90% of a driver's own normal speed = not back to normal yet
NEAR_M, NEAR_S = 50, 3.0

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
    """Each driver's normal speed by lap distance: the median over their laps, 20 m bins."""

    def __init__(self, frames):
        bins = collections.defaultdict(list)
        for _, cars in frames:
            for i, c in cars.items():
                if c[11] >= 2 and c[10] > 0:  # lap 1 is the start: not normal
                    bins[(i, int(c[10] // 20))].append(c[4])
        self.v = {k: statistics.median(v) for k, v in bins.items() if len(v) >= 2}

    def ratio(self, i, c):
        ref = self.v.get((i, int(c[10] // 20)))
        return c[4] / ref if ref else 1.0


def timing_of(sess):
    """Per car: grid slot, completed laps [lap, session time, ms] and result status changes
    [session time, status] (2 active, 3 finished, 4 DNF, 5 DSQ, 6 not classified, 7 retired)."""
    out = {}
    for t in sorted(sess.field):
        for i, r in sess.field[t].items():
            if "result_status" not in r:
                continue
            d = out.setdefault(i, {"grid": 0, "laps": [], "status": [], "_last": None})
            if r.get("grid"):
                d["grid"] = r["grid"]
            ms = r.get("last_lap_ms", 0)
            if ms and d["_last"] is not None and ms != d["_last"]:
                d["laps"].append([len(d["laps"]) + 1, round(t, 2), ms])
            if d["_last"] is None or ms:
                d["_last"] = ms
            if not d["status"] or d["status"][-1][1] != r["result_status"]:
                d["status"].append([round(t, 2), r["result_status"]])
    for d in out.values():
        del d["_last"]
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


def incidents(frames, collisions, track_len):
    """Group the game's contacts into incidents (see the module doc)."""
    times = [t for t, _ in frames]
    normal = Normal(frames)

    def at(t):
        k = min(max(bisect.bisect_left(times, t), 0), len(frames) - 1)
        return frames[k][1]

    def gap(a, b):
        d = abs(a - b)
        return min(d, track_len - d) if track_len else d

    out = []
    for c in sorted(collisions, key=lambda c: c["t"]):
        cars = at(c["t"])
        A, B = cars.get(c["a"]), cars.get(c["b"])
        if not A or not B:
            continue
        lap, dist = max(A[11], B[11]), A[10]
        joined = None
        for inc in out[-4:]:
            if inc["lap"] != lap or gap(inc["dist"], dist) > CORNER_M:
                continue
            # still open: a car of it is below 90% of its normal speed
            now = at(c["t"])
            if any(i in now and normal.ratio(i, now[i]) < NORMAL for i in inc["cars"]) or c["t"] - inc["t1"] < 1.5:
                joined = inc
                break
        if joined is None:
            joined = {"t0": c["t"], "t1": c["t"], "lap": lap, "dist": dist, "cars": [], "contacts": [],
                      "x": round((A[0] + B[0]) / 2, 1), "z": round((A[1] + B[1]) / 2, 1)}
            out.append(joined)
        joined["t1"] = c["t"]
        joined["contacts"].append({"t": round(c["t"], 2), "a": c["a"], "b": c["b"], "severity": c.get("severity", 0)})
        for i in (c["a"], c["b"]):
            if i not in joined["cars"]:
                joined["cars"].append(i)
    # drivers near it who went off, spun or braked hard without touching anyone
    for inc in out:
        role = {i: "contact" for i in inc["cars"]}
        k0, k1 = bisect.bisect_left(times, inc["t0"] - NEAR_S), bisect.bisect_right(times, inc["t1"] + NEAR_S)
        for t, cars in frames[k0:k1]:
            for i, c in cars.items():
                if i in role or math.hypot(c[0] - inc["x"], c[1] - inc["z"]) > NEAR_M:
                    continue
                if bin(c[9]).count("1") >= 2:
                    role[i] = "off track"
                elif c[6] > 0.8 and normal.ratio(i, c) < 0.7:
                    role[i] = "hard braking"
        # end: every involved car back above 90% of normal speed (or 8 s at most)
        end = inc["t1"]
        for t, cars in frames[bisect.bisect_left(times, inc["t1"]):]:
            end = t
            if t - inc["t1"] > 8 or all(i not in cars or normal.ratio(i, cars[i]) >= NORMAL for i in role):
                break
        inc.update(t0=round(inc["t0"], 2), t1=round(end, 2), dist=round(inc["dist"]),
                   drivers=[{"car": i, "role": r} for i, r in role.items()])
        del inc["cars"]
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
                "incidents": incidents(frames, sess.collisions, sess.info.get("track_length", 0))}
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
