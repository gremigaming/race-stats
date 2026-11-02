// Race picker <-> viewer round trip (nav-check.yml): serves dist like GitHub Pages, opens a race from
// the picker, goes back with the "Races" button, opens a second race, then uses the browser's Back.
// Fails when a page error is thrown or the picker comes back without its race cards (black page).
//
//   node scripts/nav-check.mjs <dist> <out folder>
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const [dist, outDir] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/race-stats\//, "");
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4175);
const base = "http://localhost:4175/race-stats/";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL, args: ["--enable-unsafe-swiftshader"] } : {},
);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
// R2 only allows the real site's origin (CORS): hand its files to this localhost copy as if it were
await page.route("https://replays.gremigaming.com/**", async (route) => {
  const res = await route.fetch().catch(() => null);
  if (!res) return route.abort();
  await route.fulfill({ response: res, headers: { ...res.headers(), "access-control-allow-origin": "*" } });
});

const steps = [];
const cards = () => page.locator('a[href*="/race/"]');
async function shot(name) {
  await page.screenshot({ path: `${outDir}/${steps.length + 1}-${name}.png` });
  const n = await cards().count();
  const text = (await page.locator("body").innerText()).length;
  steps.push({ name, url: page.url().replace(base, "/"), cards: n, text, canvas: await page.locator("canvas").count() });
}
async function openRace(k) {
  await cards().nth(k).click();
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading track"), null, { timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(4000);
}

await page.goto(base);
await page.waitForTimeout(3000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0] || "f1";
await page.goto(`${base}${scope}/race`);
await cards().first().waitFor({ timeout: 30000 });
await shot("picker");
const total = await cards().count();
await openRace(0);
await shot("viewer-1");
await page.locator('a[aria-label="All races"]').click();
await page.waitForTimeout(3000);
await shot("picker-after-races-button");
await openRace(Math.min(1, total - 1));
await shot("viewer-2");
await page.goBack();
await page.waitForTimeout(3000);
await shot("picker-after-browser-back");
await openRace(0);
await shot("viewer-3-same-track-again");

await browser.close();
server.close();
const pickers = steps.filter((s) => s.name.startsWith("picker"));
const ok = !errors.some((e) => e.startsWith("pageerror")) && pickers.every((s) => s.cards > 0) && steps.filter((s) => s.name.startsWith("viewer")).every((s) => s.canvas > 0);
let md = `## Race picker round trip: ${ok ? "OK" : "FAILED"}\n\n| step | url | race cards | canvases | text chars |\n|---|---|---|---|---|\n`;
for (const s of steps) md += `| ${s.name} | ${s.url} | ${s.cards} | ${s.canvas} | ${s.text} |\n`;
md += `\n${errors.length ? errors.map((e) => `- ${e.slice(0, 300)}`).join("\n") : "No errors."}\n`;
writeFileSync(`${outDir}/nav.md`, md);
console.log(md);
process.exit(ok ? 0 : 1);
