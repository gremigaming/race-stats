#!/usr/bin/env python3
"""Read telemetry files written by uploader/TelemetryRecorder.cs.

A .gmtel.gz file holds one game session of the player's own car: every packet
the F1 game sent (60 Hz when the game's UDP send rate is 60), cut down to the
player's car. This turns it into laps of samples, one sample per game frame.

    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz              # lap summary
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --csv OUTDIR  # one CSV per lap
    python3 scripts/telemetry/gmtel.py FILE.gmtel.gz --json OUT    # everything

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
    """Yield (header tuple, payload bytes after the header, is_slice) per record."""
    with gzip.open(path, "rb") as f:
        data = f.read()
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
        yield HEADER.unpack_from(rec), rec[HEADER.size:], kind == 1


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
        for h, body, sliced in records(self.path):
            fmt, pid = h[0], h[5]
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
    if a.json:
        with open(a.json, "w") as f:
            json.dump({"info": sess.info, "setups": sess.setups, "events": sess.events,
                       "laps": sess.laps}, f, default=lambda o: None if isinstance(o, float) and math.isnan(o) else o)


if __name__ == "__main__":
    sys.exit(main())
