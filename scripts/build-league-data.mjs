// Turns the race files in races/ into the static data the site loads:
// public/league/index.json and public/league/sessions/<file>.json.
// Fields nobody needs on a public site (platform, network slot) are dropped.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "races";
const OUT = join("public", "league");
// Shown first when a visitor hasn't picked a driver yet
const DEFAULT_DRIVER = "ttv/gremi_gaming";

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".json") ? [join(dir, e.name)] : [],
  );
}

function dateKey(name) {
  const m = name.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.json$/);
  return m ? m.slice(1).join("") : "";
}

// Drivers who changed their online name: races/aliases.json maps an old name
// to the current one, so all their races land on one profile.
const norm = (n) => n.replace(/[\s\u00a0]+/g, " ").trim().toLowerCase();
let aliases = new Map();
try {
  const raw = JSON.parse(readFileSync(join(SRC, "aliases.json"), "utf8"));
  aliases = new Map(Object.entries(raw).map(([from, to]) => [norm(from), to]));
} catch {
  // no aliases file
}
// Staff corrections from the staff page (races/corrections.json): name links
// ("alias", "split"), result fixes ("result") and kicks ("kick"). The SR ones
// are applied in scripts/safety_rating.py.
let changes = [];
try {
  changes = JSON.parse(readFileSync(join(SRC, "corrections.json"), "utf8")).changes ?? [];
} catch {
  // no corrections yet
}
for (const c of changes) {
  if (c.type === "alias" && c.from && c.to) aliases.set(norm(c.from), c.to);
  if (c.type === "split" && c.from) aliases.delete(norm(c.from));
}
const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const OUT_STATUSES = ["DISQUALIFIED", "DID_NOT_FINISH", "RETIRED", "NOT_CLASSIFIED"];

