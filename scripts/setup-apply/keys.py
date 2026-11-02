#!/usr/bin/env python3
"""Key presses for the Apply run (docs/setup-apply.md): saves the setup
versions that wait in setups/registry.json into F1 25 on GreMi's PC.

    python3 scripts/setup-apply/keys.py list            # what waits, in game order
    python3 scripts/setup-apply/keys.py plan OUT_DIR    # one JSON per computer_batch call
    python3 scripts/setup-apply/keys.py done TRACK KIND V [DATE]   # mark one as saved

The plan starts in a Time Trial garage (F1 2026, Red Bull) on any track, in
setup customise ("start.json" says how to get there from the main menu) and
ends there. Every call stays under 48 s of waiting. Calls named *_check.json
end on a zoom that must show what the file name says before the next call.
"""

import datetime
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
REGISTRY = os.path.join(ROOT, "setups", "registry.json")
KINDS = ["quali", "race", "wet"]
TABS = [["fw", "rw"], ["don", "doff"], ["fc", "rc", "ft", "rt"], ["fs", "rs", "farb", "rarb", "frh", "rrh"],
        ["bb", "bp"], ["fr", "fl", "rr", "rl"]]
STEP = dict(fw=1, rw=1, don=5, doff=5, fc=.1, rc=.1, ft=.01, rt=.01, fs=1, rs=1, farb=1, rarb=1, frh=1, rrh=1,
            bb=1, bp=1, fr=.1, fl=.1, rr=.1, rl=.1)
# The "Balanced" preset (Left x5, Right x3 in the preset row): the same on every track
BALANCED = dict(fw=25, rw=25, don=60, doff=50, fc=-3.5, rc=-2.0, ft=.04, rt=.15, fs=37, rs=16, farb=15, rarb=8,
                frh=25, rrh=52, bb=57, bp=97, fr=24.2, fl=24.2, rr=21.3, rl=21.3)
TRACK_ZOOM = [80, 165, 940, 195]
LIST_ZOOM = [60, 60, 1400, 520]


def k(t, s, r=None, w=0.2):
    a = {"action": "key", "text": t, "action_summary": s}
    if r and r > 1:
        a["repeat"] = r
    return [a, {"action": "wait", "duration": w}]


def edit(cur, tgt, tab):
    """Keys from values cur to tgt; tab = the tab we're on (-1 = fuel)."""
    out = []
    for ti, rows in enumerate(TABS):
        diffs = [round((tgt[x] - cur[x]) / STEP[x]) for x in rows]
        if not any(diffs):
            continue
        while tab < ti:
            out += k("f6", "Next tab", w=0.7)
            tab += 1
        while tab > ti:
            out += k("f5", "Previous tab", w=0.7)
            tab -= 1
        out += k("up", "Top row", r=8, w=0.3)
        last = max(i for i, d in enumerate(diffs) if d)
        for i, d in enumerate(diffs[:last + 1]):
            if i:
                out.append({"action": "key", "text": "down", "action_summary": "Next row"})
            if d:
                a = {"action": "key", "text": "right" if d > 0 else "left", "action_summary": "Adjusts slider"}
                if abs(d) > 1:
                    a["repeat"] = abs(d)
                out.append(a)
    return out, tab


