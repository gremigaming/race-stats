"""Build check: every safety rating / staff incident must open the same incident in the incident viewer.

GreMi, 16 Nov 2026: "make sure the incidents always match everywhere". An incident is known by its race
viewer link (league/incidents.json `watch`, the SR items' `watch`, the staff page's links are made from the
same field): /race/<recording>?inc=<contact time>&car=<car slots>. The incident viewer resolves that link
with pickIncident() in src/components/incidents/data.ts; this script does exactly the same on the bundles
race_bundles.py wrote, so a race the viewer cannot find (Bahrain 15 Nov: race file "Sakhir", recording
"Bahrain") or a contact no viewer incident covers shows up in the build log instead of on the site.

    python3 scripts/telemetry/check_incident_links.py [--league public/league] [--strict]

Writes <league>/link-check.json and a summary (GitHub step summary + ::warning lines). --strict: exit 1
when a race the viewer has holds an incident it cannot open.
"""

import argparse
import json
import os
import re
import sys
import urllib.parse

WINDOW = 3.0    # s: same as pickIncident


def link_parts(link):
    """(recording, contact time, car slots) of a race viewer link, or None."""
    m = re.search(r"/race/([^/?#]+)\?(.*)$", link or "")
    if not m:
        return None
    q = urllib.parse.parse_qs(m.group(2))
    try:
        t = float(q["inc"][0])
    except (KeyError, ValueError):
        return None
    cars = [int(x) for x in (q.get("car") or [""])[0].split(",") if x.strip().isdigit()]
    return urllib.parse.unquote(m.group(1)), t, cars


def chunk_start(m):
    ks = [int(n.split(".")[0]) for n in m.get("chunks") or [] if n.split(".")[0].isdigit()]
    return min(ks) * (m.get("chunk_seconds") or 10) if ks else 0


def cars_of(inc):
    out = []
    for c in inc.get("contacts") or []:
        for x in (c.get("a"), c.get("b")):
            if x is not None and x not in out:
                out.append(x)
    for d in inc.get("drivers") or []:
        if d.get("car") is not None and d["car"] not in out:
            out.append(d["car"])
    return out


def pick(incidents, t, cs, slots):
    """The viewer's pickIncident: within 3 s (inside the incident = 0), most shared car slots, closest start."""
    best, best_s = None, float("inf")
    for i, inc in enumerate(incidents):
        t0, t1 = inc["t0"], inc.get("t1", inc["t0"])
        d = min(max(0, t0 - x, x - t1) for x in (t, t + cs))
        if d >= WINDOW:
            continue
        ov = len([c for c in cars_of(inc) if c in slots])
        s = d - ov * 10 + min(abs(x - t0) for x in (t, t + cs)) * 0.01
        if s < best_s:
            best, best_s = (i, ov), s
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--league", default=os.path.join("public", "league"))
    ap.add_argument("--strict", action="store_true")
    a = ap.parse_args()
    races_dir = os.path.join(a.league, "races")
    try:
        bundles = {r["uid"]: r for r in json.load(open(os.path.join(races_dir, "index.json")))["races"]}
    except (OSError, ValueError, KeyError):
        print("link check: no race bundles this build, nothing to check")
        return 0
    links = []   # (where, file, lap, names, link)
    try:
        for c in json.load(open(os.path.join(a.league, "incidents.json")))["incidents"]:
            links.append(("incidents.json", c.get("file"), c.get("lap"), c.get("names") or [], c.get("watch")))
    except (OSError, ValueError, KeyError) as ex:
        print("link check: league/incidents.json unreadable:", ex)
    try:
        for d in json.load(open(os.path.join(a.league, "safety.json")))["drivers"]:
            for s in d.get("sessions") or []:
                for it in s.get("items") or []:
                    if it.get("cat") in ("contact", "staff") and (it.get("watch") or it.get("cat") == "contact"):
                        links.append(("safety.json", s.get("file"), it.get("lap"), [d.get("name")], it.get("watch")))
    except (OSError, ValueError, KeyError) as ex:
        print("link check: league/safety.json unreadable:", ex)

    manifests = {}

    def manifest(rid):
        if rid not in manifests:
            try:
                manifests[rid] = json.load(open(os.path.join(races_dir, rid, "manifest.json")))
            except (OSError, ValueError):
                manifests[rid] = None
        return manifests[rid]

    ok, no_link, no_race, no_incident, wrong_cars = 0, [], {}, [], []
    seen = set()
    for where, file, lap, names, link in links:
        parts = link_parts(link)
        if not parts:
            no_link.append({"in": where, "file": file, "lap": lap, "names": names})
            continue
        rid, t, slots = parts
        key = (where, rid, round(t, 1), tuple(slots), tuple(names))
        if key in seen:
            continue
        seen.add(key)
        m = manifest(rid) if rid in bundles else None
        if not m:
            no_race.setdefault(rid, {"file": file, "links": 0})["links"] += 1
            continue
        got = pick(m.get("incidents") or [], t, chunk_start(m), slots)
        if not got:
            no_incident.append({"in": where, "race": rid, "file": file, "lap": lap, "names": names, "at": t, "cars": slots})
        elif slots and got[1] < min(2, len(slots)):
            wrong_cars.append({"in": where, "race": rid, "file": file, "lap": lap, "names": names, "at": t, "cars": slots,
                               "opens": cars_of(m["incidents"][got[0]])})
        else:
            ok += 1
    report = {"ok": ok, "no_link": no_link, "race_not_in_viewer": no_race, "no_incident": no_incident,
              "other_cars": wrong_cars}
    with open(os.path.join(a.league, "link-check.json"), "w") as f:
        json.dump(report, f, indent=1)

    bad = len(no_incident) + len(wrong_cars)
    lines = [f"Incident links: {ok} open the right incident, {bad} do not, "
             f"{len(no_race)} race(s) not in the viewer, {len(no_link)} without a race viewer link."]
    for x in no_incident[:30]:
        lines.append(f"- no viewer incident near {x['at']:.1f} s: {x['file']} lap {x['lap']} {' / '.join(map(str, x['names']))} ({x['in']})")
    for x in wrong_cars[:30]:
        lines.append(f"- opens other cars {x['opens']} instead of {x['cars']}: {x['file']} lap {x['lap']} ({x['in']})")
    for rid, x in sorted(no_race.items())[:40]:
        lines.append(f"- race not in the viewer: {rid} ({x['file']}, {x['links']} links)")
    print("\n".join(lines))
    for x in no_incident + wrong_cars:
        print(f"::warning title=Incident link::{x['file']} lap {x['lap']} {' / '.join(map(str, x['names']))} does not open in the incident viewer")
    if no_race:
        print(f"::warning title=Incident links::{len(no_race)} race(s) with SR incidents have no replay in the incident viewer")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("### Incident links\n\n" + "\n".join(lines) + "\n")
    return 1 if a.strict and bad else 0


if __name__ == "__main__":
    sys.exit(main())
