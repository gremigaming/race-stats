"""Made-up after-race screens for ClassificationCapture.ps1 -PostImage (recorder-check.yml).

    python test_post_race.py render DIR   -> DIR/menu-save.png, menu-advance.png, table.png, saved.png, awards.png
    python test_post_race.py check NAME "OUTPUT LINE"
"""
import os
import sys

from PIL import Image, ImageDraw, ImageFont

EXPECT = {"menu-save": "menu save full race replay", "menu-advance": "menu advance",
          "table": "table", "saved": "saved", "awards": "awards"}


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
    for i, t in enumerate(["RACE WINNER", "FASTEST LAP", "DRIVER OF THE DAY", "MOST OVERTAKES", "CLEANEST DRIVER"]):
        d.text((120 + i * 350, 400), t, fill=(255, 255, 255), font=font(32))
    im.save(os.path.join(folder, "awards.png"))


def check(name, line):
    want = EXPECT[name]
    got = line.split(":")[0].strip().lower()
    if got != want:
        sys.exit(f"{name}: expected '{want}', got '{line}'")
    print(f"{name}: ok ({got})")


if __name__ == "__main__":
    if sys.argv[1] == "render":
        render(sys.argv[2])
    else:
        check(sys.argv[2], sys.argv[3])
