// Saves screenshots of the main pages into the given folder (previews/), so
// changes can be checked without opening the site.
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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
// PW_CHANNEL=chrome uses the runner's own Google Chrome (no browser download, which took minutes)
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
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
await shoot("race-picker", "race", true);
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
await page.locator("#safety-highlights").screenshot({ path: `${outDir}/safety-highlights.jpg`, type: "jpeg", quality: 80 });
await page.click('th:has-text("Races")');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/safety-sorted.jpg`, type: "jpeg", quality: 75 });
// sorted by a column, with the highlights below
await shoot("leaderboard-full", "drivers", true);
await page.locator("#league-highlights").screenshot({ path: `${outDir}/leaderboard-highlights.jpg`, type: "jpeg", quality: 80 });
await page.click('th:has-text("Avg gain")');
await page.waitForTimeout(500);
await page.screenshot({ path: `${outDir}/leaderboard-sorted.jpg`, type: "jpeg", quality: 75 });
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
// the Live Race Viewer: the newest race, an incident, a picked driver and the follow camera
const log = [];
page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && log.push(`${m.type()}: ${m.text()}`));
page.on("pageerror", (e) => log.push(`pageerror: ${e.message}`));
await shoot("race-viewer-list", "race");
const raceHref = await page.$eval(`a[href*="/race/"]`, (a) => a.getAttribute("href")).catch(() => null);
if (raceHref) {
  await page.goto(new URL(raceHref, base).toString());
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${outDir}/race-viewer.jpg`, type: "jpeg", quality: 80 });
  console.log(`saved race-viewer (${page.url()})`);
  // play from the grid: the start lights, then the broadcast camera
  await page.keyboard.press("Space");
  await page.waitForTimeout(3600);
  await page.screenshot({ path: `${outDir}/race-viewer-lights.jpg`, type: "jpeg", quality: 80 });
  await page.waitForTimeout(12000);
  await page.screenshot({ path: `${outDir}/race-viewer-broadcast.jpg`, type: "jpeg", quality: 80 });
  // an incident from the timeline: inputs of everyone involved, then back to the broadcast camera
  const incident = page.locator('button[title^="Incident"]').first();
  if (await incident.count()) {
    await incident.click({ force: true, timeout: 5000 });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${outDir}/race-viewer-incident.jpg`, type: "jpeg", quality: 80 });
    await page.waitForTimeout(16000);
    await page.screenshot({ path: `${outDir}/race-viewer-snapback.jpg`, type: "jpeg", quality: 80 });
  }
  // the running order: pick a driver (camera follows, TV strip, race card)
  const row = page.locator('ul[aria-label="Running order"] button').nth(2);
  if (await row.count()) {
    await row.click({ timeout: 5000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outDir}/race-viewer-card.jpg`, type: "jpeg", quality: 80 });
  }
  const second = page.locator('ul[aria-label="Running order"] button').nth(3);
  if (await second.count()) {
    await second.click({ modifiers: ["Shift"], timeout: 5000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${outDir}/race-viewer-follow.jpg`, type: "jpeg", quality: 80 });
  }
  // the side column's tabs, then the clean view (H)
  for (const [tab, file] of [["Safety", "safety"], ["Race stats", "stats"], ["Points", "points"]]) {
    const b = page.locator(`nav[aria-label="Panels"] button[title="${tab}"]`);
    if (await b.count()) {
      // a busy viewer can hold Playwright's post-click wait past the timeout: a missing tab shot must not drop all previews
      if (!(await b.click({ timeout: 5000 }).then(() => true, () => false))) continue;
      await page.waitForTimeout(800);
      await page.screenshot({ path: `${outDir}/race-viewer-${file}.jpg`, type: "jpeg", quality: 80 });
    }
  }
  await page.keyboard.press("h");
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/race-viewer-clean.jpg`, type: "jpeg", quality: 80 });
  await page.keyboard.press("h");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outDir}/race-viewer-phone.jpg`, type: "jpeg", quality: 75 });
  // a phone opening the race fresh: panels folded away, then opened
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phone.goto(new URL(raceHref, base).toString());
  await phone.waitForTimeout(7000);
  await phone.screenshot({ path: `${outDir}/race-viewer-phone-fresh.jpg`, type: "jpeg", quality: 75 });
  const open = phone.locator('button[aria-label="Show the panels"]');
  if (await open.count()) {
    await open.click({ timeout: 5000 });
    await phone.waitForTimeout(1500);
    await phone.screenshot({ path: `${outDir}/race-viewer-phone-panels.jpg`, type: "jpeg", quality: 75 });
  }
}
writeFileSync(`${outDir}/race-viewer-console.txt`, log.join("\n") || "no errors");
await browser.close();
server.close();
