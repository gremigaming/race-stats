/**
 * Map tile textures without main-thread hitches:
 *
 * - decode(): WebP/PNG blobs become ImageBitmaps in a small worker pool (never on the main thread).
 * - Textures are shared by every map on the page (main view and PiP), kept in an LRU with a size cap
 *   (smaller on phones) so a long session never fills the GPU.
 * - upload(): the GPU upload is done by hand, inside a per-frame time budget shared by all maps, so a
 *   camera cut that needs many new tiles spreads them over a few frames instead of one long frame.
 */
import { ImageSource, Texture, type Renderer, type TextureSource } from "pixi.js";

// ------------------------------------------------------------------ decoding pool

interface Job {
  blob: Blob;
  size: number;
  done: (b: ImageBitmap | null) => void;
}
const jobs = new Map<number, Job>();
let nextId = 1;
let pool: Worker[] | null = null;
let turn = 0;

function mainThread(blob: Blob, size: number) {
  const opts: ImageBitmapOptions = { premultiplyAlpha: "premultiply" };
  if (size) Object.assign(opts, { resizeWidth: size, resizeHeight: size, resizeQuality: "high" });
  return createImageBitmap(blob, opts).catch(() => null);
}

function workers() {
  if (pool) return pool;
  pool = [];
  const n = Math.max(2, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  try {
    for (let k = 0; k < n; k++) {
      const w = new Worker(new URL("./tiles.worker.ts", import.meta.url), { type: "module" });
      w.onmessage = (e: MessageEvent<{ id: number; bmp?: ImageBitmap }>) => {
        const j = jobs.get(e.data.id);
        jobs.delete(e.data.id);
        j?.done(e.data.bmp ?? null);
      };
      w.onerror = () => {
        // a worker that can't start: decode everything on the main thread's async decoder instead
        for (const x of pool ?? []) x.terminate();
        pool = [];
        for (const [id, j] of jobs) {
          jobs.delete(id);
          void mainThread(j.blob, j.size).then(j.done);
        }
      };
      pool.push(w);
    }
  } catch {
    pool = [];
  }
  return pool;
}

/** Decode a tile blob off the main thread (optionally resized to size x size px). */
export function decode(blob: Blob, size = 0): Promise<ImageBitmap | null> {
  const ws = workers();
  if (!ws.length) return mainThread(blob, size);
  const id = nextId++;
  return new Promise((done) => {
    jobs.set(id, { blob, size, done });
    ws[turn++ % ws.length].postMessage({ id, blob, size });
  });
}

// ------------------------------------------------------------------ shared texture cache

interface Entry {
  tex: Texture | null;
  job: Promise<Texture | null> | null;
  refs: number;
  last: number;
  /** Kept for good (the low-res layer under every cut): never evicted. */
  pinned: boolean;
}
const cache = new Map<string, Entry>();
let decoding = 0;
const MAX_DECODING = 8;

const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
/** Unused tiles kept on the GPU (1024 px RGBA = 4 MB each). */
const KEEP = phone ? 24 : 64;

/** The texture for key if it is ready (and marks it used). */
export function cached(key: string): Texture | null {
  const e = cache.get(key);
  if (!e?.tex) return null;
  e.last = performance.now();
  return e.tex;
}

/** Whether key is decoded or being decoded. */
export function known(key: string) {
  return cache.has(key);
}

/** Start decoding key unless it is ready or on its way. False when the pool is full (ask again next frame). */
export function request(key: string, blob: Blob, size = 0, pinned = false): boolean {
  const have = cache.get(key);
  if (have) {
    if (pinned) have.pinned = true;
    return true;
  }
  if (decoding >= MAX_DECODING && !pinned) return false;
  const e: Entry = { tex: null, job: null, refs: 0, last: performance.now(), pinned };
  cache.set(key, e);
  decoding++;
  e.job = decode(blob, size).then((bmp) => {
    decoding--;
    e.job = null;
    if (!bmp || cache.get(key) !== e) {
      bmp?.close();
      if (cache.get(key) === e) cache.delete(key); // asked again later
      return null;
    }
    e.tex = new Texture({ source: new ImageSource({ resource: bmp, alphaMode: "premultiplied-alpha" }) });
    e.last = performance.now();
    return e.tex;
  });
  return true;
}

export function hold(key: string) {
  const e = cache.get(key);
  if (e) e.refs++;
}

export function letGo(key: string) {
  const e = cache.get(key);
  if (e) e.refs = Math.max(0, e.refs - 1);
  evict();
}

function evict() {
  let spare = 0;
  for (const e of cache.values()) if (e.tex && !e.refs && !e.pinned) spare++;
  if (spare <= KEEP) return;
  const old = [...cache.entries()].filter(([, e]) => e.tex && !e.refs && !e.pinned).sort((a, b) => a[1].last - b[1].last);
  for (let k = 0; k < spare - KEEP; k++) {
    const [key, e] = old[k];
    cache.delete(key);
    free(e.tex!);
  }
}

function free(tex: Texture) {
  const res = tex.source.resource as ImageBitmap | null;
  tex.destroy(true);
  res?.close?.();
}

/** Drop every texture whose key starts with prefix and nobody draws (a map of another track went away). */
export function forget(prefix: string) {
  for (const [key, e] of cache) {
    if (!key.startsWith(prefix) || e.refs) continue;
    cache.delete(key);
    if (e.tex) free(e.tex);
  }
}

export function cacheStats() {
  let ready = 0;
  for (const e of cache.values()) if (e.tex) ready++;
  return { textures: ready, decoding };
}

// ------------------------------------------------------------------ budgeted uploads

/** Main-thread milliseconds per frame spent on texture uploads (all maps together). */
const BUDGET_MS = phone ? 3 : 4;
let spent = 0;
let resetQueued = false;

function spend(ms: number) {
  spent += ms;
  if (!resetQueued) {
    resetQueued = true;
    requestAnimationFrame(() => {
      spent = 0;
      resetQueued = false;
    });
  }
}

/** Whether there is upload time left this frame (the first upload of a frame always goes). */
export function canUpload(budget = BUDGET_MS) {
  return spent < budget || spent === 0;
}

/** Upload a texture to this renderer's GPU now (counted against the frame budget). */
export function upload(renderer: Renderer, source: TextureSource) {
  const t0 = performance.now();
  const sys = renderer.texture as unknown as { initSource?: (s: TextureSource) => unknown };
  sys.initSource?.(source);
  spend(Math.max(0.01, performance.now() - t0));
}
