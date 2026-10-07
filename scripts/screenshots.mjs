// Saves screenshots of the main pages into the given folder (previews/), so
// changes can be checked without opening the site.
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const [base, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto(base);
await page.waitForTimeout(5000);
const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0];
const shoot = async (name, path) => {
  await page.goto(`${base}${scope}/${path}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${outDir}/${name}.jpg`, type: "jpeg", quality: 75 });
  console.log(`saved ${name} (${page.url()})`);
};
await shoot("dashboard", "");
await shoot("leaderboard", "drivers");
await shoot("head-to-head", "head-to-head");
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
