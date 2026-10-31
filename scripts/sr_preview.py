#!/usr/bin/env python3
"""A private preview page of the new safety rating (SR_RULES=v1) next to the current one, for GreMi's
sign-off before it goes live. Not part of the site build.

    SR_RULES=v1 SR_OUT=/tmp/sr-v1 python3 scripts/safety_rating.py
    python3 scripts/sr_preview.py OLD_SAFETY.json /tmp/sr-v1/safety.json OUT.html
"""
import collections
import html
import json
import sys

old, new = (json.load(open(p)) for p in sys.argv[1:3])
was = {d["name"]: d for d in old["drivers"]}
rows = []
for d in new["drivers"]:
    races = sum(s["race"] for s in d["sessions"])
    if not races:
        continue
    contact = [i for s in d["sessions"] for i in s["items"] if i["cat"] == "contact" and i["pts"] < 0]
    limits = sum(-i["pts"] for s in d["sessions"] for i in s["items"] if i["cat"] == "penalty")
    plus = sum(i["pts"] for s in d["sessions"] for i in s["items"] if i["pts"] > 0)
    o = was.get(d["name"])
    rows.append({"name": d["name"], "sr": d["sr"], "old": o["sr"] if o else None, "races": races,
                 "faults": len(contact), "contact": -sum(i["pts"] for i in contact), "limits": limits, "plus": plus,
                 "prov": d["provisional"], "flags": d["flags"],
                 "list": [{"race": s["file"].rsplit("_2026", 1)[0].replace("Race_", "").replace("_", " "), "lap": i["lap"], "pts": i["pts"], "text": i["text"]}
                          for s in d["sessions"] for i in s["items"] if i["cat"] in ("contact", "penalty") and i["pts"] < 0]})
rows.sort(key=lambda r: (-r["sr"], r["name"].lower()))
rules = collections.Counter()
for d in new["drivers"]:
    for s in d["sessions"]:
        for i in s["items"]:
            if i["cat"] == "contact" and i["pts"] < 0:
                rules[i["text"].split("(")[1].split(")")[0] if "(" in i["text"] else "?"] += 1
dates = [s["date"] for s in new["streams"]]
data = {"rows": rows, "streams": dates, "unjudged": new.get("unjudged", []), "rules": rules.most_common()}

