// Reads the live league data (same source as the race-stats site) for the OBS overlays.
// Falls back to the site's own copy on GitHub Pages when the live publisher is unavailable.
const LIVE = "https://replays.gremigaming.com/league/";
const PAGES = new URL("../../league/", location.href).href;
export const ME = (new URLSearchParams(location.search).get("driver") || "ttv/gremi_gaming").toLowerCase();

const enc = (p) => p.split("/").map(encodeURIComponent).join("/");

export async function loadIndex() {
  for (const base of [LIVE, PAGES]) {
    try {
      const r = await fetch(`${base}index.json?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) continue;
      const index = await r.json();
      if (Array.isArray(index.files) && index.files.length) return { index, base };
    } catch { /* try the next source */ }
  }
  throw new Error("No league index");
}

export async function loadSession(src, file) {
  const mapped = src.base === LIVE ? src.index.sessionFiles?.[file] : null;
  const url = mapped ? LIVE + enc(mapped) : `${src.base}sessions/${enc(file)}?t=${Date.now()}`;
  const r = await fetch(url, { cache: mapped ? "force-cache" : "no-store" });
  if (!r.ok) throw new Error("Session missing");
  return r.json();
}

// "Race_Suzuka_2026_11_06_23_06_32.json" -> { kind, track, date, time }
export function parseName(file) {
  const m = file.match(/^(.*?)_(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.json$/);
  if (!m) return null;
  const head = m[1];
  const kind = head.startsWith("Race") ? "race" : head.includes("Qualifying") ? "quali" : "other";
  const track = head.replace(/^(Race_2|Race|One_Shot_Qualifying|Qualifying)_/, "").replace(/_Just_in_case$/, "").replace(/_/g, " ");
  // Sessions after midnight still belong to the evening before (cut-off 06:00).
  const d = new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6]);
  const night = new Date(d.getTime() - 6 * 3600e3);
  return { kind, track, date: d, night: night.toDateString(), stamp: `${m[2]}${m[3]}${m[4]}${m[5]}${m[6]}${m[7]}` };
}

export function races(index) {
  return index.files.map((f) => ({ file: f, ...parseName(f) })).filter((x) => x.kind === "race").sort((a, b) => b.stamp.localeCompare(a.stamp));
}

export function classification(session) {
  return (session["classification-data"] || [])
    .map((c) => ({
      name: c["driver-name"],
      team: String(c.team || "").replace(/ '\d\d$/, ""),
      pos: c["final-classification"]?.position ?? c["track-position"],
      // Files saved before the flag (no final classification) still have the lap history.
      best: c["final-classification"]?.["best-lap-time-str"]
        || c["session-history"]?.["lap-history-data"]?.[(c["session-history"]["best-lap-time-lap-num"] || 0) - 1]?.["lap-time-str"] || "",
      status: c["final-classification"]?.["result-status"] || "",
      points: c["final-classification"]?.points ?? 0,
    }))
    .filter((c) => c.pos)
    .sort((a, b) => a.pos - b.pos);
}

export const isMe = (name) => String(name || "").toLowerCase() === ME;

const TEAM = { mercedes: "#27f4d2", ferrari: "#e8002d", "red bull racing": "#3671c6", "red bull": "#3671c6", mclaren: "#ff8000",
  "aston martin": "#229971", alpine: "#ff87bc", williams: "#64c4ff", rb: "#6c98ff", "racing bulls": "#6c98ff", haas: "#b6babd",
  sauber: "#52e252", "kick sauber": "#52e252", audi: "#bb0a30", cadillac: "#c8b37a" };
export const teamColor = (t) => TEAM[String(t).toLowerCase()] || "#888";

export const fmtLap = (s) => String(s || "").replace(/^0(\d:)/, "$1").replace(/^00:/, "");

// Re-run fn every `sec` seconds, only re-rendering when the data generation changes.
export function poll(fn, sec = 15) {
  let last = "";
  const tick = async () => {
    try {
      const src = await loadIndex();
      const gen = src.index.generation || src.index.files[0];
      if (gen !== last) { last = gen; await fn(src); }
    } catch (e) { console.warn(e); }
    setTimeout(tick, sec * 1000);
  };
  tick();
}

// Everything the results overlays show about one race, from a session file.
export function raceStats(s) {
  const cls = s["classification-data"] || [];
  const nameOf = (i) => cls.find((c) => c.index === i)?.["driver-name"] || "";
  const rows = classification(s).map((c) => {
    const raw = cls.find((x) => x["driver-name"] === c.name) || {};
    const f = raw["final-classification"] || {};
    return { ...c, grid: f["grid-position"] || 0, laps: f["num-laps"] || 0, time: (f["total-race-time"] || 0) + (f["penalties-time"] || 0),
      pen: f["penalties-time"] || 0, pens: f["num-penalties"] || 0, stints: f["tyre-stints-visual"] || [], top: raw["top-speed-kmph"] || 0 };
  });
  const out = (r) => r.status && !/FINISHED/i.test(r.status);
  const win = rows.find((r) => r.pos === 1);
  for (const r of rows) {
    r.gained = r.grid && !out(r) ? r.grid - r.pos : null;
    if (out(r)) r.gap = r.status.replace(/DID_NOT_FINISH/, "DNF").replace(/DISQUALIFIED/, "DSQ").replace(/NOT_CLASSIFIED/, "NC").replace(/_/g, " ");
    else if (r === win || !win) r.gap = fmtRace(r.time);
    else if (win.laps > r.laps) r.gap = `+${win.laps - r.laps} lap${win.laps - r.laps > 1 ? "s" : ""}`;
    else r.gap = `+${(r.time - win.time).toFixed(3)}`;
  }
  const count = (list) => list.reduce((m, n) => m.set(n, (m.get(n) || 0) + 1), new Map());
  const ot = s.overtakes?.records || [];
  const made = count(ot.map((o) => o["overtaking-driver-name"]));
  const lost = count(ot.map((o) => o["overtaken-driver-name"]));
  const rc = s["race-control"] || [];
  // A contact is reported once per car pair; the same pair within 2 s is one contact.
  const contacts = [];
  for (const m of rc.filter((m) => m["message-type"] === "COLLISION")) {
    const key = [...(m["involved-drivers"] || [])].sort().join("-");
    if (!contacts.some((c) => c.key === key && Math.abs(c.t - m.timestamp) < 2)) contacts.push({ key, t: m.timestamp, cars: m["involved-drivers"] || [] });
  }
  const warnings = count(rc.filter((m) => m["message-type"] === "PENALTY" && /warning/i.test(m["penalty-type"] || "")).map((m) => nameOf(m["vehicle-index"])));
  const traps = (s["speed-trap-records"] || []).map((t) => ({ name: t.name, kmh: t["speed-trap-record-kmph"] })).sort((a, b) => b.kmh - a.kmh);
  const top = (m) => [...m].filter(([n]) => n).sort((a, b) => b[1] - a[1])[0] || null;
  const fast = s.records?.fastest || {};
  const rec = (k) => fast[k] ? { name: fast[k]["driver-name"], time: fmtLap(fast[k]["time-str"]), ms: fast[k].time, lap: fast[k]["lap-number"] } : null;
  const climber = rows.filter((r) => r.gained > 0).sort((a, b) => b.gained - a.gained)[0] || null;
  const hist = (s["position-history"] || []).map((p) => ({ name: p.name, team: String(p.team || "").replace(/ '\d\d$/, ""),
    pts: (p["driver-position-history"] || []).map((x) => [x["lap-number"], x.position]) }));
  // Per driver extras for the awards: contacts, warnings, lap 1 gain, lap consistency, last lap, tyre wear.
  const wear = {};
  for (const [, v] of Object.entries(s.records?.["tyre-stats"] || {})) {
    const w = v?.["lowest-tyre-wear-per-lap"];
    if (w?.["driver-name"] && (wear[w["driver-name"]] == null || w.value < wear[w["driver-name"]])) wear[w["driver-name"]] = w.value;
  }
  for (const r of rows) {
    const raw = cls.find((x) => x["driver-name"] === r.name) || {};
    const idx = raw.index;
    r.contacts = contacts.filter((c) => c.cars.includes(idx)).length;
    r.warns = warnings.get(r.name) || 0;
    r.made = made.get(r.name) || 0;
    r.lost = lost.get(r.name) || 0;
    const h = hist.find((x) => x.name === r.name)?.pts || [];
    const p0 = h.find((x) => x[0] === 0)?.[1], p1 = h.find((x) => x[0] === 1)?.[1];
    r.lap1 = p0 && p1 ? p0 - p1 : 0;
    const laps = (raw["session-history"]?.["lap-history-data"] || []).map((l) => ({ ms: l["lap-time-in-ms"], ok: (l["lap-valid-bit-flags"] & 1) === 1 })).filter((l) => l.ms > 0);
    r.lastLap = !out(r) && laps.length ? laps.at(-1).ms : 0;
    const clean = laps.slice(1).filter((l) => l.ok).map((l) => l.ms);
    if (clean.length >= 3) {
      const avg = clean.reduce((a, b) => a + b, 0) / clean.length;
      r.spread = Math.sqrt(clean.reduce((a, b) => a + (b - avg) ** 2, 0) / clean.length) / 1000;
    } else r.spread = null;
    r.wear = wear[r.name] ?? null;
    r.out = !!out(r);
  }
  const info = s["session-info"] || {};
  return {
    rows, win, hist, traps, contacts, warnings,
    laps: info["total-laps"] || win?.laps || 0, weather: info.weather || "", trackTemp: info["track-temperature"],
    fastest: rec("lap"), sectors: ["s1", "s2", "s3"].map(rec),
    topSpeed: traps[0] || null, overtakeKing: top(made), climber, mostWarnings: top(warnings),
    overtakes: ot.length, pens: rows.reduce((a, r) => a + r.pens, 0), penSec: rows.reduce((a, r) => a + r.pen, 0),
    made: (n) => made.get(n) || 0, lost: (n) => lost.get(n) || 0,
    contactsOf: (n) => { const i = cls.find((c) => c["driver-name"] === n)?.index; return contacts.filter((c) => c.cars.includes(i)).length; },
    trapOf: (n) => traps.find((t) => t.name === n)?.kmh || 0,
  };
}

export const fmtMs = (ms) => fmtRace(ms / 1000).replace(/^0:/, "");
export const fmtRace = (sec) => { const m = Math.floor(sec / 60); return `${m}:${(sec - m * 60).toFixed(3).padStart(6, "0")}`; };
export const TYRE = { Soft: "#ff3b30", Medium: "#ffd21f", Hard: "#f2f2f2", Inters: "#3ccf4e", Intermediate: "#3ccf4e", Wet: "#2f8cff" };
export const shortName = (n) => String(n || "").replace(/^ttv\//i, "").replace(/^\[[^\]]+\]\s*/, "");
