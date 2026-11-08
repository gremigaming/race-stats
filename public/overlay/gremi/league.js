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
