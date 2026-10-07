// Takes screenshots of the main pages and prints them as base64 in the log,
// so changes can be checked without opening the site.
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const base = process.argv[2];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.waitForTimeout(4000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0];
const pages = { dashboard: "", drivers: "drivers", h2h: "head-to-head" };
for (const [name, path] of Object.entries(pages)) {
  await page.goto(`${base}${scope}/${path}`);
  await page.waitForTimeout(3000);
  const png = await page.screenshot({ type: "jpeg", quality: 70 });
  const b64 = png.toString("base64");
  console.log(`SHOT-BEGIN ${name}`);
  for (let i = 0; i < b64.length; i += 1000) console.log(`SHOT ${b64.slice(i, i + 1000)}`);
  console.log(`SHOT-END ${name}`);
}
await browser.close();