page = """<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Safety Rating v1 preview</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--fg:#15181d;--mute:#5f6671;--line:#dadde2;--up:#1f8a4c;--down:#c62828;--chip:#eceef2}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#181b21;--fg:#e8eaee;--mute:#9aa1ad;--line:#2b3039;--up:#3cc177;--down:#ff6b6b;--chip:#232730;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
.wrap{max-width:980px;margin:0 auto;padding:20px 16px 60px;display:grid;gap:16px}
h1{margin:0;font-size:1.7rem}.lead{color:var(--mute);margin:4px 0 0;max-width:75ch}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px}
.card h2{margin:0 0 8px;font-size:1.05rem}ul{margin:0;padding-left:20px}li{margin:2px 0}
table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
th,td{padding:6px 8px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}th{font-size:.78rem;color:var(--mute);font-weight:600;cursor:pointer;user-select:none}
tr.d{cursor:pointer}tr.d:hover{background:var(--chip)}.up{color:var(--up)}.down{color:var(--down)}.mute{color:var(--mute)}
.det td{white-space:normal;text-align:left;background:var(--chip);font-size:.85rem}.det div{margin:2px 0}
.tag{display:inline-block;font-size:.72rem;border:1px solid var(--line);border-radius:4px;padding:0 5px;color:var(--mute);margin-left:6px}
.scroll{overflow-x:auto}
</style></head><body><div class="wrap">
<header><h1>Safety Rating v1 · preview</h1>
<p class="lead">Not live. The SR stays hidden on the site until you sign this off. New SR next to the current (game-based) SR for every driver who raced since 19 Oct. Click a driver to see every penalty behind it.</p></header>
<div class="card"><h2>What changed</h2><ul>
<li>Only races from <b>19 Oct</b> count; everything before is gone from the SR (no all-car telemetry).</li>
<li><b>All contact blame comes from our fault engine</b> (rulebook v1). The game's collision calls and collision penalties are not used.</li>
<li>Game rules count only for <b>track limits</b> (corner cutting, pit exit line). Other game penalties and disqualifications no longer count.</li>
<li>At fault for a contact: <b>half its severity</b> (severity 1-10, so 0.5 to 5 points). Shared fault: both pay. Deliberate repeat hit (R9): <b>10</b>. Racing incident, aftermath, light tap, AI contact: 0.</li>
<li>Bonuses (finishing, clean laps, close racing, clean overtakes) and the SR scale are unchanged.</li>
</ul></div>
<div class="card"><h2>Drivers</h2><div class="scroll"><table id="t"><thead><tr>
<th data-k="name">Driver</th><th data-k="sr">New SR</th><th data-k="old">Current SR</th><th data-k="diff">Change</th><th data-k="races">Races</th>
<th data-k="faults">At fault</th><th data-k="contact">Contact pts</th><th data-k="limits">Track limits</th><th data-k="plus">Bonus</th></tr></thead><tbody></tbody></table></div></div>
<div class="card"><h2>Rules behind the contact penalties</h2><p class="mute" id="rules"></p><p class="mute" id="unj"></p></div>
</div>
<script>
const D=__DATA__;
const RN={R2:"alongside, moved across",R3:"from behind",R4:"small-error chain",R5:"rejoin",R7:"reaction time",R8:"shared",R9:"deliberate repeat"};
D.rows.forEach(r=>r.diff=r.old==null?null:r.sr-r.old);
let key="sr",dir=-1,open=new Set();
const f=v=>v==null?"–":(Math.round(v*10)/10).toString();
function draw(){const tb=document.querySelector("#t tbody");tb.textContent="";
const rs=[...D.rows].sort((a,b)=>{const x=a[key],y=b[key];if(typeof x==="string")return dir*x.localeCompare(y);return dir*((x??-1e9)-(y??-1e9))});
rs.forEach(r=>{const tr=document.createElement("tr");tr.className="d";
const c=r.diff==null?"":r.diff>0?"up":r.diff<0?"down":"";
tr.innerHTML=`<td>${esc(r.name)}${r.prov?'<span class="tag">provisional</span>':""}</td><td><b>${f(r.sr)}</b></td><td class="mute">${f(r.old)}</td><td class="${c}">${r.diff==null?"new":(r.diff>0?"+":"")+f(r.diff)}</td><td>${r.races}</td><td>${r.faults}</td><td>${r.contact?"-"+f(r.contact):"0"}</td><td>${r.limits?"-"+f(r.limits):"0"}</td><td>+${f(r.plus)}</td>`;
tr.onclick=()=>{open.has(r.name)?open.delete(r.name):open.add(r.name);draw()};tb.append(tr);
if(open.has(r.name)){const d=document.createElement("tr");d.className="det";const td=document.createElement("td");td.colSpan=9;
td.innerHTML=(r.list.length?r.list.map(i=>`<div><b>${f(i.pts)}</b> · ${esc(i.race)}${i.lap?" lap "+i.lap:""} · ${esc(i.text)}</div>`).join(""):"<div>No penalties.</div>")+(r.flags.length?`<div class="mute">Flags: ${r.flags.map(esc).join("; ")}</div>`:"");
d.append(td);tb.append(d)}})}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
document.querySelectorAll("th").forEach(th=>th.onclick=()=>{const k=th.dataset.k;dir=key===k?-dir:(k==="name"?1:-1);key=k;draw()});
document.getElementById("rules").textContent=D.rules.map(([k,n])=>`${k} ${RN[k]||""}: ${n}`).join(" · ");
document.getElementById("unj").textContent=`Streams: ${D.streams.join(", ")}.`+(D.unjudged.length?` Not judged (no race recording): ${D.unjudged.join(", ")}.`:"");
draw();
</script></body></html>"""
open(sys.argv[3], "w").write(page.replace("__DATA__", json.dumps(data, ensure_ascii=False).replace("</", "<\\/")))
print(f"{len(rows)} drivers -> {sys.argv[3]}")