// Applies the staff's result fixes for one file: a time penalty (seconds,
// re-sorts the finishers by race time), a new status (DSQ or DNF go to the
// back) or a new position. Cars are matched by their index in the file.
function fixResults(name, data) {
  const fixes = changes.filter((c) => c.type === "result" && c.file === name);
  if (!fixes.length) return;
  const rows = data["classification-data"].filter((d) => d["final-classification"]);
  const byCar = new Map(rows.map((d) => [d.index, d]));
  const hadPoints = rows.some((d) => d["final-classification"].points > 0);
  let resort = false;
  for (const f of fixes) {
    const fc = byCar.get(f.car)?.["final-classification"];
    if (!fc) continue;
    if (f.kind === "time") {
      fc["penalties-time"] = (fc["penalties-time"] ?? 0) + Number(f.value);
      fc["num-penalties"] = (fc["num-penalties"] ?? 0) + 1;
      resort = true;
    } else if (f.kind === "status") {
      fc["result-status"] = f.value;
      resort = true;
    }
  }
  let order = [...rows].sort((a, b) => a["final-classification"].position - b["final-classification"].position);
  if (resort) {
    const out = (d) => OUT_STATUSES.includes(d["final-classification"]["result-status"]);
    const time = (d) => d["final-classification"]["total-race-time"] + (d["final-classification"]["penalties-time"] ?? 0);
    const laps = (d) => d["final-classification"]["num-laps"] ?? 0;
    order = [
      ...order.filter((d) => !out(d)).sort((a, b) => laps(b) - laps(a) || time(a) - time(b)),
      ...order.filter(out),
    ];
  }
  for (const f of fixes) {
    if (f.kind !== "position") continue;
    const d = byCar.get(f.car);
    if (!d) continue;
    order.splice(order.indexOf(d), 1);
    order.splice(Math.max(0, Math.min(order.length, Number(f.value) - 1)), 0, d);
  }
  order.forEach((d, i) => {
    const fc = d["final-classification"];
    fc.position = i + 1;
    d["track-position"] = i + 1;
    if (hadPoints) fc.points = OUT_STATUSES.includes(fc["result-status"]) ? 0 : (POINTS[i] ?? 0);
  });
  console.log(`staff result fixes: ${name} (${fixes.length})`);
}
// Kicks: a driver the staff removed from the lobby disappears from those
// sessions for everyone: their result, and every contact, penalty, overtake
// and record that involves their car. The untouched session is kept in
// .cache/kicked/ so the safety rating can still charge the kicked driver for
// their own incidents.
const KICKED_DIR = join(".cache", "kicked");
function kickCars(name, data) {
  const cars = new Set(
    changes.filter((c) => c.type === "kick").flatMap((c) => c.cars ?? []).filter((k) => k.file === name).map((k) => Number(k.car)),
  );
  const rows = data["classification-data"];
  const gone = rows.filter((d) => cars.has(d.index));
  if (!gone.length) return;
  mkdirSync(KICKED_DIR, { recursive: true });
  writeFileSync(join(KICKED_DIR, name), JSON.stringify(data));
  const names = new Set(gone.flatMap((d) => [d["driver-name"], d["participant-data"]?.name].filter(Boolean)));
  const hit = (m) =>
    (m["involved-drivers"] ?? []).some((i) => cars.has(i)) ||
    ["vehicle-index", "other-vehicle-index", "overtaker-index", "overtaken-index", "driver-index"].some((k) => cars.has(m[k]));
  const pairHit = (p) => cars.has(p["driver-1-index"]) || cars.has(p["driver-2-index"]);
  const hadPoints = rows.some((d) => d["final-classification"]?.points > 0);
  data["classification-data"] = rows.filter((d) => !cars.has(d.index));
  if (Array.isArray(data["race-control"])) data["race-control"] = data["race-control"].filter((m) => !hit(m));
  for (const d of data["classification-data"]) {
    if (Array.isArray(d["race-control"])) d["race-control"] = d["race-control"].filter((m) => !hit(m));
    const col = d.collisions;
    if (col && Array.isArray(col["collision-pairs"])) {
      col["collision-pairs"] = col["collision-pairs"].filter((p) => !pairHit(p));
      const most = Math.max(0, ...col["collision-pairs"].map((p) => p["num-collisions"] ?? 0));
      col["most-collided-pairs"] = {
        count: most,
        "collision-pairs": col["collision-pairs"].filter((p) => most && p["num-collisions"] === most).map(({ collisions, "num-collisions": _, ...p }) => p),
      };
    }
  }
  const byName = (key) => (x) => !names.has(x[key]);
  if (Array.isArray(data["position-history"])) data["position-history"] = data["position-history"].filter(byName("name"));
  if (Array.isArray(data["speed-trap-records"])) data["speed-trap-records"] = data["speed-trap-records"].filter(byName("name"));
  if (Array.isArray(data["tyre-stint-history-v2"])) data["tyre-stint-history-v2"] = data["tyre-stint-history-v2"].filter((x) => !cars.has(x.index) && !names.has(x.name));
  if (Array.isArray(data.overtakes?.records))
    data.overtakes.records = data.overtakes.records.filter((o) => !names.has(o["overtaking-driver-name"]) && !names.has(o["overtaken-driver-name"]));
  const fastest = data.records?.fastest;
  if (fastest) for (const k of Object.keys(fastest)) if (cars.has(fastest[k]?.["driver-index"])) delete fastest[k];
  // the others move up: same order, positions and points worked out again
  const classified = data["classification-data"].filter((d) => d["final-classification"]);
  classified.sort((a, b) => a["final-classification"].position - b["final-classification"].position);
  classified.forEach((d, i) => {
    const fc = d["final-classification"];
    fc.position = i + 1;
    d["track-position"] = i + 1;
    if (hadPoints) fc.points = OUT_STATUSES.includes(fc["result-status"]) ? 0 : (POINTS[i] ?? 0);
  });
  console.log(`staff kicks: ${name} (${gone.map((d) => d["driver-name"]).join(", ")})`);
}
const renameDrivers = (value) => {
  if (Array.isArray(value)) return value.map(renameDrivers);
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) value[k] = renameDrivers(value[k]);
    return value;
  }
  if (typeof value === "string" && aliases.size) return aliases.get(norm(value)) ?? value;
  return value;
};

