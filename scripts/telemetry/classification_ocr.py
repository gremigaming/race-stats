#!/usr/bin/env python3
"""Read who drove which car from the game's final classification screen.

After every race the uploader on the racing PC (uploader/ClassificationCapture.ps1)
takes screenshots of the classification screen, reads them with Windows' own OCR
and sends the words with their positions, plus the game's final classification
and participants packets, as an encrypted .gmcls file to the "telemetry" release.
Screenshots never leave the PC; the words are encrypted with the public key in
uploader/classification-key.xml, and only the site build can read them
(CLASSIFICATION_KEY secret, the matching private key in PEM).

Each OCR row is tied to a car by numbers the game also sends: best lap
(m:ss.mmm, unique per driver), gap to the winner, position and DNF/DSQ. The text
left over in that row is the name. Every frame (several screenshots, two image
variants each) votes; the name most frames agree on wins. Cars that show their
name in the game are the check: their OCR name must equal the game's name.

    python3 scripts/telemetry/classification_ocr.py CACHE OUT.json
        downloads new .gmcls files, writes every capture to OUT.json for
        scripts/build-league-data.mjs (which links captures to race files and
        names the hidden cars). Without CLASSIFICATION_KEY it writes no captures.
    python3 scripts/telemetry/classification_ocr.py --file X.gmcls [--key KEY.pem]
        prints one capture.
"""

import base64
import collections
import difflib
import hashlib
import hmac
import json
import os
import re
import struct
import sys
import urllib.request

VERSION = 1
MAGIC = b"GMCLS1\n"
HEADER_LEN = 29
RELEASE = "https://api.github.com/repos/gremigaming/race-stats/releases/tags/telemetry"
DOWNLOAD = "https://github.com/gremigaming/race-stats/releases/download/telemetry/"
STATUS = {0: "invalid", 1: "inactive", 2: "active", 3: "finished", 4: "dnf", 5: "dsq", 6: "not classified", 7: "retired"}
TEAMS = ["Ferrari", "Mercedes", "Red Bull Racing", "Red Bull", "McLaren", "Aston Martin", "Alpine",
         "Williams", "Haas", "Haas F1 Team", "Racing Bulls", "Visa Cash App RB", "VCARB", "RB",
         "Kick Sauber", "Stake F1 Team", "Sauber", "Audi", "Cadillac", "My Team", "Konnersport"]


# ------------------------------------------------------------------ packets

def parse_results(packet):
    """Final classification packet -> {car index: {position, laps, best_ms, total, penalty, status}}."""
    b = packet[HEADER_LEN:]
    n = b[0]
    per = (len(b) - 1) // 24 if (len(b) - 1) % 24 == 0 else (len(b) - 1) // 22
    out = {}
    for i in range(n):
        r = b[1 + i * per:1 + (i + 1) * per]
        if len(r) < 45:
            break
        k = 7 if per >= 46 else 6   # F1 25 added the result reason byte
        best, total = struct.unpack_from("<Id", r, k)
        if not r[0]:
            continue
        out[i] = {"position": r[0], "laps": r[1], "status": STATUS.get(r[5], str(r[5])),
                  "best_ms": best, "total": total, "penalty": r[k + 12]}
    return out


def parse_participants(packet):
    """Participants packet -> {car index: {name, ai, hidden, race_number}}."""
    b = packet[HEADER_LEN:]
    n = b[0]
    per = (len(b) - 1) // 24 if (len(b) - 1) % 24 == 0 else (len(b) - 1) // 22
    name_at = 10 if per >= 60 else 7
    out = {}
    for i in range(n):
        r = b[1 + i * per:1 + (i + 1) * per]
        name = r[name_at:name_at + 32].split(b"\0", 1)[0].decode("utf-8", "replace")
        out[i] = {"name": name, "ai": bool(r[0]), "race_number": r[name_at - 2],
                  "hidden": r[name_at + 33] == 0}
    return out


# ------------------------------------------------------------------ decryption

def decrypt(blob, private_pem):
    """.gmcls bytes -> payload dict. Written by ClassificationCapture.ps1: RSA-OAEP (SHA-1)
    wraps a 32-byte AES key + 32-byte HMAC key; AES-256-CBC, HMAC-SHA256 over IV + data."""
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    if not blob.startswith(MAGIC):
        raise ValueError("not a classification capture")
    pos = len(MAGIC)
    klen = struct.unpack_from("<H", blob, pos)[0]
    pos += 2
    wrapped = blob[pos:pos + klen]
    pos += klen
    key = serialization.load_pem_private_key(private_pem, password=None)
    keys = key.decrypt(wrapped, padding.OAEP(mgf=padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA1(), label=None))
    aes, mac = keys[:32], keys[32:64]
    iv, data, tag = blob[pos:pos + 16], blob[pos + 16:-32], blob[-32:]
    if not hmac.compare_digest(hmac.new(mac, iv + data, hashlib.sha256).digest(), tag):
        raise ValueError("capture was changed or the key is wrong")
    d = Cipher(algorithms.AES(aes), modes.CBC(iv)).decryptor()
    plain = d.update(data) + d.finalize()
    plain = plain[:-plain[-1]]
    return json.loads(plain.decode("utf-8-sig"))


