#!/usr/bin/env python3
"""Check the rulebook (verdicts.py) against GreMi's graded incidents.

    python3 scripts/telemetry/calibrate.py CACHE_DIR batch-01.json batch-02.json ...

CACHE_DIR holds the race recordings (*.gmtel.gz, downloaded when missing). The slow part
(parsing a recording and grouping its incidents) is kept in CACHE_DIR/judge/*.pkl, so
changing a rule and running again takes seconds. Prints one line per graded incident and the
match rate: verdict (who is at fault / racing incident / not an incident) and severity.
"""
import bisect
import json
import os
import pickle
import re
import sys
from concurrent.futures import ProcessPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import incident_replays  # noqa: E402
import verdicts  # noqa: E402

TRACKS = {"Sakhir": "Bahrain"}


def recording_for(item, names):
    """The race recording an item comes from (batch 2+ name it; batch 1 only has date and time)."""
    if item.get("telemetry"):
        return item["telemetry"]
    track = TRACKS.get(item["track"], item["track"]).replace(" ", "_")
    stamp = f"{item['date']}_{item['time'].replace(':', '-')}"
    cands = sorted(n for n in names if n.endswith(f"_{track}_Race.gmtel.gz") and n[:19] <= stamp and n.startswith(item["date"]))
    return cands[-1] if cands else None


def load(path, cache):
    """(incidents, Judge, driver names) for one recording, from the pickle when there is one."""
    pk = os.path.join(cache, "judge", os.path.basename(path) + ".pkl")
    if os.path.exists(pk) and os.path.getmtime(pk) > os.path.getmtime(path):
        with open(pk, "rb") as fh:
            return pickle.load(fh)
    sess, incs, j = verdicts.prepare(path)
    drivers = {i: dict(d) for i, d in sess.drivers.items()}
    j.race.s = None                       # the Judge needs positions, not the whole session
    j.race.inp, j.race.place = {}, {}
    os.makedirs(os.path.dirname(pk), exist_ok=True)
    with open(pk, "wb") as fh:
        pickle.dump((incs, j, drivers), fh, protocol=pickle.HIGHEST_PROTOCOL)
    return incs, j, drivers


def secs(mss):
    m, s = mss.split(":")
    return int(m) * 60 + int(s)


def cars_of(item):
    if "car_index" in item:
        return set(item["car_index"])
    return {d["car"] for d in item["drivers"]}


def find(incs, item):
    """The incident GreMi graded: the one around the item's race time sharing the most cars."""
    t, cars = secs(item["race_time"]), cars_of(item)
    best, score = None, None
    for k, inc in enumerate(incs):
        if inc["t0"] - 8 > t or inc["t1"] + 8 < t:
            continue
        shared = len(cars & {d["car"] for d in inc["drivers"]})
        s = (shared, -abs(inc["t0"] - t))
        if shared and (score is None or s > score):
            best, score = k, s
    return best


def norm(txt):
    return re.sub(r"[^a-z0-9#]", "", txt.lower())


def kind(verdict):
    v = verdict.lower()
    return "none" if v.startswith("not an incident") or v.startswith("not counted") else "racing" if v.startswith("racing") else "fault"


def who(grade, drivers, cars):
    """Cars GreMi blamed, matched by name (or race number for hidden names)."""
    out = set()
    for part in re.split(r"\s\+\s|,| and ", grade):
        p = norm(part.split("(")[0])
        num = re.search(r"#(\d+)", part)
        for c in cars:
            d = drivers.get(c) or {}
            nm = norm(d.get("name", ""))
            if (nm and len(nm) > 2 and (nm in p or p.endswith(nm))) or (num and "hidden" in part.lower() and str(d.get("race_number")) == num[1]):
                out.add(c)
    return out


def main():
    cache, batches = sys.argv[1], sys.argv[2:]
    items = [x for b in batches for x in json.load(open(b)) if x.get("grade") and x["grade"].get("verdict")]
    try:
        names = [a["name"] for a in incident_replays.http_json(incident_replays.RELEASE)["assets"]]
    except Exception:
        names = os.listdir(cache)
    rec = {x["id"]: recording_for(x, names) for x in items}
    paths = sorted({r for r in rec.values() if r})
    for p in paths:
        incident_replays.download(p, cache)
    with ProcessPoolExecutor(4) as ex:
        loaded = dict(zip(paths, ex.map(load, [os.path.join(cache, p) for p in paths], [cache] * len(paths))))
    ok_kind = ok_who = n = 0
    diffs = []
    for x in items:
        r = rec[x["id"]]
        if not r:
            print(f"{x['id']}: no recording"); continue
        incs, j, drivers = loaded[r]
        k = find(incs, x)
        if k is None:
            print(f"{x['id']}: incident not found in {r}"); continue
        name = lambda i: f"#{drivers[i]['race_number']} {drivers[i]['name']}" if i in drivers else f"car {i}"
        v = verdicts.judge_all(j, incs, name)[k]
        if "car_index" in x:   # batch 1 graded one pair of cars: take that pair's contact when there is one
            v = next((p for p in v["contacts"] if {p["a"], p["b"]} == set(x["car_index"])), v)
        g = x["grade"]
        cars = {d["car"] for d in incs[k]["drivers"]}
        gk, vk = kind(g["verdict"] if g.get("real_incident", True) or kind(g["verdict"]) != "fault" else "Not an incident"), kind(v["verdict"])
        if g.get("real_incident") is False:
            gk = "none"
        gk, vk = ("none" if k_ == "racing" else k_ for k_ in (gk, vk))   # both cost nobody points
        gw = who(g["verdict"], drivers, cars) if gk == "fault" else set()
        vw = set(v.get("at_fault_all") or ([v["at_fault"]] if v.get("at_fault") is not None else []))
        same_kind = gk == vk
        same = same_kind and (gk != "fault" or gw == vw)
        n += 1; ok_kind += same_kind; ok_who += same
        if gk != "none" and vk != "none":
            diffs.append(abs(g["severity"] - v["severity"]))
        print(f"{'OK ' if same else 'xx '}{x['id']} {x['track']:<11} GreMi: {g['verdict'][:34]:<34} sev {g['severity']:>2} | "
              f"v1 {v['rule']:<3} sev {v['severity']:>2} {v['verdict'][:40]:<40} {v['why'][:90]}")
    print(f"\n{ok_who}/{n} verdicts match ({ok_kind}/{n} same kind), severity mean abs diff "
          f"{sum(diffs) / len(diffs) if diffs else 0:.1f} over {len(diffs)} real incidents")


if __name__ == "__main__":
    main()
