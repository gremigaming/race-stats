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

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, "sessions"), { recursive: true });

const seen = new Set();
const files = [];
for (const path of walk(SRC)) {
  const name = path.split(/[\\/]/).pop();
  if (seen.has(name)) continue;
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    console.warn(`skipped (not valid JSON): ${name}`);
    continue;
  }
  if (!Array.isArray(data["classification-data"]) || !data["session-info"]) {
    console.warn(`skipped (not a Pits n' Giggles save): ${name}`);
    continue;
  }
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
files.sort((a, b) => dateKey(b).localeCompare(dateKey(a)));
writeFileSync(join(OUT, "index.json"), JSON.stringify({ files, defaultDriver: DEFAULT_DRIVER }, null, 2));
console.log(`league data: ${files.length} session files`);
