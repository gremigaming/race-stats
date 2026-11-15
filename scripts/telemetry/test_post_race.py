"""Made-up after-race screens for ClassificationCapture.ps1 -PostImage (recorder-check.yml).

    python test_post_race.py render DIR   -> DIR/menu-save.png, menu-advance.png, table.png, saved.png, awards.png
    python test_post_race.py check NAME "OUTPUT LINE"
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

EXPECT = {"menu-save": "menu save full race replay", "menu-advance": "menu advance",
          "table": "table", "saved": "saved", "awards": "awards", "xp": "xp"}


def font(size):
    for f in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf"):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            pass
    return ImageFont.load_default()


def table(d):
    d.text((80, 60), "RESULTS (OVERALL)", fill=(255, 255, 255), font=font(48))
    d.text((80, 150), "POS    DRIVER                 TEAM          BEST          TIME          PTS", fill=(200, 200, 200), font=font(26))
    for i in range(10):
        y = 200 + i * 52
        d.text((80, y), f"{i + 1:>2}     DRIVER {i + 1:<12}  TEAM {i % 5}       1:3{i}.{100 + i * 7:03d}     +{i}.{200 + i:03d}     {25 - i}",
               fill=(255, 255, 255), font=font(30))


def render(folder):
    os.makedirs(folder, exist_ok=True)
    big = font(40)
    for name, sel in (("menu-save", 1), ("menu-advance", 0)):
        im = Image.new("RGB", (1920, 1080), (18, 18, 28))
        d = ImageDraw.Draw(im)
        table(d)
        items = ["Advance", "Save Full Race Replay", "View Replay", "Race Director"]
        for i, t in enumerate(items):
            y = 640 + i * 90
            if i == sel:
                d.rectangle((1300, y - 18, 1860, y + 62), fill=(235, 235, 235))
            d.text((1340, y), t, fill=(20, 20, 20) if i == sel else (255, 255, 255), font=big)
        im.save(os.path.join(folder, f"{name}.png"))
    im = Image.new("RGB", (1920, 1080), (18, 18, 28))
    d = ImageDraw.Draw(im)
    table(d)
    d.text((1500, 1000), "Advance", fill=(255, 255, 255), font=big)
    im.save(os.path.join(folder, "table.png"))
    im = Image.new("RGB", (1920, 1080), (18, 18, 28))
    d = ImageDraw.Draw(im)
    d.text((620, 480), "FULL RACE REPLAY SAVED", fill=(255, 255, 255), font=font(56))
    d.text((900, 600), "Okay", fill=(255, 255, 255), font=big)
    im.save(os.path.join(folder, "saved.png"))
    im = Image.new("RGB", (1920, 1080), (18, 18, 28))
    d = ImageDraw.Draw(im)
    # like F1 25 online (14 Nov 2026): only the buttons and "FASTEST LAP" read reliably
    for i, t in enumerate(["RACE WINNER", "FASTEST LAP"]):
        d.text((320 + i * 350, 220), t, fill=(255, 255, 255), font=font(40))
    d.text((330, 680), "ADD AS EA FRIEND", fill=(255, 255, 255), font=font(28))
    d.text((1700, 1030), "Continue", fill=(255, 255, 255), font=font(28))
    im.save(os.path.join(folder, "awards.png"))
    im = Image.new("RGB", (1920, 1080), (18, 18, 28))
    d = ImageDraw.Draw(im)
    d.text((120, 120), "PODIUM PASS", fill=(255, 255, 255), font=font(56))
    d.text((120, 260), "+1,250 XP", fill=(255, 255, 255), font=font(40))
    d.text((1500, 1000), "Advance", fill=(255, 255, 255), font=big)
    d.text((120, 1000), "Ends 0:28", fill=(255, 255, 255), font=big)
    im.save(os.path.join(folder, "xp.png"))


def dryrun(folder):
    """The online after-race flow as a picture per key press, for -PostDryRun."""
    tmp = os.path.join(folder, "_src")
    render(tmp)
    im = Image.open(os.path.join(tmp, "table.png")).copy()
    d = ImageDraw.Draw(im)
    d.rectangle((560, 300, 1360, 700), fill=(10, 10, 60))
    d.text((760, 360), "WINNER", fill=(255, 255, 255), font=font(64))
    d.text((700, 480), "DRIVER 1", fill=(255, 255, 255), font=font(48))
    im.save(os.path.join(tmp, "popup.png"))
    order = ["xp", "awards", "popup", "table", "menu-advance", "menu-save", "saved"]
    for i, n in enumerate(order):
        Image.open(os.path.join(tmp, f"{n}.png")).save(os.path.join(folder, f"{i + 1:02d}-{n}.png"))


def check_dry(text):
    want = "keys: enter (background), enter, enter, enter, down, enter, enter"
    if want not in text or "replay saved" not in text:
        sys.exit(f"dry run: expected '{want}' and 'replay saved', got:\n{text}")
    print("dry run: ok")


def check(name, line):
    want = EXPECT[name]
    got = line.split(":")[0].strip().lower()
    if got != want:
        sys.exit(f"{name}: expected '{want}', got '{line}'")
    print(f"{name}: ok ({got})")


if __name__ == "__main__":
    if sys.argv[1] == "render":
        render(sys.argv[2])
    elif sys.argv[1] == "dryrun":
        dryrun(sys.argv[2])
    elif sys.argv[1] == "check-dry":
        check_dry(open(sys.argv[2], encoding="utf-8-sig", errors="replace").read())
    else:
        check(sys.argv[2], sys.argv[3])