def to_slot(slot):
    """F2 save list, highlight row `slot` (0 = top) and zoom on it."""
    out = k("f2", "Opens Save/Load", w=1.8) + k("down", "Down", w=0.3) + k("down", "Save car setup", w=0.3)
    out += k("return", "Opens save list", w=2.5)
    for c in [5] * (slot // 5) + ([slot % 5] if slot % 5 else []):
        out += k("down", "Moves down the list", r=c, w=0.4)
    out.append({"action": "zoom", "region": LIST_ZOOM, "scale": 0.35})
    return out


def switch(rights):
    """Garage (setup customise) -> another track via the pause menu, ending on
    the zoom of the track row (check the name, then send confirm.json)."""
    a = k("escape", "Leaves customisation", w=1.5) + k("escape", "Leaves Session Info", w=1.5)
    a += k("escape", "Opens pause menu", w=1.5)
    for _ in range(5):
        a += k("down", "Down", w=0.3)
    a += k("return", "Opens Car and Track Selection", w=3)
    for _ in range(abs(rights)):
        a += k("right" if rights > 0 else "left", "Changes track", w=0.7)
    a.append({"action": "zoom", "region": TRACK_ZOOM, "scale": 0.3})
    return a


CONFIRM = sum([k("down", "Down", w=0.3) for _ in range(5)], []) + k("return", "Confirms selection", w=22)
PRESET = (k("f1", "Opens Session Info", w=3) + k("f6", "Next tab", w=1)
          + k("f6", "Setup tab", w=1.5) + sum([k("left", "Preset left", w=0.5) for _ in range(5)], [])
          + sum([k("right", "Preset right", w=0.5) for _ in range(3)], [])
          + k("return", "Selects Balanced preset", w=1.5) + k("f3", "Customise", w=2))
GARAGE = k("return", "Advances past results", w=28) + PRESET


def pending(reg):
    out = []
    for t in sorted(reg["tracks"], key=lambda t: t["row"]):
        for kind in KINDS:
            vs = t["kinds"][kind]["versions"]
            if not vs[-1].get("saved"):
                old = next(v for v in reversed(vs) if v.get("saved"))
                out.append((t, kind, vs[-1], old))
    return out


def plan(reg, out_dir, row=0):
    """row: the track the game is on now (its "row" in the registry), in the
    garage before Session Info is opened."""
    os.makedirs(out_dir, exist_ok=True)
    n = 0
    files = []

    def put(name, actions):
        nonlocal n
        n += 1
        path = os.path.join(out_dir, f"{n:03d}_{name}.json")
        json.dump(actions, open(path, "w"), separators=(",", ":"))
        files.append(os.path.basename(path))

    put("open_setup_balanced", PRESET)
    cur, tab = BALANCED, -1
    for t, kind, new, old in pending(reg):
        tag = f"{t['name'].replace(' ', '-')}-{kind}-V{new['v']}"
        if t["row"] != row:
            put(f"switch_check_track-is-{t['name'].replace(' ', '-')}", switch(t["row"] - row))
            put("confirm", CONFIRM)
            put("results_and_balanced_preset", GARAGE)
            cur, tab, row = BALANCED, -1, t["row"]
        keys, tab = edit(cur, new["values"], tab)
        cur = new["values"]
        if keys:
            put(f"edit_{tag}", keys)
        put(f"savelist_check_row-is-{t['name'].replace(' ', '-')}-{kind.upper()}-V{old['v']}", to_slot(old["slot"]))
    return files


def main():
    reg = json.load(open(REGISTRY))
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    if cmd == "list":
        for t, kind, new, old in pending(reg):
            print(f"{t['name']} - {kind.upper()} - V{new['v']}  (replaces V{old['v']} in row {old['slot']}): {new['text']}")
    elif cmd == "plan":
        start_row = int(sys.argv[3]) if len(sys.argv) > 3 else 0
        for f in plan(reg, sys.argv[2], start_row):
            print(f)
    elif cmd == "done":
        track, kind, v = sys.argv[2].upper(), sys.argv[3].lower(), int(sys.argv[4])
        date = sys.argv[5] if len(sys.argv) > 5 else datetime.date.today().isoformat()
        t = next(t for t in reg["tracks"] if t["name"] == track)
        vs = t["kinds"][kind]["versions"]
        new = next(x for x in vs if x["v"] == v)
        old = next(x for x in reversed(vs) if x.get("saved") and x["v"] != v)
        new.update(saved=date, slot=old["slot"])
        reg["pending"] = len(pending(reg))
        reg["apply"]["last"] = date
        if not reg["pending"]:
            reg["apply"]["requested"] = None
        with open(REGISTRY, "w") as f:
            json.dump(reg, f, indent=1, ensure_ascii=False)
            f.write("\n")
        print(f"{track} - {kind.upper()} - V{v} saved; {reg['pending']} still waiting")


if __name__ == "__main__":
    main()
