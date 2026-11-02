#!/usr/bin/env python3
"""Checks for classification_ocr.py.

    python3 scripts/telemetry/test_classification_ocr.py
        parser checks on made-up OCR words (no OCR engine needed)
    python3 scripts/telemetry/test_classification_ocr.py render DIR
        (recorder-check.yml, Windows) draws a made-up classification screen to
        DIR/screen.png, its packets to DIR/packets.json and a test key pair
    python3 scripts/telemetry/test_classification_ocr.py check DIR
        reads the .gmcls that ClassificationCapture.ps1 made from that screen
"""

import base64
import glob
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classification_ocr as co  # noqa: E402

# position, name on screen, name in the game's data, hidden, team, best ms, total s, laps, status
FIELD = [
    (1, "ApexHunter", "ApexHunter", False, "McLaren", 90061, 1801.234, 20, 3),
    (2, "Kerb_Rider", "Player", True, "Ferrari", 90412, 1804.567, 20, 3),
    (3, "SlipStream2396", "SlipStream2396", False, "Mercedes", 90103, 1809.001, 20, 3),
    (4, "TTV/Host_Car", "TTV/Host_Car", False, "Red Bull Racing", 90777, 1815.5, 20, 3),
    (5, "Ghost_0815", "Player", True, "Aston Martin", 91002, 1830.25, 20, 3),
    (6, "Pitwall", "Pitwall", False, "Williams", 91500, 1790.0, 19, 3),
    (7, "Late_Braker", "Player", True, "Haas", 92011, 900.0, 10, 4),
]


def header(pid):
    return struct.pack("<HBBBBBQfIIBB", 2025, 25, 1, 0, 1, pid, 0xABCDEF, 100.0, 1, 1, 0, 255)


def packets(field=FIELD):
    res, par = bytearray([len(field)]), bytearray([len(field)])
    for i in range(22):
        if i < len(field):
            pos, _, name, hidden, _, best, total, laps, status = field[i]
            r = struct.pack("<7BIdBB", pos, laps, pos, 0, 0, status, 0, best, total, 0, 0) + bytes(25)
            p = bytes([0, 255, i, 0, 0, 10 + i, 1]) + name.encode().ljust(32, b"\0") + bytes([1, 0 if hidden else 1]) + bytes(16)
        else:
            r, p = bytes(46), bytes(57)
        res += r[:46]
        par += p[:57]
    return header(8) + bytes(res), header(4) + bytes(par)


def fmt_lap(ms):
    return f"{ms // 60000}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"


def screen_rows(field=FIELD):
    """Text per row as the classification screen shows it."""
    lead = field[0]
    out = []
    for pos, shown, _, _, team, best, total, laps, status in field:
        if status == 4:
            t = "DNF"
        elif pos == 1:
            t = fmt_lap(int(total * 1000))
        elif laps < lead[7]:
            t = f"+{lead[7] - laps} Lap"
        else:
            t = f"+{total - lead[6]:.3f}"
        out.append([str(pos), shown, team, fmt_lap(best), t])
    return out


def words(rows, y0=200, misread=None):
    xs = [100, 160, 520, 820, 1000]
    ws = []
    for i, row in enumerate(rows):
        y = y0 + i * 42
        for x, text in zip(xs, row):
            parts = text.split(" ")
            cx = x
            for t in parts:
                if misread and (i, t) in misread:
                    t = misread[(i, t)]
                w = 11 * len(t)
                ws.append([t, cx, y + (i % 2), w, 20])
                cx += w + 8
    ws += [["POS", 100, 150, 30, 20], ["DRIVER", 160, 150, 60, 20], ["BEST", 820, 150, 40, 20], ["TIME", 1000, 150, 40, 20]]
    return ws


def payload(frames):
    res, par = packets()
    return {"recording": "test", "captured": "2026-11-02T20:00:00", "results": base64.b64encode(res).decode(),
            "participants": base64.b64encode(par).decode(), "frames": [{"words": f} for f in frames]}


def expect(cap, allow_missing=()):
    bad = []
    for i, row in enumerate(FIELD):
        c = cap["cars"][i]
        if co.norm(c.get("ocr") or "") != co.norm(row[1]) and row[1] not in allow_missing:
            bad.append(f"car {i}: wanted {row[1]!r}, read {c.get('ocr')!r}")
    return bad


def test_parser():
    rows = screen_rows()
    clean = words(rows)
    # OCR slips: O for 0 in a lap time, l for 1 in a gap, a split gamertag, a row read twice as wide
    noisy = words(rows, y0=230, misread={(1, "1:30.412"): "1:3O.412", (2, "+7.767"): "+7.767", (4, "+29.016"): "+29.0l6"})
    noisy = [w for w in noisy if w[0] != "SlipStream2396"] + [["SlipStream", 160, 230 + 2 * 42, 121, 20], ["2396", 283, 230 + 2 * 42, 44, 20]]
    # one frame where the screen was half drawn: only the top three rows
    partial = words(rows[:3], y0=180)
    # a wrong frame (podium screen) with no times at all
    junk = [["CONGRATULATIONS", 600, 100, 300, 40], ["ApexHunter", 600, 200, 120, 30]]
    alone = co.read_capture(payload([noisy]))
    assert not expect(alone), expect(alone)
    cap = co.read_capture(payload([clean, noisy, partial, junk]))
    bad = expect(cap)
    assert not bad, bad
    assert cap["check"] == {"named_cars": 4, "ocr_correct": 4}, cap["check"]
    assert cap["cars"][1]["hidden"] and cap["cars"][1]["votes"] >= 2
    # rows shuffled (another screen layout keeps the same anchors)
    shuffled = words([rows[i] for i in (3, 0, 6, 1, 5, 2, 4)])
    by_pos = co.read_capture(payload([shuffled]))
    assert not expect(by_pos), expect(by_pos)
    print("parser: ok")


