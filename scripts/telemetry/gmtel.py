#!/usr/bin/env python3
"""Read telemetry files written by uploader/TelemetryRecorder.cs.

A .gmtel.gz file holds one game session of the player's own car: every packet
the F1 game sent (60 Hz when the game's UDP send rate is 60), cut down to the
player's car. This turns it into laps of samples, one sample per game frame.

    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz              # lap summary
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --csv OUTDIR  # one CSV per lap
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --json OUT    # everything
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --field OUT.csv  # every car, every row
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --collisions  # where both cars were

Files recorded since 19 Oct 2026 also hold short rows for every car (position,
heading, speed, inputs, lap distance): 10 per second, and 30 per second from
5 s before to 3 s after a collision. Session.field has them.

Packet layouts follow the game's UDP spec as implemented by Pits n' Giggles
(lib/f1_types), for packet formats 2025 and 2026. Wheel arrays are RL, RR, FL, FR.
"""

import argparse
import csv
import gzip
import json
import math
import os
import struct
import sys

HEADER = struct.Struct("<HBBBBBQfIIBB")  # 29 bytes
MAGIC = b"GMTEL1\n"

MOTION = {
    2025: struct.Struct("<ffffff hhhhhh fff fff".replace(" ", "")),
    2026: struct.Struct("<ffffff hhhhhh hhh fff".replace(" ", "")),
}
LAP = struct.Struct("<IIHBHBHBHBfffBBBBBBBBBBBBBBBHHBfB")
TELEMETRY = {
    2025: struct.Struct("<HfffBbHBBH4H4B4BH4f4B"),
    2026: struct.Struct("<HfffBbHBBH4H4B4BB4f4B"),
}
MOTION_EX = struct.Struct("<" + "4f" * 8 + "f" * 11 + "4f" + "5f" + "f4f4f")
SETUP = struct.Struct("<BBBBffffBBBBBBBBBffffBf")
TELEMETRY2 = struct.Struct("<BBHBBHBB")
SESSION_START = struct.Struct("<BbbBHBbB")
# all-car rows (record kind 2): the first bytes of each car's struct
FIELD_MOTION = struct.Struct("<6f6h")       # position, velocity, forward dir, right dir
FIELD_LAP = struct.Struct("<IIHBHBHBHBfff14B")
FIELD_TELEMETRY = struct.Struct("<HfffBb")  # speed, throttle, steer, brake, clutch, gear

TRACKS = ["Melbourne", "Paul Ricard", "Shanghai", "Bahrain", "Catalunya", "Monaco", "Montreal",
          "Silverstone", "Hockenheim", "Hungaroring", "Spa", "Monza", "Singapore", "Suzuka",
          "Abu Dhabi", "Texas", "Brazil", "Austria", "Sochi", "Mexico", "Baku", "Bahrain Short",
          "Silverstone Short", "Texas Short", "Suzuka Short", "Hanoi", "Zandvoort", "Imola",
          "Portimao", "Jeddah", "Miami", "Las Vegas", "Losail"]
TRACKS += [""] * (39 - len(TRACKS)) + ["Silverstone Reverse", "Austria Reverse",
                                        "Zandvoort Reverse", "Madrid"]
SESSION_TYPES = ["Unknown", "P1", "P2", "P3", "Short practice", "Q1", "Q2", "Q3", "Short quali",
                 "One-shot quali", "Race", "Race 2", "Race 3", "Time trial"]
SESSION_TYPES_24 = ["Unknown", "P1", "P2", "P3", "Short practice", "Q1", "Q2", "Q3", "Short quali",
                    "One-shot quali", "Sprint shootout 1", "Sprint shootout 2", "Sprint shootout 3",
                    "Short sprint shootout", "One-shot sprint shootout", "Race", "Race 2", "Race 3",
                    "Time trial"]
WHEELS = ("rl", "rr", "fl", "fr")


