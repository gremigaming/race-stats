#!/usr/bin/env python3
"""Check uploader/TelemetryRecorder.cs with a made-up session (run by recorder-check.yml).

    python3 scripts/telemetry/test_recorder.py send [PORT]   # 15 s of fake game packets
    python3 scripts/telemetry/test_recorder.py check DIR     # read the file the recorder saved

Two cars drive side by side down the X axis; car 1 hits the player 10 s in.
"""

import glob
import os
import socket
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gmtel  # noqa: E402

CARS = 24
UID = 0x1234567890ABCDEF
HZ = 60
SECONDS = 15
HIT_AT = 10.0


def header(pid, t, frame):
    return gmtel.HEADER.pack(2026, 25, 1, 0, 1, pid, UID, t, frame, frame, 0, 255)


def car_x(i, t):
    return 50.0 * t + (3.0 if i == 1 else 0.0)  # car 1 is 3 m ahead of the player


def motion(t, frame):
    rows = b""
    for i in range(CARS):
        if i < 2:
            rows += struct.pack("<6f6h3h3f", car_x(i, t), 1.0, 2.0 * i, 50.0, 0.0, 0.0,
                                32767, 0, 0, 0, 0, -32767, 0, 0, 1000, 0.0, 0.0, 0.0)
        else:
            rows += bytes(54)
    return header(0, t, frame) + rows


def lap(t, frame):
    rows = b""
    for i in range(CARS):
        if i < 2:
            r = gmtel.LAP.pack(*([0] * 10 + [car_x(i, t), car_x(i, t), 0.0] + [2 - i, 1] + [0] * 18))
        else:
            r = bytes(gmtel.LAP.size)
        rows += r
    return header(2, t, frame) + rows + bytes(2)


def telemetry(t, frame):
    size = gmtel.TELEMETRY[2026].size
    rows = b""
    for i in range(CARS):
        if i < 2:
            rows += struct.pack("<HfffBb", 180, 1.0, 0.25 * i, 0.0, 0, 7) + bytes(size - 16)
        else:
            rows += bytes(size)
    return header(6, t, frame) + rows + bytes(3)


def participants(t, frame):
    rows = b""
    for i in range(CARS):
        name = {0: b"GreMi_Gaming", 1: b"Tester"}.get(i, b"")
        rows += bytes([0]) + struct.pack("<HHH", 65535, i, 1) + bytes([0, 10 + i, 0]) \
            + name.ljust(32, b"\0") + bytes([1, 1]) + bytes(16)
    return header(4, t, frame) + bytes([2]) + rows


def session(t, frame):
    return header(1, t, frame) + struct.pack("<BbbBHBbB", 0, 30, 20, 5, 5000, 15, 7, 0) + bytes(900)


def event(t, frame):
    return header(3, t, frame) + b"COLL" + bytes([1, 0, 1]) + bytes(9)


def send(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    start = time.time()
    for frame in range(HZ * SECONDS):
        t = frame / HZ
        out = [motion(t, frame), lap(t, frame), telemetry(t, frame)]
        if frame % (HZ * 5) == 0:
            out += [session(t, frame), participants(t, frame)]
        if frame == int(HIT_AT * HZ):
            out.append(event(t, frame))
        for p in out:
            s.sendto(p, ("127.0.0.1", port))
        wait = start + (frame + 1) / HZ - time.time()
        if wait > 0:
            time.sleep(wait)


def check(folder):
    files = glob.glob(os.path.join(folder, "*.gmtel.gz"))
    assert len(files) == 1, f"expected one saved session, found {files}"
    s = gmtel.Session(files[0])
    print(os.path.basename(files[0]), s.info, s.summary())
    assert "Silverstone_Race" in files[0], files[0]
    assert s.laps, "the player's own samples are missing"
    assert s.drivers[1]["name"] == "Tester" and s.drivers[1]["race_number"] == 11, s.drivers.get(1)
    assert len(s.collisions) == 1 and s.collisions[0]["a"] == 1, s.collisions

    times = sorted(s.field)
    quiet = [t for t in times if t < HIT_AT - 6]
    near = [t for t in times if HIT_AT - 4 <= t <= HIT_AT + 2]
    quiet_rate = len(quiet) / (HIT_AT - 6)
    near_rate = len(near) / 6
    print(f"{len(times)} all-car ticks, {quiet_rate:.1f}/s far from the hit, {near_rate:.1f}/s around it")
    assert 7 <= quiet_rate <= 25, quiet_rate   # about 10 motion + 10 telemetry + 2 lap rows a second
    assert near_rate >= 25, near_rate          # 30 a second around the collision

    g = s.geometry(HIT_AT, 0, 1)
    print("geometry at the hit:", g)
    assert abs(g["ahead_m"] - 3.0) < 0.5 and abs(g["right_m"] + 2.0) < 0.2, g
    assert g["steer_b"] == 0.25 and g["speed_a"] == 180, g
    print("recorder check passed")


if __name__ == "__main__":
    if sys.argv[1] == "send":
        send(int(sys.argv[2]) if len(sys.argv) > 2 else 20778)
    else:
        check(sys.argv[2])
