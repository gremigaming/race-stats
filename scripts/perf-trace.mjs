// Frame-time trace of the race viewer (perf.yml). Serves dist like GitHub Pages, opens one race in
// the broadcast camera and plays it in a few setups (desktop, 4x speed, a slow CPU, a phone).
// Per setup: frame times (requestAnimationFrame), long tasks and the functions that took the most
// main-thread time (CPU profile). Writes <out>/perf.json and <out>/perf.md.
//
//   node scripts/perf-trace.mjs <dist> <race uid> <out folder> [seconds per setup]
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
const require = createRequire(process.cwd() + "/");
const { chromium } = require("playwright");

const [dist, uid, outDir, secs = "30"] = process.argv.slice(2);
const SECONDS = Number(secs);
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/race-stats\//, "");
  let file = join(dist, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(dist, "index.html");
  res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(4174);
const base = "http://localhost:4174/race-stats/";
mkdirSync(outDir, { recursive: true });

const SETUPS = [
  { name: "desktop 1x", viewport: { width: 1440, height: 900 }, dpr: 1, rate: "1x", cpu: 1 },
  { name: "desktop 4x speed", viewport: { width: 1440, height: 900 }, dpr: 1, rate: "4x", cpu: 1 },
  { name: "low-spec PC (CPU / 4)", viewport: { width: 1366, height: 768 }, dpr: 1, rate: "1x", cpu: 4 },
  { name: "phone (CPU / 4)", viewport: { width: 390, height: 844 }, dpr: 3, rate: "1x", cpu: 4, mobile: true },
];

const pct = (a, p) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : 0);
const browser = await chromium.launch(
  process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL, args: ["--enable-unsafe-swiftshader"] } : {},
);
const results = [];
for (const s of SETUPS) {
  const ctx = await browser.newContext({ viewport: s.viewport, deviceScaleFactor: s.dpr, isMobile: !!s.mobile, hasTouch: !!s.mobile });
  const page = await ctx.newPage();
  // the local bundle, not the live server's copy
  await page.route("https://replays.gremigaming.com/**", (r) => r.abort());
  await page.addInitScript(() => {
    const w = window;
    w.__frames = [];
    w.__long = [];
    w.__rec = false;
    let last = 0;
    const loop = (now) => {
      if (w.__rec && last) w.__frames.push([now, now - last]);
      last = now;
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (w.__rec) w.__long.push([e.startTime, e.duration]);
      }).observe({ type: "longtask", buffered: false });
    } catch {
      /* no long task timing */
    }
  });
  await page.goto(base);
  await page.waitForTimeout(3000);
  const scope = new URL(page.url()).pathname.replace(/^\/race-stats\//, "").split("/")[0] || "f1";
  await page.goto(`${base}${scope}/race/${encodeURIComponent(uid)}?t=240&perf`);
  await page.waitForSelector("canvas", { timeout: 30000 });
  await page.waitForTimeout(6000); // map tiles and chunks around the playhead
  const cdp = await ctx.newCDPSession(page);
  if (s.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: s.cpu });
  const speed = page.locator(`button:has-text("${s.rate}")`).first();
  if (await speed.isVisible().catch(() => false)) await speed.click();
  else if (s.rate !== "1x") console.log("speed button not visible:", s.rate);
  await page.keyboard.press("Space");
  await page.waitForTimeout(1500);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const heap0 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  await page.evaluate(() => (window.__rec = true));
  await page.waitForTimeout(SECONDS * 1000);
  await page.evaluate(() => (window.__rec = false));
  const heap1 = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0);
  const { profile } = await cdp.send("Profiler.stop");
  const { frames, long } = await page.evaluate(() => ({ frames: window.__frames, long: window.__long }));
  const scene = await page.evaluate(() => window.__scene?.debug?.() ?? null);
  // what the GPU side costs: the same view for a few seconds without the look pass, then without the map
  const fpsFor = async (fn) => {
    await page.evaluate(fn);
    await page.evaluate(() => ((window.__frames = []), (window.__rec = true)));
    await page.waitForTimeout(6000);
    const f = await page.evaluate(() => ((window.__rec = false), window.__frames.map((x) => x[1])));
    return f.length ? +(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1) : 0;
  };
  const ab = {
    noLook: await fpsFor(() => window.__scene?.debugToggle("look", false)),
    noLookNoMap: await fpsFor(() => window.__scene?.debugToggle("map", false)),
  };
  await page.evaluate(() => (window.__scene?.debugToggle("look", true), window.__scene?.debugToggle("map", true)));
  await page.screenshot({ path: `${outDir}/${s.name.replace(/[^a-z0-9]+/gi, "-")}.jpg`, type: "jpeg", quality: 70 });
  // self time per function
  const dt = new Map();
  profile.samples.forEach((id, i) => dt.set(id, (dt.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const self = new Map();
  let total = 0;
  for (const n of profile.nodes) {
    const us = dt.get(n.id) ?? 0;
    total += us;
    const f = n.callFrame;
    if (["(idle)", "(program)"].includes(f.functionName)) continue;
    const key = `${f.functionName || "(anonymous)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + us);
  }
  const busy = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([fn, us]) => ({ fn, ms: Math.round(us / 1000) }));
  const ms = frames.map((f) => f[1]).sort((a, b) => a - b);
  const slow = frames.filter((f) => f[1] > 33).map((f) => Math.round(f[0]));
  const r = {
    setup: s.name,
    frames: frames.length,
    fps: Math.round((frames.length / SECONDS) * 10) / 10,
    p50: +pct(ms, 0.5).toFixed(1),
    p95: +pct(ms, 0.95).toFixed(1),
    p99: +pct(ms, 0.99).toFixed(1),
    max: +(ms[ms.length - 1] ?? 0).toFixed(1),
    over20: ms.filter((x) => x > 20).length,
    over33: ms.filter((x) => x > 33).length,
    over50: ms.filter((x) => x > 50).length,
    longTasks: long.length,
    longTaskMs: Math.round(long.reduce((a, l) => a + l[1], 0)),
    mainThreadBusyPct: total ? Math.round((busy / total) * 100) : null,
    heapGrowthMB: +((heap1 - heap0) / 1e6).toFixed(1),
    scene,
    fpsWithoutLook: ab.noLook,
    fpsWithoutLookAndMap: ab.noLookNoMap,
    slowFramesAt: slow.slice(0, 20),
    top,
  };
  results.push(r);
  console.log(JSON.stringify(r));
  await ctx.close();
}
await browser.close();
server.close();
writeFileSync(`${outDir}/perf.json`, JSON.stringify(results, null, 2));
const md = [
  `### Race viewer frame times (${SECONDS} s per setup, broadcast camera)`,
  "",
  "| setup | fps | p50 ms | p95 ms | p99 ms | max ms | >20 ms | >33 ms | >50 ms | long tasks (ms) | main thread busy | heap growth |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...results.map((r) => `| ${r.setup} | ${r.fps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.max} | ${r.over20} | ${r.over33} | ${r.over50} | ${r.longTasks} (${r.longTaskMs}) | ${r.mainThreadBusyPct}% | ${r.heapGrowthMB} MB |`),
  "",
  "| setup | camera | tiles (photo / sharp) | fps without look pass | fps without look + map |",
  "|---|---|---|---|---|",
  ...results.map((r) => `| ${r.setup} | ${r.scene ? `${r.scene.mode} ${r.scene.scale} px/m` : "?"} | ${r.scene ? `${r.scene.photoTiles} / ${r.scene.sharpTiles}` : "?"} | ${r.fpsWithoutLook} | ${r.fpsWithoutLookAndMap} |`),
  "",
  ...results.flatMap((r) => [`**${r.setup}**: top main-thread functions (self ms)`, "", ...r.top.map((t) => `- ${t.ms} ms ${t.fn}`), ""]),
].join("\n");
writeFileSync(`${outDir}/perf.md`, md);
console.log(md);
