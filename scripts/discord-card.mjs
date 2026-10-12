// Renders the leaderboard (this month, top 15), the safety rating ranking and
// GreMi's setup cards as pictures for Discord: <dist>/discord/leaderboard.png,
// safety.png and setups/*.png, plus
// leaderboard.json and safety.json, whose "hash" only changes when the
// standings do. Race Control's hourly job posts or edits the
// Discord message when that hash changes.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const [dist] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/race-stats\//, "");
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4174);

const base = "http://localhost:4174/race-stats/";
const out = join(dist, "discord");
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 2, timezoneId: "Europe/Amsterdam" });
await page.goto(base);
await page.waitForTimeout(4000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0];
await page.goto(`${base}${scope}/drivers?embed=1`);
await page.waitForSelector("#leaderboard-card");
await page.waitForTimeout(3000);
const card = await page.$("#leaderboard-card");
await card.screenshot({ path: join(out, "leaderboard.png") });
const text = await card.innerText();
const races = Number(await card.getAttribute("data-races")) || 0;
const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
// The month the standings are for, in GreMi's time zone ("2026-10")
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit" })
  .format(new Date());
writeFileSync(join(out, "leaderboard.json"), JSON.stringify({ hash, scope, month, races }, null, 2));
console.log(`discord card: ${hash} (${scope})`);

// The safety rating ranking (everyone) for the safety rating channel
await page.goto(`${base}${scope}/safety?embed=1`);
await page.waitForSelector("#safety-card table");
await page.waitForTimeout(3000);
const sr = await page.$("#safety-card");
await sr.screenshot({ path: join(out, "safety.png") });
const srHash = createHash("sha256").update(await sr.innerText()).digest("hex").slice(0, 16);
writeFileSync(join(out, "safety.json"), JSON.stringify({ hash: srHash }, null, 2));
console.log(`discord safety card: ${srHash}`);

// GreMi's setup per track for the F1-SETUPS forum: one picture per card
// (dry race, dry quali, wet, or a grayed "No setup yet" placeholder), listed
// in setups.json with a hash that only changes when the card does.
const setupOut = join(out, "setups");
mkdirSync(setupOut, { recursive: true });
await page.goto(`${base}setup-cards?embed=1`);
await page.waitForSelector("#setup-cards section");
await page.waitForTimeout(2000);
const setupTracks = [];
for (const section of await page.$$("#setup-cards section")) {
  const id = await section.getAttribute("id");
  const post = await section.getAttribute("data-post");
  const kind = await section.getAttribute("data-kind");
  await section.screenshot({ path: join(setupOut, `${id}.png`) });
  const hash = createHash("sha256").update(await section.innerText()).digest("hex").slice(0, 12);
  let track = setupTracks.find((t) => t.post === post);
  if (!track) setupTracks.push((track = { post, cards: [] }));
  track.cards.push({ kind, picture: `${id}.png`, hash });
}
writeFileSync(join(out, "setups.json"), JSON.stringify({ tracks: setupTracks }, null, 2));
console.log(`discord setup cards: ${setupTracks.length} tracks`);

// Test pictures from public/setup-test.json, when there is one
if (existsSync(join(dist, "setup-test.json"))) {
  const testOut = join(out, "setup-test");
  mkdirSync(testOut, { recursive: true });
  await page.goto(`${base}setup-cards?embed=1&src=setup-test.json`);
  await page.waitForSelector("#setup-cards section");
  await page.waitForTimeout(2000);
  for (const section of await page.$$("#setup-cards section")) {
    await section.screenshot({ path: join(testOut, `${await section.getAttribute("id")}.png`) });
  }
}
await browser.close();
server.close();
