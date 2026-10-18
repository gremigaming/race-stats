// Screenshots of the Setup manager for checking it before it goes live
// (.github/workflows/setup-manager-preview.yml). Opens it once logged out and
// a few times with the key, as GreMi would see it after logging in.
//   node scripts/setup-manager-shots.mjs <dist folder> <output folder>   (SETUP_KEY in the environment)
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const [dist, outDir] = process.argv.slice(2);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/race-stats\//, "");
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4174);
const base = "http://localhost:4174/race-stats/";
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const shot = async (page, name, fullPage = true) => {
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: "jpeg", quality: 80, fullPage });
  console.log(`saved ${name}`);
};

const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(base);
await page.waitForTimeout(5000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0];
// logged out
await page.goto(`${base}${scope}/setups`);
await page.waitForTimeout(3000);
await shot(page, "setup-manager-locked", false);
// logged in: the key arrives in the hash, like after the Discord login
const open = async (p, track, kind) => {
  await p.evaluate(([t, k]) => sessionStorage.setItem("setup-manager-view", JSON.stringify({ track: t, kind: k })), [track, kind]);
  await p.goto(`${base}${scope}/setups`);
  await p.waitForTimeout(3000);
};
await page.goto(`${base}${scope}/setups#setup-key=${encodeURIComponent(process.env.SETUP_KEY)}`);
await page.waitForTimeout(3000);
await open(page, "Singapore", "race");
await shot(page, "setup-manager");
await open(page, "Singapore", "quali");
await shot(page, "setup-manager-quali");
await open(page, "Las Vegas", "wet");
await shot(page, "setup-manager-wet");
// phone width
const phone = await browser.newPage({ viewport: { width: 400, height: 860 } });
await phone.goto(`${base}${scope}/setups#setup-key=${encodeURIComponent(process.env.SETUP_KEY)}`);
await phone.waitForTimeout(3000);
await open(phone, "Singapore", "race");
await shot(phone, "setup-manager-phone", false);
await browser.close();
process.exit(0);