rmSync(OUT, { recursive: true, force: true });
rmSync(KICKED_DIR, { recursive: true, force: true });
mkdirSync(join(OUT, "sessions"), { recursive: true });

// A "Manual" save is written by hand, often hours after the race (even the
// next day). Name it after the race's own last event instead, in Dutch time
// like the automatic saves, so it lands in the right stream.
function realName(name, data) {
  const m = name.match(/^(.+?)_Manual_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}\.json$/);
  const last = Math.max(...(data["race-control"] ?? []).map((e) => e.timestamp ?? 0));
  if (!m || !(last > 0)) return name;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(new Date(last * 1000)).map((x) => [x.type, x.value]),
  );
  return `${m[1]}_${p.year}_${p.month}_${p.day}_${p.hour}_${p.minute}_${p.second}.json`;
}

// Hidden-name players (GreMi 2026-10-09): within one stream (sessions less
// than 3 h apart), when a hidden car stops showing up and a named driver with
// the same race number + nationality + platform shows up after it, they turned
// their name on, so the hidden sessions get their name as if they were always
// named. Never across streams, never the default combo (#2, Unspecified),
// never when the combo is ambiguous. Every merge is listed in
// league/merges.json for the staff page; an "unmerge" correction undoes one.
const STREAM_GAP = 3 * 60 * 60 * 1000;
const unmerged = new Set(changes.filter((c) => c.type === "unmerge").map((c) => c.merge));
const fileTime = (name) => {
  const k = dateKey(name);
  return k ? Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10), +k.slice(10, 12)) : 0;
};
function carsOf(data) {
  return data["classification-data"].flatMap((d) => {
    const p = d["participant-data"];
    if (!p || p["ai-controlled"]) return [];
    if (p["race-number"] === 2 && (p.nationality ?? "Unspecified") === "Unspecified") return [];
    const hidden = p["show-online-names"] === false;
    const name = renameDrivers(d["driver-name"] ?? "");
    if (!hidden && (!name || / #\d+$/.test(name))) return [];
    return [{ index: d.index, name, hidden, combo: `${p["race-number"]}|${p.nationality}|${p.platform}` }];
  });
}
function findMerges(sessions) {
  sessions.sort((a, b) => fileTime(a.name) - fileTime(b.name));
  const streams = [];
  for (const s of sessions) {
    const last = streams.at(-1);
    if (last && fileTime(s.name) - fileTime(last.at(-1).name) <= STREAM_GAP) last.push(s);
    else streams.push([s]);
  }
  const merges = new Map(); // file -> Map(car index -> name)
  const list = [];
  for (const stream of streams) {
    const combos = new Map();
    stream.forEach((s, i) =>
      s.cars.forEach((c) => {
        if (!combos.has(c.combo)) combos.set(c.combo, []);
        combos.get(c.combo).push({ ...c, i, file: s.name });
      }),
    );
    for (const [combo, seen] of combos) {
      const hidden = seen.filter((c) => c.hidden);
      const named = seen.filter((c) => !c.hidden);
      const names = new Set(named.map((c) => c.name.toLowerCase()));
      if (!hidden.length || names.size !== 1) continue;
      const perSession = new Map();
      for (const c of seen) perSession.set(c.i, (perSession.get(c.i) ?? 0) + 1);
      if ([...perSession.values()].some((n) => n > 1)) continue; // two of them in one session
      if (Math.max(...hidden.map((c) => c.i)) > Math.min(...named.map((c) => c.i))) continue;
      const to = named.at(-1).name;
      const [number, nationality, platform] = combo.split("|");
      const day = stream[0].name.match(/(\d{4})_(\d{2})_(\d{2})_\d{2}_\d{2}_\d{2}\.json$/).slice(1).join("-");
      const id = `${day}|${to.toLowerCase()}`;
      const entry = { id, day, name: to, car: `#${number} ${nationality} ${platform}`, hidden: [...new Set(hidden.map((c) => c.name))],
        files: hidden.map((c) => c.file), off: unmerged.has(id) };
      list.push(entry);
      if (entry.off) continue;
      for (const c of hidden) {
        if (!merges.has(c.file)) merges.set(c.file, new Map());
        merges.get(c.file).set(c.index, to);
      }
    }
  }
  return { merges, list };
}
// A merged car takes the driver's name everywhere in the file (results,
// position history, overtakes, stints) and counts as a named driver.
function mergeHidden(name, data, merged) {
  const cars = merged.get(name);
  if (!cars) return;
  const names = new Map();
  for (const d of data["classification-data"]) {
    const to = cars.get(d.index);
    if (!to) continue;
    names.set(d["driver-name"], to);
    const p = d["participant-data"];
    if (p) {
      p["show-online-names"] = true;
      if (p.name) p.name = to;
    }
  }
  const swap = (value) => {
    if (Array.isArray(value)) return value.map(swap);
    if (value && typeof value === "object") {
      for (const k of Object.keys(value)) value[k] = swap(value[k]);
      return value;
    }
    return typeof value === "string" && names.has(value) ? names.get(value) : value;
  };
  swap(data);
}

// First pass: who drove each session, for the hidden-name merges
const readSave = (path) => {
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    return data && Array.isArray(data["classification-data"]) && data["session-info"] ? data : null;
  } catch {
    return null;
  }
};
const firstPass = [];
for (const path of walk(SRC)) {
  const base = path.split(/[\\/]/).pop();
  if (base === "aliases.json" || base === "corrections.json") continue;
  const data = readSave(path);
  if (data) firstPass.push({ name: realName(base, data), cars: carsOf(data) });
}
const { merges: merged, list: mergeList } = findMerges(firstPass);

const seen = new Set();
const files = [];
for (const path of walk(SRC)) {
  let name = path.split(/[\\/]/).pop();
  if (name === "aliases.json" || name === "corrections.json" || seen.has(name)) continue;
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`skipped (not valid JSON): ${name}`);
    continue;
  }
  if (!data || !Array.isArray(data["classification-data"]) || !data["session-info"]) {
    console.warn(`skipped (not a Pits n' Giggles save): ${name}`);
    continue;
  }
  // Only multiplayer sessions belong on the site; career, Grand Prix and time
  // trial saves from the racing PC are skipped.
  if (data["session-info"]["network-game"] !== 1) {
    console.log(`skipped (not multiplayer): ${name}`);
    continue;
  }
  name = realName(name, data);
  if (seen.has(name)) continue;
  renameDrivers(data);
  mergeHidden(name, data, merged);
  if (data["session-info"]) fixResults(name, data);
  kickCars(name, data);
  for (const d of data["classification-data"]) {
    const p = d["participant-data"];
    if (p) {
      delete p.platform;
      delete p["network-id"];
    }
  }
  seen.add(name);
  writeFileSync(join(OUT, "sessions", name), JSON.stringify(data));
  files.push(name);
}
// Pits n' Giggles writes a "Just_in_case" save when a session looks like it
// ended without results, and often the real save follows a minute later.
// Keep the backup only when no real save of the same event came after it.
const parseName = (name) => {
  const m = name.match(/^(.+?)_(?:Just_in_case_)?(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})_(\d{2})\.json$/);
  return m ? { event: m[1], at: Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]) } : null;
};
const backups = files.filter((f) => f.includes("_Just_in_case_"));
for (const backup of backups) {
  const b = parseName(backup);
  if (!b) continue;
  const replaced = files.some((f) => {
    if (f.includes("_Just_in_case_")) return false;
    const r = parseName(f);
    return r && r.event === b.event && r.at >= b.at && r.at - b.at <= 15 * 60 * 1000;
  });
  if (replaced) {
    files.splice(files.indexOf(backup), 1);
    rmSync(join(OUT, "sessions", backup));
    console.log(`skipped (real save exists): ${backup}`);
  }
}
files.sort((a, b) => dateKey(b).localeCompare(dateKey(a)));
writeFileSync(join(OUT, "merges.json"), JSON.stringify({ merges: mergeList }, null, 2));
console.log(`hidden-name merges: ${mergeList.filter((m) => !m.off).length} (${mergeList.filter((m) => m.off).length} undone by staff)`);
writeFileSync(join(OUT, "index.json"), JSON.stringify({ files, defaultDriver: DEFAULT_DRIVER }, null, 2));

