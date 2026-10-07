// Renders the leaderboard (this month, top 15) as a picture for Discord:
// <dist>/discord/leaderboard.png plus leaderboard.json, whose "hash" only
// changes when the standings do. Race Control's hourly job posts or edits the
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
const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
writeFileSync(join(out, "leaderboard.json"), JSON.stringify({ hash, scope, title: text.split("\n")[1] ?? "" }, null, 2));
console.log(`discord card: ${hash} (${scope})`);
await browser.close();
server.close();
