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
// ("alias", "split") and result fixes ("result"). The SR ones are applied in
// scripts/safety_rating.py.
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
mkdirSync(join(OUT, "sessions"), { recursive: true });

const seen = new Set();
const files = [];
for (const path of walk(SRC)) {
  const name = path.split(/[\\/]/).pop();
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
  renameDrivers(data);
  if (data["session-info"]) fixResults(name, data);
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
writeFileSync(join(OUT, "index.json"), JSON.stringify({ files, defaultDriver: DEFAULT_DRIVER }, null, 2));
console.log(`league data: ${files.length} session files`);