# ------------------------------------------------------------------ OCR rows

DIGITISH = str.maketrans({"O": "0", "o": "0", "D": "0", "Q": "0", "I": "1", "l": "1", "|": "1", "i": "1",
                          "S": "5", "s": "5", "B": "8", "Z": "2", "z": "2", "G": "6", ";": ":", ",": "."})
LAP = re.compile(r"^(?:(\d):)?(\d{1,2})[:.](\d{2})[.:](\d{3})$")
GAP = re.compile(r"^\+?(\d{1,4})[.:](\d{3})s?$")  # Windows OCR sometimes drops the +
INT = re.compile(r"^\d{1,2}$")
WORDS_DATA = {"LAP", "LAPS", "PTS", "DNF", "DSQ", "DNS", "RET", "NC", "S", "+", "-", "POS", "BEST", "TIME", "GAP",
              "INTERVAL", "LEADER", "PIT", "OUT"}
STATUS_WORDS = {"DNF": "dnf", "RET": "dnf", "DSQ": "dsq", "DNS": "dns", "NC": "not classified"}


def numeric(text):
    """The token read as a number, fixing letters OCR confuses with digits, if it looks numeric."""
    t = text.strip().rstrip("s") if text.strip().startswith("+") else text.strip()
    digits = sum(c.isdigit() for c in t)
    if digits < max(1, len(t) // 2):
        return None
    n = t.translate(DIGITISH)
    return n if re.fullmatch(r"[+\-]?[\d:.]+", n) else None


def token_kind(text):
    """('lap', ms) | ('gap', seconds) | ('int', n) | ('laps', n) | ('status', s) | ('word', None) | ('text', None)"""
    up = text.strip().upper().strip(".")
    if up in STATUS_WORDS:
        return "status", STATUS_WORDS[up]
    if up in WORDS_DATA:
        return "word", None
    n = numeric(text)
    if n is not None:
        m = LAP.match(n)
        if m:
            h, mi, s, ms = (int(x or 0) for x in m.groups())
            return "lap", ((h * 60 + mi) * 60 + s) * 1000 + ms
        m = GAP.match(n)
        if m:
            return "gap", int(m[1]) + int(m[2]) / 1000
        m = re.match(r"^\+(\d{1,2})$", n)
        if m:
            return "laps", int(m[1])
        if INT.match(n):
            return "int", int(n)
        return "word", None
    return "text", None


def lines_of(words):
    """Words [[text, x, y, w, h], ...] -> rows (lists of words sorted left to right)."""
    ws = sorted((w for w in words if str(w[0]).strip()), key=lambda w: w[2] + w[4] / 2)
    if not ws:
        return []
    hs = sorted(w[4] for w in ws)
    med = hs[len(hs) // 2]
    rows, cur, cy = [], [], None
    for w in ws:
        yc = w[2] + w[4] / 2
        if cur and abs(yc - cy) > 0.45 * max(med, 1):
            rows.append(sorted(cur, key=lambda w: w[1]))
            cur = []
        cur.append(w)
        cy = sum(x[2] + x[4] / 2 for x in cur) / len(cur)
    rows.append(sorted(cur, key=lambda w: w[1]))
    return rows


def norm(name):
    # letters OCR mixes up count as the same: 0/O, 1/I/l/|
    return re.sub(r"[^A-Z0-9]", "", name.upper().replace("0", "O").replace("|", "I").replace("1", "I").replace("L", "I"))


def is_team(text):
    k = norm(text)
    return any(k == norm(t) or (len(k) >= 4 and difflib.SequenceMatcher(None, k, norm(t)).ratio() >= 0.8) for t in TEAMS)


def name_in(row):
    """The driver name in one row: the first group of text words (left to right) that is not a team."""
    groups, cur, last = [], [], None
    for w in row:
        kind = token_kind(w[0])[0]
        # digits right after a name ("Ghost_0815" read as "Ghost" "0815") stay part of it
        if kind in ("int", "word") and cur and w[1] - (last[1] + last[3]) < 1.0 * w[4]:
            kind = "text"
        if kind != "text" or not re.search(r"[A-Za-z0-9]", w[0]):
            if cur:
                groups.append(cur)
            cur, last = [], None
            continue
        if cur and w[1] - (last[1] + last[3]) > 1.2 * max(w[4], last[4]):
            groups.append(cur)
            cur = []
        cur.append(w)
        last = w
    if cur:
        groups.append(cur)
    for g in groups:
        # team logos and flags before the name read as a stray letter: drop it
        while len(g) > 1 and len(norm(g[0][0])) <= 1:
            g = g[1:]
        text = g[0][0]
        for a, b in zip(g, g[1:]):
            text += ("" if b[1] - (a[1] + a[3]) < 0.25 * b[4] else " ") + b[0]
        text = text.strip()
        if len(norm(text)) >= 2 and not is_team(text):
            return text
    return None


def score(row, car, leader):
    kinds = [token_kind(w[0]) for w in row]
    s = 0
    laps = [v for k, v in kinds if k == "lap"]
    if car["best_ms"] and any(abs(v - car["best_ms"]) <= 1 for v in laps):
        s += 10
    elif car["best_ms"]:
        want = f"{car['best_ms'] // 60000}{car['best_ms'] // 1000 % 60:02d}{car['best_ms'] % 1000:03d}"
        for w in row:
            n = numeric(w[0])
            d = re.sub(r"\D", "", n or "")
            if len(d) == len(want) and sum(a != b for a, b in zip(d, want)) == 1:
                s += 5
                break
    if leader is not None and car["status"] == "finished":
        if car is leader:
            if any(abs(v / 1000 - t) <= 0.002 for v in laps for t in (car["total"], car["total"] + car["penalty"])):
                s += 6
        else:
            gaps = [v for k, v in kinds if k == "gap"]
            want = {car["total"] + car["penalty"] - leader["total"] - leader["penalty"], car["total"] - leader["total"]}
            if any(abs(g - w) <= 0.0015 for g in gaps for w in want):
                s += 6
            if car["laps"] < leader["laps"] and ("laps", leader["laps"] - car["laps"]) in kinds:
                s += 4
    ints = [v for k, v in kinds if k == "int"]
    if ints and ints[0] == car["position"]:
        s += 3
    if any(k == "status" and v == ("dnf" if car["status"] in ("dnf", "retired") else car["status"]) for k, v in kinds):
        s += 3
    return s


def parse_lap(packet):
    """Lap data packet -> {car index: {position, gap_front (s), status}} (the live standings)."""
    b = packet[HEADER_LEN:]
    cars = 24 if struct.unpack_from("<H", packet, 0)[0] >= 2026 else 22
    per = (len(b) - 2) // cars    # 2 trailing bytes: time trial car indexes
    out = {}
    for i in range(cars):
        r = b[i * per:(i + 1) * per]
        if len(r) < 46 or not r[32] or r[45] < 2:
            continue   # empty slot, or a car not racing
        gap = (struct.unpack_from("<H", r, 14)[0] + r[16] * 60000) / 1000
        out[i] = {"position": r[32], "gap_front": gap, "status": STATUS.get(r[45], str(r[45]))}
    return out


def tower_score(row, car):
    """The live standings tower: position first, then the name, then the interval or DNF."""
    kinds = [token_kind(w[0]) for w in row]
    if not kinds or kinds[0] != ("int", car["position"]):
        return 0
    s = 6
    gaps = [v for k, v in kinds if k == "gap"]
    if gaps and car["position"] > 1 and car["status"] == "active":
        # the tower updates at timing lines, the lap data all the time: a big difference = places changed
        # (a frame where they disagree is skipped: losing a vote beats naming the wrong car)
        s += 3 if abs(gaps[0] - car["gap_front"]) <= 0.5 else -6
    if any(k == "status" for k, _ in kinds):
        s += 3 if car["status"] in ("dnf", "retired", "dsq") else -6
    return s


def match_frame(words, results, lap=None):
    """{car index: name} for one frame. Lap times on screen = classification screen (anchored on the
    final results); otherwise the standings tower (anchored on the live lap data of that moment)."""
    rows_all = lines_of(words)
    lap_times = sum(token_kind(w[0])[0] == "lap" for r in rows_all for w in r)
    if lap and (lap_times < 4 or not results):
        rows = [r for r in rows_all if token_kind(r[0][0])[0] == "int" and name_in(r[1:])]
        pairs = sorted(((tower_score(r, c), ri, ci) for ri, r in enumerate(rows) for ci, c in lap.items()), reverse=True)
    elif results:
        rows = [r for r in rows_all if any(token_kind(w[0])[0] in ("lap", "gap", "status") for w in r)]
        leader = next((c for c in results.values() if c["position"] == 1), None)
        pairs = sorted(((score(r, c, leader), ri, ci) for ri, r in enumerate(rows) for ci, c in results.items()),
                       reverse=True)
    else:
        return {}
    used_r, used_c, out = set(), set(), {}
    for s, ri, ci in pairs:
        if s < 6 or ri in used_r or ci in used_c:
            continue
        used_r.add(ri)
        used_c.add(ci)
        n = name_in(rows[ri][1:] if lap and token_kind(rows[ri][0][0])[0] == "int" else rows[ri])
        if n:
            out[ci] = n
    return out


def read_capture(payload):
    """Capture payload -> {"recording", "captured", "cars": {index: {...}}, "check": {...}}."""
    results = parse_results(base64.b64decode(payload["results"])) if payload.get("results") else {}
    parts = parse_participants(base64.b64decode(payload["participants"])) if payload.get("participants") else {}
    finish = parse_lap(base64.b64decode(payload["finish_lap"])) if payload.get("finish_lap") else {}
    votes = collections.defaultdict(collections.Counter)
    raw = collections.defaultdict(collections.Counter)
    for fr in payload.get("frames", []):
        lap = parse_lap(base64.b64decode(fr["lap"])) if fr.get("lap") else None
        for ci, n in match_frame(fr["words"], results, lap).items():
            votes[ci][norm(n)] += 1
            raw[(ci, norm(n))][n] += 1
    frames = len(payload.get("frames", []))
    cars, ok, checked = {}, 0, 0
    for ci in sorted(set(results) | set(finish) | set(votes)):
        c = results.get(ci) or finish.get(ci) or {}
        p = parts.get(ci, {})
        e = {"index": ci, "position": c.get("position"), "best_ms": c.get("best_ms"), "status": c.get("status"),
             "finish_position": finish.get(ci, {}).get("position"),
             "udp_name": p.get("name"), "hidden": p.get("hidden"), "ai": p.get("ai")}
        if votes[ci]:
            key, n = votes[ci].most_common(1)[0]
            e.update(ocr=raw[(ci, key)].most_common(1)[0][0], votes=n, seen=sum(votes[ci].values()))
            if p and not p["hidden"] and not p["ai"] and p["name"]:
                checked += 1
                ok += norm(p["name"]) == key
        cars[ci] = e
    return {"recording": payload.get("recording"), "captured": payload.get("captured"), "frames": frames,
            "finish_time": payload.get("finish_time"), "has_results": bool(results),
            "cars": cars, "check": {"named_cars": checked, "ocr_correct": ok}}


# ------------------------------------------------------------------ build step

def http_json(url):
    req = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        req.add_header("Authorization", f"Bearer {tok}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def main():
    args = sys.argv[1:]
    key_pem = os.environ.get("CLASSIFICATION_KEY", "").encode()
    if not key_pem and os.environ.get("CLASSIFICATION_KEY_B64"):
        import base64
        key_pem = base64.b64decode(os.environ["CLASSIFICATION_KEY_B64"])
    if "--key" in args:
        i = args.index("--key")
        key_pem = open(args[i + 1], "rb").read()
        del args[i:i + 2]
    if args and args[0] == "--file":
        print(json.dumps(read_capture(decrypt(open(args[1], "rb").read(), key_pem)), indent=1))
        return
    cache = args[0] if args else "/tmp/telemetry-cache"
    out = args[1] if len(args) > 1 else ".cache/classification.json"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    captures = []
    if not key_pem.strip():
        print("classification OCR: no CLASSIFICATION_KEY, hidden cars are not read from the screen")
    else:
        folder = os.path.join(cache, "classification")
        os.makedirs(folder, exist_ok=True)
        assets = {f for f in os.listdir(folder) if f.endswith(".gmcls")}
        try:
            assets.update(a["name"] for a in http_json(RELEASE)["assets"] if a["name"].endswith(".gmcls"))
        except Exception as ex:
            print("classification OCR: telemetry release not reachable; using local captures:", ex)
        assets = sorted(assets)
        for name in assets:
            done = os.path.join(folder, f"{name}.v{VERSION}.json")
            try:
                if not os.path.exists(done):
                    path = os.path.join(folder, name)
                    if not os.path.exists(path):
                        urllib.request.urlretrieve(DOWNLOAD + name, path)
                    cap = read_capture(decrypt(open(path, "rb").read(), key_pem))
                    cap["asset"] = name
                    json.dump(cap, open(done, "w"))
                cap = json.load(open(done))
                captures.append(cap)
                ck = cap["check"]
                read = sum(1 for c in cap["cars"].values() if c.get("ocr"))
                print(f"classification OCR {name}: {read}/{len(cap['cars'])} rows read from {cap['frames']} frames,"
                      f" named cars correct {ck['ocr_correct']}/{ck['named_cars']}")
            except Exception as ex:
                print(f"classification OCR {name}: skipped ({ex})")
    json.dump({"version": VERSION, "captures": captures}, open(out, "w"))


if __name__ == "__main__":
    main()