def records(path):
    """Yield (header tuple, payload bytes after the header, kind) per record:
    kind 0 = whole packet, 1 = the player's slice, 2 = rows for every car."""
    # A file cut off by a PC shutdown ("_unfinished") has no gzip end: keep what's there
    chunks = []
    with gzip.open(path, "rb") as f:
        try:
            while True:
                c = f.read(1 << 20)
                if not c:
                    break
                chunks.append(c)
        except (EOFError, OSError):
            pass
    data = b"".join(chunks)
    if not data.startswith(MAGIC):
        raise ValueError(f"{path} is not a GreMi telemetry file")
    pos = len(MAGIC)
    while pos + 3 <= len(data):
        kind = data[pos]
        length = data[pos + 1] | (data[pos + 2] << 8)
        pos += 3
        rec = data[pos:pos + length]
        pos += length
        if len(rec) < length:
            break  # file cut off mid-record (PC shut down while recording)
        yield HEADER.unpack_from(rec), rec[HEADER.size:], kind


def wheels(prefix, values):
    return {f"{prefix}_{w}": v for w, v in zip(WHEELS, values)}


def parse_motion(fmt, b):
    v = MOTION[fmt].unpack_from(b)
    scale = 1000.0 if fmt >= 2026 else 1.0
    return {"x": v[0], "y": v[1], "z": v[2], "g_lat": v[12] / scale, "g_long": v[13] / scale,
            "g_vert": v[14] / scale, "yaw": v[15], "pitch": v[16], "roll": v[17]}


def parse_lap(b):
    v = LAP.unpack_from(b)
    return {"last_lap_ms": v[0], "lap_time_ms": v[1], "lap_distance": v[10],
            "total_distance": v[11], "position": v[13], "lap": v[14], "pit_status": v[15],
            "sector": v[17] + 1, "lap_invalid": v[18], "corner_warnings": v[21],
            "driver_status": v[25]}


def parse_telemetry(fmt, b):
    v = TELEMETRY[fmt].unpack_from(b)
    s = {"speed": v[0], "throttle": v[1], "steer": v[2], "brake": v[3], "clutch": v[4],
         "gear": v[5], "rpm": v[6], "drs": v[7]}
    s.update(wheels("brake_temp", v[10:14]))
    s.update(wheels("tyre_surface", v[14:18]))
    s.update(wheels("tyre_inner", v[18:22]))
    s["engine_temp"] = v[22]
    s.update(wheels("tyre_psi", v[23:27]))
    s.update(wheels("surface", v[27:31]))
    return s


def parse_motion_ex(b):
    v = MOTION_EX.unpack_from(b)
    s = {}
    names = ["susp_pos", "susp_vel", "susp_acc", "wheel_speed", "slip_ratio", "slip_angle",
             "lat_force", "long_force"]
    for i, n in enumerate(names):
        s.update(wheels(n, v[i * 4:i * 4 + 4]))
    o = 32
    for n in ["cog_height", "local_vx", "local_vy", "local_vz", "ang_vx", "ang_vy", "ang_vz",
              "ang_ax", "ang_ay", "ang_az", "front_wheels_angle"]:
        s[n] = v[o]
        o += 1
    s.update(wheels("vert_force", v[o:o + 4]))
    o += 4
    for n in ["front_aero_height", "rear_aero_height", "front_roll", "rear_roll", "chassis_yaw",
              "chassis_pitch"]:
        s[n] = v[o]
        o += 1
    s.update(wheels("camber", v[o:o + 4]))
    s.update(wheels("camber_gain", v[o + 4:o + 8]))
    return s