// Every named driver in the published races, for the name pickers on the staff page
const allNames = new Map();
for (const name of files) {
  const data = JSON.parse(readFileSync(join(OUT, "sessions", name), "utf8"));
  for (const d of data["classification-data"]) {
    const shown = (d["driver-name"] ?? "").replace(/[\s\u00a0]+/g, " ").trim();
    if (!shown || d["participant-data"]?.["show-online-names"] === false || / #\d+$/.test(shown)) continue;
    allNames.set(norm(shown), shown);
  }
}
writeFileSync(join(OUT, "names.json"), JSON.stringify({ names: [...allNames.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })) }));

// Championship standings per month (the site's default "This month" view),
// for the live championship board the Discord bot keeps. Same sums as the
// site's leaderboard: race sessions, named drivers, points as saved.
const display = (n) => n.replace(/[\s\u00a0]+/g, " ").trim();
const finishedStatus = (s) => s === "FINISHED" || s === "ACTIVE" || s === "";
const months = {};
for (const name of files) {
  const m = name.match(/(\d{4})_(\d{2})_\d{2}_\d{2}_\d{2}/);
  const data = JSON.parse(readFileSync(join(OUT, "sessions", name), "utf8"));
  if (!m || !/race/i.test(data["session-info"]?.["session-type"] ?? "")) continue;
  const rows = (months[`${m[1]}-${m[2]}`] ??= {});
  const seenHere = new Set();
  for (const d of data["classification-data"]) {
    const shown = display(d["driver-name"] ?? "");
    const key = shown.toLowerCase();
    if (!shown || d["participant-data"]?.["show-online-names"] === false || /^\d+ #\d+$/.test(shown)) continue;
    if (seenHere.has(key)) continue;
    seenHere.add(key);
    const fc = d["final-classification"];
    const ld = d["lap-data"] ?? {};
    const status = fc ? fc["result-status"] ?? "" : ld["result-status"] ?? "";
    const position = fc ? fc.position ?? null : ld["car-position"] > 0 ? ld["car-position"] : null;
    const points = fc ? fc.points ?? 0 : position && finishedStatus(status) ? POINTS[position - 1] ?? 0 : 0;
    const row = (rows[key] ??= { name: shown, points: 0, races: 0, wins: 0, podiums: 0 });
    row.races += 1;
    row.points += points;
    if (finishedStatus(status) && position === 1) row.wins += 1;
    if (finishedStatus(status) && position && position <= 3) row.podiums += 1;
  }
}
const standings = Object.fromEntries(
  Object.entries(months).map(([month, rows]) => [
    month,
    Object.values(rows).sort((a, b) => b.points - a.points || b.wins - a.wins || b.podiums - a.podiums || a.name.localeCompare(b.name)),
  ]),
);
writeFileSync(join(OUT, "championship.json"), JSON.stringify({ months: standings }));
console.log(`league data: ${files.length} session files`);

// GreMi's car setups per track for the F1-SETUPS forum in Discord (setups.json).
// Pits n' Giggles only saves the setup of the PC's own driver, and only with
// "Process incoming car setup data" ticked. Every save sorts into a dry race,
// dry quali or wet setup; the newest save of a kind replaces the older one.
// A setup fewer than SETUP_MIN_DIFF values away from a newer one is the same
// setup, so it is dropped: one card stays the one and only setup, under the
// kind it was last used as (a wet race's setup raced in the dry is the dry
// race setup again).
const SETUP_TRACKS = [
  // [Discord forum post name, track-id values in the saves], in calendar order
  ["Australia", ["Melbourne", "Australia"]],
  ["China", ["Shanghai", "China"]],
  ["Japan", ["Suzuka", "Japan"]],
  ["Bahrain", ["Sakhir", "Bahrain"]],
  ["Saudi Arabia", ["Jeddah", "Saudi Arabia"]],
  ["Miami", ["Miami"]],
  ["Emilia-Romagna", ["Imola", "Emilia Romagna"]],
  ["Canada", ["Montreal", "Canada"]],
  ["Monaco", ["Monaco"]],
  ["Barcelona", ["Catalunya", "Spain", "Barcelona"]],
  ["Austria", ["Austria"]],
  ["Great Britain", ["Silverstone", "Great Britain"]],
  ["Belgium", ["Spa", "Belgium"]],
  ["Hungary", ["Hungaroring", "Hungary"]],
  ["Netherlands", ["Zandvoort", "Netherlands"]],
  ["Monza", ["Monza", "Italy"]],
  ["Madrid", ["Madrid"]],
  ["Azerbaijan", ["Baku", "Azerbaijan"]],
  ["Singapore", ["Singapore"]],
  ["Austin", ["Texas", "Austin"]],
  ["Mexico", ["Mexico"]],
  ["Brazil", ["Brazil"]],
  ["Las Vegas", ["Las Vegas"]],
  ["Qatar", ["Losail", "Qatar"]],
  ["Abu Dhabi", ["Abu Dhabi"]],
];
const SETUP_KEYS = [
  "front-wing", "rear-wing", "on-throttle", "off-throttle", "front-camber", "rear-camber",
  "front-toe", "rear-toe", "front-suspension", "rear-suspension", "front-anti-roll-bar",
  "rear-anti-roll-bar", "front-suspension-height", "rear-suspension-height", "brake-pressure",
  "brake-bias", "front-left-tyre-pressure", "front-right-tyre-pressure",
  "rear-left-tyre-pressure", "rear-right-tyre-pressure",
];
const SETUP_MIN_DIFF = 3;
const SETUP_QUALI_FROM = "20261012";
const setupDiff = (a, b) => SETUP_KEYS.filter((k) => Math.abs((a[k] ?? 0) - (b[k] ?? 0)) > 1e-3).length;
const WET_WEATHER = /rain|storm/i;
const setupSlots = new Map(SETUP_TRACKS.map(([post]) => [post, {}]));
const postFor = (trackId) => SETUP_TRACKS.find(([, ids]) => ids.includes(trackId))?.[0];
for (const name of [...files].reverse()) {
  const data = JSON.parse(readFileSync(join(OUT, "sessions", name), "utf8"));
  const info = data["session-info"];
  const post = postFor(info["track-id"]);
  const me = data["classification-data"].find((d) => d["is-player"]);
  const setup = me?.["car-setup"];
  if (!post || !setup?.["is-valid"] || SETUP_KEYS.every((k) => !setup[k])) continue;
  const wetTyres = (me["tyre-set-history"] ?? []).some((s) => /inter|wet/i.test(s["tyre-set-key"] ?? ""));
  // GreMi (2026-10-12): every setup used before then is a dry race setup,
  // also in qualifying; only a wet race makes one a wet setup
  const quali = /qualifying/i.test(info["session-type"] ?? "") && dateKey(name) >= SETUP_QUALI_FROM;
  const kind = WET_WEATHER.test(info.weather ?? "") || wetTyres ? "wet" : quali ? "quali" : "race";
  const slots = setupSlots.get(post);
  for (const other of Object.keys(slots)) {
    if (other !== kind && setupDiff(slots[other].setup, setup) < SETUP_MIN_DIFF) delete slots[other];
  }
  const values = Object.fromEntries(SETUP_KEYS.map((k) => [k, setup[k]]));
  slots[kind] = { setup: { ...values, "is-valid": true }, file: name, session: info["session-type"] };
}
// In GreMi's order: quali, race, wet; a kind without a setup is a placeholder
const SETUP_ORDER = [["quali", "Dry quali"], ["race", "Dry race"], ["wet", "Wet"]];
const setupCards = SETUP_TRACKS.map(([post]) => {
  const slots = setupSlots.get(post);
  const cards = SETUP_ORDER.map(([kind, label]) =>
    slots[kind] ? { kind, label, ...slots[kind] } : { kind, label, placeholder: true });
  return { post, cards };
});
writeFileSync(join(OUT, "setups.json"), JSON.stringify({ tracks: setupCards }, null, 2));
console.log(`setups: ${setupCards.filter((t) => t.cards.some((c) => !c.placeholder)).length} tracks with a setup`);

// A short text summary of the latest stream (races less than 3 h apart, like the
// site's "stream" filter) plus this month's top 5, for Race Control's quick
// Discord answers. The bot loads it once a day, only for stream-race questions,
// so it stays small: hidden-name drivers are left out like everywhere else.
const named = (d) => {
  const shown = display(d["driver-name"] ?? "");
  if (!shown || d["participant-data"]?.["show-online-names"] === false || /^\d+ #\d+$/.test(shown)) return null;
  return shown.toLowerCase() === DEFAULT_DRIVER ? "GreMi" : shown;
};
const raceFiles = files.filter((f) => /^Race_/.test(f));
const atOf = (f) => parseName(f)?.at ?? 0;
const stream = [];
for (const f of raceFiles) {
  if (stream.length && atOf(stream[stream.length - 1]) - atOf(f) > 3 * 3600 * 1000) break;
  stream.push(f);
}
const lines = [];
if (stream.length) {
  const day = new Date(atOf(stream[0])).toISOString().slice(0, 10);
  lines.push(`Latest stream ${day}, top 3 per race:`);
  for (const f of [...stream].reverse()) {
    const data = JSON.parse(readFileSync(join(OUT, "sessions", f), "utf8"));
    const rows = data["classification-data"].map((d) => {
      const fc = d["final-classification"];
      const ld = d["lap-data"] ?? {};
      const status = fc ? fc["result-status"] ?? "" : ld["result-status"] ?? "";
      const position = fc ? fc.position ?? null : ld["car-position"] > 0 ? ld["car-position"] : null;
      return { name: named(d), status, position };
    });
    const finished = rows.filter((r) => finishedStatus(r.status) && r.position).sort((a, b) => a.position - b.position);
    const podium = finished.slice(0, 3).map((r) => r.name ?? "hidden").join(", ");
    const dnf = rows.filter((r) => OUT_STATUSES.includes(r.status)).map((r) => r.name ?? "hidden");
    const fl = data.records?.fastest?.lap;
    const flName = fl && rows[fl["driver-index"]]?.name;
    const track = (data["session-info"]?.["track-id"] ?? parseName(f)?.event ?? "?").replace(/_/g, " ");
    lines.push(`${track}: ${podium || "no result"}` +
      (flName ? `; FL ${flName}` : "") +
      (dnf.length ? `; DNF ${dnf.join(", ")}` : ""));
  }
}
const month = Object.keys(standings).sort().pop();
if (month) {
  lines.push(`${month} standings: ` + standings[month].slice(0, 5)
    .map((r) => `${named({ "driver-name": r.name })} ${r.points}`).join(", ") + " pts");
}
writeFileSync(join(OUT, "recent.txt"), lines.join("\n") + "\n");
