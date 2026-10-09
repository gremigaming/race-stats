// Saves screenshots of the main pages into the given folder (previews/), so
// changes can be checked without opening the site.
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

// argv: <dist folder> <output folder>. Serves dist like GitHub Pages does,
// under /race-stats/ with the app for every unknown path.
const [dist, outDir] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".woff2": "font/woff2" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/race-stats\//, "");
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4173);
const base = "http://localhost:4173/race-stats/";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
// The default filter (this month) can be empty; most shots use all time
await page.addInitScript(() => {
  if (!sessionStorage.getItem("league-filter")) sessionStorage.setItem("league-filter", JSON.stringify({ kind: "all" }));
});
await page.goto(base);
await page.waitForTimeout(5000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0];
const shoot = async (name, path, fullPage = false) => {
  await page.goto(`${base}${scope}/${path}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: "jpeg", quality: 75, fullPage });
  console.log(`saved ${name} (${page.url()})`);
};
await shoot("dashboard", "");
// the driver search, typed into
await page.click('button[aria-label="Driver"]');
await page.keyboard.type("co");
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/driver-search.jpg`, type: "jpeg", quality: 75 });
await page.keyboard.press("Escape");
// the last 3 streams
await page.selectOption('select[aria-label="Time range"]', "streams");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/filter-streams.jpg`, type: "jpeg", quality: 75 });
await page.selectOption('select[aria-label="Time range"]', "all");
await shoot("leaderboard", "drivers");
await page.selectOption('select[aria-label="Time range"]', "month");
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/leaderboard-month.jpg`, type: "jpeg", quality: 75 });
await page.selectOption('select[aria-label="Time range"]', "all");
await shoot("safety", "safety", true);
await shoot("head-to-head", "head-to-head", true);
// a race opened from head to head keeps both drivers compared
const row = await page.$("tbody tr");
if (row) {
  await row.click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outDir}/race-compare.jpg`, type: "jpeg", quality: 75 });
  console.log(`saved race-compare (${page.url()})`);
  const gap = page.locator("section", { hasText: "Performance Delta" }).last();
  if (await gap.count()) {
    await gap.scrollIntoViewIfNeeded();
    await gap.hover({ position: { x: 300, y: 140 } }).catch(() => {});
    await page.waitForTimeout(500);
    await gap.screenshot({ path: `${outDir}/race-gap.jpg`, type: "jpeg", quality: 80 });
    console.log("saved race-gap");
  }
}
// the newest race, as seen by the default driver
await page.goto(`${base}${scope}/`);
await page.waitForTimeout(3000);
const href = await page.$eval(`a[href*="/sessions/"]`, (a) => a.getAttribute("href")).catch(() => null);
if (href) {
  await page.goto(new URL(href, base).toString());
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${outDir}/race.jpg`, type: "jpeg", quality: 75, fullPage: true });
  console.log(`saved race (${page.url()})`);
}
await browser.close();
server.close();