def parse_field(pid, b):
    """Rows for every car from a kind 2 record: {car index: {...}}."""
    size = b[0]
    out = {}
    for i in range((len(b) - 1) // size if size else 0):
        r = b[1 + i * size:1 + (i + 1) * size]
        if pid == 0 and size >= FIELD_MOTION.size:
            v = FIELD_MOTION.unpack_from(r)
            if v[0] == v[1] == v[2] == 0:
                continue  # empty slot
            out[i] = {"x": v[0], "y": v[1], "z": v[2], "vx": v[3], "vy": v[4], "vz": v[5],
                      "fx": v[6] / 32767, "fy": v[7] / 32767, "fz": v[8] / 32767,
                      "rx": v[9] / 32767, "ry": v[10] / 32767, "rz": v[11] / 32767}
        elif pid == 2 and size >= FIELD_LAP.size:
            v = FIELD_LAP.unpack_from(r)
            if v[13] == 0:
                continue
            out[i] = {"lap_distance": v[10], "total_distance": v[11], "position": v[13],
                      "lap": v[14], "pit_status": v[15], "sector": v[17] + 1,
                      "driver_status": v[25], "result_status": v[26], "grid": v[24],
                      "last_lap_ms": v[0], "gap_front_ms": v[6] + v[7] * 60000}
        elif pid == 6 and size >= FIELD_TELEMETRY.size:
            v = FIELD_TELEMETRY.unpack_from(r)
            out[i] = {"speed": v[0], "throttle": v[1], "steer": v[2], "brake": v[3], "gear": v[5]}
            if size >= FIELD_TELEMETRY.size + 4:  # newer recorder: surface under each wheel
                out[i].update(wheels("surface", r[size - 4:size]))
    return out


def parse_participants(b):
    """{car index: {"name", "ai", "race_number", "team", "public"}} (packet format 2026)."""
    n = b[0]
    per = (len(b) - 1) // 24 if (len(b) - 1) % 24 == 0 else (len(b) - 1) // 22
    name_at = 10 if per >= 60 else 7
    out = {}
    for i in range(n):
        r = b[1 + i * per:1 + (i + 1) * per]
        name = r[name_at:name_at + 32].split(b"\0", 1)[0].decode("utf-8", "replace")
        out[i] = {"name": name, "ai": r[0], "race_number": r[name_at - 2],
                  "team": struct.unpack_from("<H", r, 5)[0] if per >= 60 else r[3],
                  "public": r[name_at + 32]}
    return out


def parse_setup(b):
    v = SETUP.unpack_from(b)
    keys = ["front_wing", "rear_wing", "diff_on_throttle", "diff_off_throttle", "front_camber",
            "rear_camber", "front_toe", "rear_toe", "front_suspension", "rear_suspension",
            "front_arb", "rear_arb", "front_ride_height", "rear_ride_height", "brake_pressure",
            "brake_bias", "engine_braking", "rl_psi", "rr_psi", "fl_psi", "fr_psi", "ballast",
            "fuel_load"]
    return {k: round(x, 3) if isinstance(x, float) else x for k, x in zip(keys, v)}


def parse_telemetry2(b):
    v = TELEMETRY2.unpack_from(b)
    return {"active_aero": v[0], "overtake_active": v[4]}


class Session:
    def __init__(self, path):
        self.path = path
        self.info = {}
        self.setups = []      # (session time, setup) whenever it changes
        self.events = []      # (session time, code)
        self.event_detail = []  # start lights, overtakes and retirements with their cars
        self.collisions = []  # {"t", "a", "b", "severity"} (car indexes)
        self.drivers = {}     # car index -> participant info
        self.field = {}       # session time -> {car index: merged motion/lap/telemetry row}
        self.field_frames = {}  # session time -> the game's frame id of that motion row
        self.laps = {}        # lap number -> {"samples": [...], "time_ms": .., "invalid": ..}
        self.packet_format = None
        self._cur = None      # sample being filled for the current send tick
        self._ticks = []
        self._after_finish = {}
        self._read()

    def _sample(self, h, pid):
        """The sample for this send tick. The game sends motion, lap data, telemetry etc. once
        per tick, but their frame ids can differ, so a tick ends when a packet type repeats."""
        cur = self._cur
        if cur is None or pid in cur["_ids"]:
            if cur is not None:
                self._ticks.append(cur)
            cur = self._cur = {"_ids": set(), "frame": h[9], "t": round(h[7], 4)}
        cur["_ids"].add(pid)
        return cur

    def _read(self):
        last_setup = None
        for h, body, kind in records(self.path):
            fmt, pid = h[0], h[5]
            sliced = kind == 1
            if kind == 2:
                try:
                    rows = parse_field(pid, body)
                except struct.error:
                    continue
                tick = self.field.setdefault(round(h[7], 3), {})
                if pid == 0:
                    self.field_frames[round(h[7], 3)] = h[9]
                for i, r in rows.items():
                    tick.setdefault(i, {}).update(r)
                continue
            self.packet_format = fmt
            fmt_key = 2026 if fmt >= 2026 else 2025
            try:
                if pid == 0 and sliced:
                    self._sample(h, 0).update(parse_motion(fmt_key, body))
                elif pid == 2 and sliced:
                    self._sample(h, 2).update(parse_lap(body))
                elif pid == 6 and sliced:
                    self._sample(h, 6).update(parse_telemetry(fmt_key, body))
                elif pid == 13:
                    self._sample(h, 13).update(parse_motion_ex(body))
                elif pid == 16 and sliced:
                    self._sample(h, 16).update(parse_telemetry2(body))
                elif pid == 5 and sliced:
                    setup = parse_setup(body)
                    if setup != last_setup and setup["front_wing"] + setup["rear_wing"] > 0:
                        self.setups.append((round(h[7], 2), setup))
                        last_setup = setup
                elif pid == 3:
                    code = body[:4].decode("ascii", "replace")
                    if code not in ("BUTN", "SPTP", "OVTK"):
                        self.events.append((round(h[7], 2), code))
                    if code == "STLG" and len(body) >= 5:
                        self.event_detail.append({"t": round(h[7], 3), "code": code, "lights": body[4]})
                    elif code == "OVTK" and len(body) >= 6:
                        self.event_detail.append({"t": round(h[7], 3), "code": code, "a": body[4], "b": body[5]})
                    elif code == "RTMT" and len(body) >= 5:
                        self.event_detail.append({"t": round(h[7], 3), "code": code, "car": body[4]})
                    if code == "COLL" and len(body) >= 7:
                        self.collisions.append({"t": round(h[7], 3), "a": body[4], "b": body[5],
                                                "severity": body[6]})
                elif pid == 4 and not sliced:
                    self.drivers.update(parse_participants(body))
                elif pid == 1:
                    v = SESSION_START.unpack_from(body)
                    types = SESSION_TYPES_24 if fmt >= 2024 else SESSION_TYPES
                    self.info = {"weather": v[0], "track_temp": v[1], "air_temp": v[2],
                                 "total_laps": v[3], "track_length": v[4],
                                 "session_type": types[v[5]] if v[5] < len(types) else v[5],
                                 "track": TRACKS[v[6]] if 0 <= v[6] < len(TRACKS) else v[6]}
            except struct.error:
                continue
        if self._cur is not None:
            self._ticks.append(self._cur)
        for s in self._ticks:
            del s["_ids"]
            if "lap" in s and "speed" in s:
                self._file(s)
        self._ticks = []

    def _file(self, s):
        """File one frame's sample under its lap, undoing what a flashback rewound."""
        n = s["lap"] + self._after_finish.get(s["lap"], 0)
        prev = self.laps.get(n - 1)
        if prev is not None and prev.get("time_ms") is None and s["last_lap_ms"]:
            prev["time_ms"] = s["last_lap_ms"]
        if any(k > n for k in self.laps):  # flashback into an earlier lap
            for later in [k for k in self.laps if k > n]:
                del self.laps[later]
            self.laps[n]["time_ms"] = None
        entry = self.laps.setdefault(n, {"samples": [], "time_ms": None, "invalid": 0})
        samples = entry["samples"]
        if samples and samples[-1]["lap_time_ms"] > s["lap_time_ms"] + 5000 \
                and samples[-1]["lap_distance"] > s["lap_distance"] + 1000:
            # crossed the finish line: the game keeps the lap number but restarts the clock
            entry["time_ms"] = samples[-1]["lap_time_ms"]
            entry["finish"] = True
            self._after_finish[s["lap"]] = self._after_finish.get(s["lap"], 0) + 1
            self._file(s)
            return
        while samples and samples[-1]["lap_time_ms"] > s["lap_time_ms"]:
            samples.pop()
        samples.append(s)
        entry["invalid"] = s["lap_invalid"]

    def field_at(self, t, window=0.25):
        """Every car's row nearest to session time t (within `window` s), merged across packets."""
        out = {}
        for ft in sorted(self.field, key=lambda x: abs(x - t)):
            if abs(ft - t) > window:
                break
            for i, r in self.field[ft].items():
                cur = out.setdefault(i, {})
                for k, v in r.items():
                    cur.setdefault(k, v)
        return out

    def geometry(self, t, a, b):
        """Where car b was relative to car a at time t: metres ahead (+) / behind (-) along
        a's heading, metres right (+) / left (-), and how fast they closed in (m/s)."""
        f = self.field_at(t)
        if a not in f or b not in f or "x" not in f[a] or "x" not in f[b]:
            return None
        A, B = f[a], f[b]
        dx, dz = B["x"] - A["x"], B["z"] - A["z"]
        fl = math.hypot(A["fx"], A["fz"]) or 1
        fx, fz = A["fx"] / fl, A["fz"] / fl
        ahead = dx * fx + dz * fz
        right = dx * A["rx"] + dz * A["rz"]
        dist = math.hypot(dx, dz) or 1
        closing = -((B["vx"] - A["vx"]) * dx + (B["vz"] - A["vz"]) * dz) / dist
        return {"ahead_m": round(ahead, 2), "right_m": round(right, 2), "gap_m": round(dist, 2),
                "closing_ms": round(closing, 2),
                "speed_a": A.get("speed"), "speed_b": B.get("speed"),
                "brake_a": A.get("brake"), "brake_b": B.get("brake"),
                "steer_a": A.get("steer"), "steer_b": B.get("steer")}

    def name(self, i):
        d = self.drivers.get(i)
        return d["name"] if d and d["name"] else f"car {i}"

    def summary(self):
        rows = []
        for n in sorted(self.laps):
            lap = self.laps[n]
            s = lap["samples"]
            if not s:
                continue
            rows.append({
                "lap": n,
                "time": fmt_ms(lap["time_ms"]) if lap["time_ms"] else "unfinished",
                "valid": not lap["invalid"],
                "samples": len(s),
                "hz": round(len(s) / max(s[-1]["t"] - s[0]["t"], 1e-6), 1) if len(s) > 1 else 0,
                "top_speed": max(x.get("speed", 0) for x in s),
                "out_lap": s[0]["lap_distance"] < 0 or s[0].get("pit_status", 0) > 0,
            })
        return rows


def fmt_ms(ms):
    return f"{ms // 60000}:{(ms % 60000) / 1000:06.3f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("file")
    ap.add_argument("--csv", help="write one CSV per lap into this folder")
    ap.add_argument("--json", help="write the whole session as JSON")
    ap.add_argument("--field", help="write every car's rows as one CSV")
    ap.add_argument("--collisions", action="store_true", help="show where both cars were at each collision")
    a = ap.parse_args()
    sess = Session(a.file)
    print(f"{os.path.basename(a.file)}: {sess.info.get('track', '?')} {sess.info.get('session_type', '')}, "
          f"packet format {sess.packet_format}")
    for t, setup in sess.setups:
        print(f"setup at {t}s: {json.dumps(setup)}")
    for row in sess.summary():
        print("lap {lap:>2}  {time:>10}  {v}  {samples:>5} samples  {hz:>5} Hz  top {top_speed} km/h".format(
            v="valid  " if row["valid"] else "INVALID", **row))
    if a.csv:
        os.makedirs(a.csv, exist_ok=True)
        for n, lap in sorted(sess.laps.items()):
            if not lap["samples"]:
                continue
            cols = sorted({k for s in lap["samples"] for k in s})
            with open(os.path.join(a.csv, f"lap{n:02d}.csv"), "w", newline="") as f:
                w = csv.DictWriter(f, fieldnames=cols)
                w.writeheader()
                w.writerows(lap["samples"])
    if a.field:
        cols = ["t", "car", "name", "x", "y", "z", "vx", "vy", "vz", "fx", "fy", "fz", "rx", "ry", "rz",
                "speed", "throttle", "steer", "brake", "gear", "lap", "lap_distance", "total_distance",
                "position", "pit_status", "sector", "driver_status", "result_status"]
        with open(a.field, "w", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
            w.writeheader()
            for t in sorted(sess.field):
                for i, r in sorted(sess.field[t].items()):
                    w.writerow({"t": t, "car": i, "name": sess.name(i), **r})
        print(f"{len(sess.field)} all-car rows written to {a.field}")
    if a.collisions:
        sev = ["light", "medium", "heavy"]
        for c in sess.collisions:
            g = None
            for back in (0.0, 0.1, 0.2, 0.3):  # cars can be apart a frame after the hit
                g = sess.geometry(c["t"] - back, c["a"], c["b"])
                if g:
                    break
            label = sev[c["severity"]] if c["severity"] < 3 else c["severity"]
            print(f"{c['t']:8.2f}s {label:>6}  {sess.name(c['a'])} vs {sess.name(c['b'])}: "
                  + (json.dumps(g) if g else "no all-car rows (recorded before 19 Oct 2026?)"))
    if a.json:
        with open(a.json, "w") as f:
            json.dump({"info": sess.info, "setups": sess.setups, "events": sess.events,
                       "laps": sess.laps}, f, default=lambda o: None if isinstance(o, float) and math.isnan(o) else o)


if __name__ == "__main__":
    sys.exit(main())