def test_tokens():
    assert co.token_kind("1:30.061") == ("lap", 90061)
    assert co.token_kind("1:3O.O61") == ("lap", 90061)
    assert co.token_kind("+3.333") == ("gap", 3.333)
    assert co.token_kind("+1") == ("laps", 1)
    assert co.token_kind("DNF") == ("status", "dnf")
    assert co.token_kind("GreMi") == ("text", None)
    assert co.is_team("Red Bull Racing") and not co.is_team("ApexHunter")
    print("tokens: ok")


def test_crypto():
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    data = json.dumps({"hello": "world"}).encode()
    assert co.decrypt(encrypt_like_dotnet(data, key.public_key()), pem) == {"hello": "world"}
    print("crypto: ok")


def encrypt_like_dotnet(data, pub):
    """What ClassificationCapture.ps1 does, for the round trip test."""
    import hashlib
    import hmac
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    aes, mac, iv = os.urandom(32), os.urandom(32), os.urandom(16)
    wrapped = pub.encrypt(aes + mac, padding.OAEP(mgf=padding.MGF1(hashes.SHA1()), algorithm=hashes.SHA1(), label=None))
    pad = 16 - len(data) % 16
    e = Cipher(algorithms.AES(aes), modes.CBC(iv)).encryptor()
    ct = e.update(data + bytes([pad]) * pad) + e.finalize()
    return co.MAGIC + struct.pack("<H", len(wrapped)) + wrapped + iv + ct + hmac.new(mac, iv + ct, hashlib.sha256).digest()


# ------------------------------------------------------------------ Windows end-to-end

def render(folder):
    """A dark classification screen at 1920x1080, white text, the player's row highlighted."""
    from PIL import Image, ImageDraw, ImageFont
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    os.makedirs(folder, exist_ok=True)
    img = Image.new("RGB", (1920, 1080), (18, 18, 28))
    d = ImageDraw.Draw(img)
    font = None
    for f in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/segoeuib.ttf", "DejaVuSans-Bold.ttf"):
        try:
            font = ImageFont.truetype(f, 26)
            break
        except OSError:
            pass
    d.text((360, 120), "FINAL CLASSIFICATION", fill=(255, 255, 255), font=font)
    xs = [360, 440, 860, 1160, 1400]
    for i, row in enumerate(screen_rows()):
        y = 220 + i * 56
        if i == 3:
            d.rectangle((340, y - 10, 1600, y + 40), fill=(225, 6, 0))
        else:
            d.rectangle((340, y - 10, 1600, y + 40), fill=(32, 32, 46))
        for x, t in zip(xs, row):
            d.text((x, y), t, fill=(255, 255, 255), font=font)
    img.save(os.path.join(folder, "screen.png"))
    res, par = packets()
    json.dump({"results": base64.b64encode(res).decode(), "participants": base64.b64encode(par).decode()},
              open(os.path.join(folder, "packets.json"), "w"))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    open(os.path.join(folder, "key.pem"), "wb").write(
        key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    n = key.public_key().public_numbers()
    b64 = lambda v: base64.b64encode(v.to_bytes((v.bit_length() + 7) // 8, "big")).decode()
    open(os.path.join(folder, "public.xml"), "w").write(
        f"<RSAKeyValue><Modulus>{b64(n.n)}</Modulus><Exponent>{b64(n.e)}</Exponent></RSAKeyValue>")
    print("rendered", folder)


def check(folder):
    files = glob.glob(os.path.join(folder, "out", "*.gmcls"))
    assert files, "no .gmcls written"
    payload = co.decrypt(open(files[0], "rb").read(), open(os.path.join(folder, "key.pem"), "rb").read())
    print("frames:", len(payload["frames"]), "words in the first:", len(payload["frames"][0]["words"]) if payload["frames"] else 0)
    if payload["frames"]:
        print("first frame words:", [w[0] for w in payload["frames"][0]["words"]][:60])
    cap = co.read_capture(payload)
    for c in cap["cars"].values():
        print(c["position"], c.get("ocr"), c.get("votes"), "/", c.get("seen"))
    bad = expect(cap)
    print("check:", cap["check"], "problems:", bad or "none")
    assert not bad, bad


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "render":
        render(sys.argv[2])
    elif len(sys.argv) > 2 and sys.argv[1] == "check":
        check(sys.argv[2])
    else:
        test_tokens()
        test_parser()
        test_crypto()
