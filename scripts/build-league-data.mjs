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
  if (name === "aliases.json" || seen.has(name)) continue;
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
