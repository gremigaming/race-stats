/**
 * The track under the cars, in world metres (x right, z down), on the GPU.
 *
 * - Base: the game map photo tiles on this site (public/trackmaps, 512 m squares), always loaded.
 * - Sharp layer: the vector maps from gremigaming/race-stats-maps (maps.gremigaming.com, else its
 *   github.io site) once they are published: index.json with 100 m tiles, one SVG per layer.
 *   Tiles in view are rasterised at the zoom level they are shown at, so an apex stays sharp.
 *   Until the maps are published the index is empty and only the base shows.
 * - Over layer ("over" in index.json): what hangs above the road (bridge decks with the road they
 *   carry, tunnel roofs, gantries, tree canopies), drawn above the cars that pass under it.
 *   over.json lists the structures with the height of their underside; tunnel and roof parts get
 *   sprites of their own so they can turn see-through while a car is inside.
 *
 * Smooth playback (no main-thread work while the camera moves to new ground):
 * - The sharp layer comes from the raster pyramid on R2 (maps/<track>/<z>/<x>_<y>.webp, rendered from
 *   the same SVGs by race-stats-maps scripts/pyramid.mjs). The WHOLE track, z 0..3, is downloaded while
 *   the replay opens ("Loading track"), so a camera cut never waits on the network. z 3 is 20 px/m.
 * - The over layer is rasterised once per tile while the replay opens and kept as PNG blobs.
 * - Tiles are decoded in workers (tiles.ts) and uploaded to the GPU inside a per-frame time budget.
 * - z 1 (resized to 512 px, 2.5 px/m) stays on the GPU for the whole track: whatever the director
 *   cuts to, there is always map under it while the sharp tiles of the new spot come in.
 * - When the pyramid isn't reachable, the old path (SVG tiles rasterised in the page) is used.
 */
import { Container, Sprite, Texture, type Renderer, type TextureSource } from "pixi.js";
import { cacheStats, cached, canUpload, forget, hold, known, letGo, request, upload } from "./tiles";

const TILE = 512;
const MAPS = ["https://maps.gremigaming.com/", "https://gremigaming.github.io/race-stats-maps/"];
const PYRAMID = "https://replays.gremigaming.com/maps/";
/** Pyramid levels downloaded up front (z 3 = 20 px/m, sharper than the old 16 px/m SVG rasters). */
const TOP = 3;
/** The level kept on the GPU for the whole track, and the size it is kept at. */
const RESIDENT = 1;
const RESIDENT_PX = 512;
/** Over tiles are rasterised at this size (16 px/m on 100 m tiles) and shown at the nearest of these. */
const OVER_PX = 1600;
const OVER_SIZES = [256, 512, 1024, OVER_PX];

interface PyramidIndex {
  /** v: render time, added to tile URLs so a re-rendered pyramid isn't served from a day-old cache. */
  [track: string]: { px: number; levels: number; tile0: number; v?: number; tiles: Record<string, [number, number][]> };
}

interface PhotoIndex {
  [track: string]: { tiles: [number, number][] };
}
interface SvgIndex {
  [track: string]: {
    tile: number;
    layers: string[];
    tiles: { i: number; j: number; files: Record<string, string> }[];
  };
}

/** A structure over the road, from <track>/over.json (world metres, heights are game y). */
export interface Overhead {
  id: string;
  kind: "bridge" | "tunnel" | "gantry" | "tree" | "roof";
  under: number;
  bbox: [number, number, number, number];
  length_m: number;
}

/** Tunnel roofs and covered buildings turn see-through; bridges and trees never do. */
export const fades = (o: Overhead) => o.kind === "tunnel" || o.kind === "roof";

const norm = (t: string) =>
  t.toLowerCase().replace(/reverse|manual|[^a-z]/g, "").replace(/^sakhir$/, "bahrain");

/** Track name ("Abu Dhabi", "Spa") to its map folder ("abu_dhabi", "spa_francorchamps"). */
export function mapFolder(index: object, track: string) {
  const want = norm(track);
  const rev = /reverse/i.test(track);
  const keys = Object.keys(index).filter((k) => norm(k) === want || norm(k).includes(want) || want.includes(norm(k)));
  return keys.find((k) => /rev/i.test(k) === rev) ?? keys[0];
}

async function json<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

function image(src: string) {
  return new Promise<HTMLImageElement>((done, fail) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    // decoded off the main thread before it is drawn
    img.onload = () => void img.decode().then(() => done(img), () => done(img));
    img.onerror = fail;
    img.src = src;
  });
}

/**
 * Rasterised tiles shared by every map on the page (the main view and the incident picture-in-picture
 * draw the same tiles: rasterised once), freed when the last map lets go.
 */
interface Raster {
  base: Texture;
  /** The over layer: the solid part first (id ""), then each see-through structure. */
  over: { id: string; tex: Texture }[];
  failed: boolean;
  refs: number;
}
const rasters = new Map<string, Raster>();
const rasterJobs = new Map<string, Promise<Raster | null>>();

/**
 * Rasterising an SVG tile and uploading it is the heaviest thing the viewer does on the main thread:
 * at most one per animation frame, so a camera move never stacks several into one long frame.
 */
let rasterQueue: Promise<void> = Promise.resolve();
function rasterTurn(): Promise<void> {
  const turn = rasterQueue.then(() => new Promise<void>((done) => requestAnimationFrame(() => done())));
  rasterQueue = turn;
  return turn;
}

/** Pixels per metre the sharp layer is drawn at, by zoom. */
const LODS = [2, 6, 16];

function svgImage(text: string) {
  return image(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`);
}

/** An over tile split in the part that stays solid and the see-through parts, by structure id. */
async function splitOver(url: string, i: number, j: number, tile: number, fading: Overhead[]) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const doc = new DOMParser().parseFromString(await r.text(), "image/svg+xml");
  const root = doc.documentElement;
  const defs = root.querySelector("defs");
  const ser = new XMLSerializer();
  const parts: { id: string; svg: string }[] = [];
  for (const g of Array.from(root.querySelectorAll('g[data-kind="tunnel"], g[data-kind="roof"]'))) {
    // the exporter's id, else the fading structure of that kind and underside height whose box reaches this tile
    const under = Number(g.getAttribute("data-under"));
    const id =
      g.getAttribute("data-id") ??
      fading.find(
        (o) =>
          o.kind === g.getAttribute("data-kind") &&
          (!Number.isFinite(under) || Math.abs(o.under - under) < 0.05) &&
          o.bbox[0] < (i + 1) * tile && o.bbox[2] > i * tile && o.bbox[1] < (j + 1) * tile && o.bbox[3] > j * tile,
      )?.id;
    if (!id) continue;
    const one = root.cloneNode(false) as Element;
    if (defs) one.appendChild(defs.cloneNode(true));
    one.appendChild(g.cloneNode(true));
    parts.push({ id, svg: ser.serializeToString(one) });
    g.remove();
  }
  return { solid: ser.serializeToString(root), parts };
}

/**
 * The whole sharp map of one track, compressed, in memory: every pyramid tile up to TOP and every
 * over tile (rasterised once). Shared by all maps on the page; ~10-20 MB per track.
 */
interface Pyramid {
  folder: string;
  tile0: number;
  px: number;
  /** "z/x_y" -> WebP */
  files: Map<string, Blob>;
  /** z -> tiles at that level that exist */
  levels: Map<number, [number, number][]>;
  /** over tile "i_j" -> solid part (id "") and see-through parts */
  over: Map<string, { id: string; blob: Blob }[]>;
  overTile: number;
  total: number;
  done: number;
  ready: Promise<boolean>;
  users: number;
}
const pyramids = new Map<string, Pyramid>();
let pyramidIndex: Promise<PyramidIndex | null> | null = null;

/** Run jobs with at most n at a time. */
async function inParallel<T>(items: T[], n: number, job: (t: T) => Promise<void>) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) await job(items[next++]);
    }),
  );
}

async function blob(url: string): Promise<Blob | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url);
      if (r.ok) return await r.blob();
      if (r.status === 404) return null;
    } catch {
      /* try again */
    }
    await new Promise((ok) => setTimeout(ok, 300 * (attempt + 1)));
  }
  return null;
}

function frame() {
  return new Promise<void>((ok) => requestAnimationFrame(() => ok()));
}

function pngOf(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
}

/** Start (or join) loading the pyramid of a track. Null when R2 has none for it. */
async function pyramidFor(
  track: string,
  svg: { root: string; tile: number; tiles: Map<string, Record<string, string>> } | null,
  overheads: Overhead[],
): Promise<Pyramid | null> {
  const index = await (pyramidIndex ??= json<PyramidIndex>(`${PYRAMID}index.json`).then((x) => {
    if (!x) pyramidIndex = null; // try again next time a map opens
    return x;
  }));
  const folder = index && mapFolder(index, track);
  if (!index || !folder) return null;
  const loaded = pyramids.get(folder);
  if (loaded) return loaded;
  const m = index[folder];
  const levels = new Map<number, [number, number][]>();
  for (let z = 0; z <= Math.min(TOP, m.levels - 1); z++) levels.set(z, m.tiles[String(z)] ?? []);
  const overTiles = svg ? [...svg.tiles].filter(([, f]) => f.over) : [];
  const p: Pyramid = {
    folder,
    tile0: m.tile0,
    px: m.px,
    files: new Map(),
    levels,
    over: new Map(),
    overTile: svg?.tile ?? 100,
    total: [...levels.values()].reduce((n, l) => n + l.length, 0) + overTiles.length,
    done: 0,
    ready: Promise.resolve(false),
    users: 0,
  };
  const all: [number, number, number][] = [];
  // coarse levels first: the resident layer is ready soonest
  for (const [z, l] of levels) for (const [x, y] of l) all.push([z, x, y]);
  p.ready = (async () => {
    await inParallel(all, 12, async ([z, x, y]) => {
      const b = await blob(`${PYRAMID}${folder}/${z}/${x}_${y}.webp${m.v ? `?v=${m.v}` : ""}`);
      if (b) p.files.set(`${z}/${x}_${y}`, b);
      p.done++;
    });
    // the over layer: rasterised here, once, while the replay opens (one tile part per frame)
    if (svg && overTiles.length) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = OVER_PX;
      const ctx = canvas.getContext("2d");
      for (const [key, files] of overTiles) {
        const [i, j] = key.split("_").map(Number);
        const split = await splitOver(`${svg.root}${files.over}`, i, j, svg.tile, overheads.filter(fades)).catch(() => null);
        if (split && ctx) {
          const imgs = await Promise.all([split.solid, ...split.parts.map((q) => q.svg)].map((t) => svgImage(t).catch(() => null)));
          const parts: { id: string; blob: Blob }[] = [];
          for (let k = 0; k < imgs.length; k++) {
            const img = imgs[k];
            if (!img) continue;
            await frame();
            ctx.clearRect(0, 0, OVER_PX, OVER_PX);
            ctx.drawImage(img, 0, 0, OVER_PX, OVER_PX);
            const png = await pngOf(canvas);
            if (png) parts.push({ id: k > 0 ? split.parts[k - 1].id : "", blob: png });
          }
          p.over.set(key, parts);
        }
        p.done++;
      }
    }
    return p.files.size > 0;
  })();
  pyramids.set(folder, p);
  return p;
}

/** A tile on this map: its sprites and the shared raster they show (or its own, when a layer failed). */
interface Drawn {
  lod: number;
  sprite: Sprite;
  over: Sprite[];
  raster: string | null;
  own: Raster | null;
  i: number;
  j: number;
}

function canvasTexture(imgs: (HTMLImageElement | null)[], px: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  for (const img of imgs) if (img) ctx.drawImage(img, 0, 0, px, px);
  return Texture.from(canvas);
}

function release(r: Raster) {
  r.base.destroy(true);
  for (const o of r.over) o.tex.destroy(true);
}

export class TrackMap {
  readonly view = new Container();
  /** Drawn by the scene between the cars below and the cars above. */
  readonly over = new Container();
  /** Structures over the road (empty until over.json loads, or for tracks without one). */
  overheads: Overhead[] = [];
  private roofs = new Map<string, Sprite[]>();
  private roofAlpha = new Map<string, number>();
  private base = new Container();
  private sharp = new Container();
  private svg: { root: string; tile: number; layers: string[]; tiles: Map<string, Record<string, string>> } | null = null;
  private drawn = new Map<string, Drawn>();
  private busy = new Set<string>();
  private seen = new Set<string>();
  /** Tiles whose fetch failed, by when they may be tried again. */
  private retryAt = new Map<string, number>();
  private alive = true;
  /** World bounds of the map tiles: [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number] | null = null;

  // pyramid path (see the top of this file)
  private mode: "loading" | "pyramid" | "svg" = "loading";
  private pyr: Pyramid | null = null;
  private renderer: Renderer | null = null;
  private resolution = 1;
  private uploaded = new WeakSet<TextureSource>();
  private resident = new Container();
  private residentKeys: string[] = [];
  private residentShown = new Set<string>();
  private residentTries = new Map<string, number>();
  /** Sharp tiles drawn, by "z/x_y". */
  private shown = new Map<string, { sprite: Sprite; z: number; x: number; y: number; cacheKey: string }>();
  /** Over tiles drawn, by "i_j": the size they are shown at and their part sprites. */
  private overShown = new Map<string, { size: number; sprites: Sprite[]; keys: string[] }>();
  private want = new Set<string>();
  private missing: { key: string; d: number; z: number; x: number; y: number }[] = [];
  private photosUploaded = false;

  constructor(track: string) {
    this.view.addChild(this.base, this.resident, this.sharp);
    this.sharp.sortableChildren = true;
    void this.loadPhotos(track);
    void this.load(track);
  }

  /** The renderer that draws this map: tiles are uploaded to it by hand, inside the frame budget. */
  attach(renderer: Renderer) {
    this.renderer = renderer;
    this.resolution = renderer.resolution || 1;
  }

  /** 0..1 while the whole-track map loads; 1 once a camera cut can never wait on it. */
  progress(): number {
    if (this.mode === "svg") return 1;
    if (this.mode === "loading" || !this.pyr) return this.pyr ? (0.85 * this.pyr.done) / Math.max(1, this.pyr.total) : 0;
    const res = this.residentKeys.length ? this.residentShown.size / this.residentKeys.length : 1;
    return Math.min(1, 0.85 + 0.15 * res * (this.photosUploaded ? 1 : 0.9));
  }

  get ready() {
    return this.progress() >= 1;
  }

  private async load(track: string) {
    await this.loadSvgIndex(track);
    const p = await pyramidFor(track, this.svg, this.overheads).catch(() => null);
    if (!this.alive) return;
    if (!p) {
      this.mode = "svg";
      return;
    }
    this.pyr = p;
    p.users++;
    const ok = await p.ready;
    if (!this.alive) return;
    if (!ok) {
      this.mode = "svg";
      return;
    }
    for (const [x, y] of p.levels.get(RESIDENT) ?? []) {
      const key = `${RESIDENT}/${x}_${y}`;
      const b = p.files.get(key);
      if (!b) continue;
      this.residentKeys.push(key);
      request(`${p.folder}/${key}@${RESIDENT_PX}`, b, RESIDENT_PX, true);
    }
    this.mode = "pyramid";
  }

  destroy() {
    this.alive = false;
    for (const d of this.drawn.values()) this.drop(d);
    this.drawn.clear();
    for (const t of this.shown.values()) letGo(t.cacheKey);
    this.shown.clear();
    for (const o of this.overShown.values()) for (const k of o.keys) letGo(k);
    this.overShown.clear();
    if (this.pyr && --this.pyr.users <= 0) {
      // the last map of this track: free its GPU tiles (the compressed files stay for a quick reopen)
      forget(`${this.pyr.folder}/`);
      forget(`over:${this.pyr.folder}/`);
    }
    // the photo tiles are this map's own
    this.view.destroy({ children: true, texture: true, textureSource: true });
    this.over.destroy({ children: true });
  }

  private async loadPhotos(track: string) {
    const index = await json<PhotoIndex>(`${import.meta.env.BASE_URL}trackmaps/index.json`);
    const folder = index && mapFolder(index, track);
    if (!index || !folder || !this.alive) return;
    let b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [i, j] of index[folder].tiles) {
      b = [Math.min(b[0], i * TILE), Math.min(b[1], j * TILE), Math.max(b[2], (i + 1) * TILE), Math.max(b[3], (j + 1) * TILE)];
      image(`${import.meta.env.BASE_URL}trackmaps/${folder}/${i}_${j}.jpg`)
        .then((img) => {
          if (!this.alive) return;
          const s = new Sprite(Texture.from(img));
          s.position.set(i * TILE, j * TILE);
          s.width = TILE;
          s.height = TILE;
          this.base.addChild(s);
        })
        .catch(() => undefined);
    }
    this.bounds = b;
  }

  private async loadSvgIndex(track: string) {
    for (const root of MAPS) {
      const index = await json<SvgIndex>(`${root}index.json`);
      const folder = index && mapFolder(index, track);
      if (!index || !folder || !this.alive) continue;
      const m = index[folder];
      if (!m.tiles?.length) continue;
      this.svg = {
        root: `${root}${folder}/`,
        tile: m.tile,
        layers: m.layers,
        tiles: new Map(m.tiles.map((t) => [`${t.i}_${t.j}`, t.files])),
      };
      if (m.layers.includes("over")) {
        const o = await json<Overhead[]>(`${root}${folder}/over.json`);
        if (o && this.alive) this.overheads = o;
      }
      return;
    }
  }

  /** Called every frame with the visible world rectangle and the zoom (pixels per metre). */
  update(x0: number, z0: number, x1: number, z1: number, scale: number) {
    const loading = this.mode !== "svg" && !this.ready;
    // photo tiles outside the screen aren't drawn (each is its own texture: fewer draw calls);
    // all of them go to the GPU while the map loads, a late one only inside the frame budget
    let photosUp = true;
    for (const sp of this.base.children as Sprite[]) {
      const src = sp.texture.source;
      const up = this.isUp(src) || (canUpload(loading ? 12 : undefined) && this.up(src));
      if (!up) photosUp = false;
      const vis = up && sp.x + TILE > x0 && sp.x < x1 && sp.y + TILE > z0 && sp.y < z1;
      if (sp.visible !== vis) sp.visible = vis;
    }
    this.photosUploaded = photosUp;
    if (this.mode === "pyramid") return this.updatePyramid(x0, z0, x1, z1, scale, loading);
    if (this.mode !== "svg") return;
    const svg = this.svg;
    if (!svg) return;
    let level = -1;
    if (scale >= 1.2) {
      level = LODS.findIndex((l) => l >= scale * 0.8);
      if (level < 0) level = LODS.length - 1;
    }
    const seen = this.seen;
    seen.clear();
    if (level >= 0) {
      // one tile beyond the screen edge too: rasterised before it scrolls into view
      for (let i = Math.floor(x0 / svg.tile) - 1; i <= Math.floor(x1 / svg.tile) + 1; i++) {
        for (let j = Math.floor(z0 / svg.tile) - 1; j <= Math.floor(z1 / svg.tile) + 1; j++) {
          const key = `${i}_${j}`;
          const files = svg.tiles.get(key);
          if (!files) continue;
          seen.add(key);
          const have = this.drawn.get(key);
          if ((!have || have.lod < level) && !this.busy.has(key) && this.busy.size < 6 && (this.retryAt.get(key) ?? 0) <= performance.now())
            void this.draw(key, i, j, files, level);
        }
      }
    }
    // tiles far out of view go, so a long session doesn't fill the GPU; kept ones outside the screen aren't drawn
    const T = svg.tile;
    for (const [key, d] of this.drawn) {
      const { i, j } = d;
      const vis = (i + 1) * T > x0 && i * T < x1 && (j + 1) * T > z0 && j * T < z1;
      if (d.sprite.visible !== vis) {
        d.sprite.visible = vis;
        for (const sp of d.over) sp.visible = vis;
      }
      if (seen.has(key)) continue;
      const far = (i + 1) * svg.tile < x0 - 400 || i * svg.tile > x1 + 400 || (j + 1) * svg.tile < z0 - 400 || j * svg.tile > z1 + 400;
      if (far || level < 0) {
        this.drop(d);
        this.drawn.delete(key);
      }
    }
  }

  private isUp(src: TextureSource) {
    return !this.renderer || this.uploaded.has(src);
  }

  /** Upload to this map's renderer now (true when done). */
  private up(src: TextureSource) {
    if (!this.renderer) return true;
    if (this.uploaded.has(src)) return true;
    upload(this.renderer, src);
    this.uploaded.add(src);
    return true;
  }

  /** A texture that is decoded and on this renderer's GPU (uploading it if the frame budget allows). */
  private gpu(cacheKey: string, budget?: number): Texture | null {
    const tex = cached(cacheKey);
    if (!tex) return null;
    if (this.isUp(tex.source)) return tex;
    if (!canUpload(budget)) return null;
    this.up(tex.source);
    return tex;
  }

  private updatePyramid(x0: number, z0: number, x1: number, z1: number, scale: number, loading: boolean) {
    const p = this.pyr!;
    const budget = loading ? 12 : undefined;
    // the resident layer: the whole track, always
    if (this.residentShown.size < this.residentKeys.length) {
      for (const key of this.residentKeys) {
        if (this.residentShown.has(key)) continue;
        const cacheKey = `${p.folder}/${key}@${RESIDENT_PX}`;
        const tex = this.gpu(cacheKey, budget);
        if (!tex) {
          // a decode that failed is tried again a few times, then left out (the photo map shows there)
          if (!known(cacheKey)) {
            request(cacheKey, p.files.get(key)!, RESIDENT_PX, true);
            const tries = (this.residentTries.get(key) ?? 0) + 1;
            this.residentTries.set(key, tries);
            if (tries > 3) this.residentShown.add(key);
          }
          continue;
        }
        const [x, y] = key.slice(2).split("_").map(Number);
        const size = p.tile0 / 2 ** RESIDENT;
        const sp = new Sprite(tex);
        sp.position.set(x * size, y * size);
        sp.scale.set(size / tex.width, size / tex.height);
        this.resident.addChild(sp);
        this.residentShown.add(key);
      }
    }
    for (const sp of this.resident.children) {
      const vis = sp.x + sp.width > x0 && sp.x < x1 && sp.y + sp.height > z0 && sp.y < z1;
      if (sp.visible !== vis) sp.visible = vis;
    }

    // the sharp level for this zoom (device pixels per metre); none when the resident layer is sharp enough
    const need = scale * this.resolution * 0.8;
    const pxm = (z: number) => p.px / (p.tile0 / 2 ** z);
    let level = -1;
    if (need > RESIDENT_PX / (p.tile0 / 2 ** RESIDENT)) {
      level = TOP;
      for (let z = RESIDENT + 1; z <= TOP; z++)
        if (pxm(z) >= need) {
          level = z;
          break;
        }
      if (!p.levels.has(level)) level = Math.max(...p.levels.keys());
    }
    const want = this.want;
    want.clear();
    const missing = this.missing;
    missing.length = 0;
    let complete = true;
    if (level > RESIDENT) {
      const T = p.tile0 / 2 ** level;
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      // one tile beyond the screen edge too, so it is ready before it scrolls in
      for (let x = Math.floor(x0 / T) - 1; x <= Math.floor(x1 / T) + 1; x++) {
        for (let y = Math.floor(z0 / T) - 1; y <= Math.floor(z1 / T) + 1; y++) {
          const key = `${level}/${x}_${y}`;
          if (!p.files.has(key)) continue;
          want.add(key);
          if (this.shown.has(key)) continue;
          const onScreen = (x + 1) * T > x0 && x * T < x1 && (y + 1) * T > z0 && y * T < z1;
          if (onScreen) complete = false;
          missing.push({ key, d: Math.hypot((x + 0.5) * T - cx, (y + 0.5) * T - cz) - (onScreen ? 1e6 : 0), z: level, x, y });
        }
      }
      if (missing.length) {
        missing.sort((a, b) => a.d - b.d);
        for (const m of missing) {
          const cacheKey = `${p.folder}/${m.key}`;
          const tex = this.gpu(cacheKey, budget);
          if (!tex) {
            if (!known(cacheKey)) request(cacheKey, p.files.get(m.key)!);
            continue;
          }
          const sp = new Sprite(tex);
          sp.position.set(m.x * T, m.y * T);
          sp.scale.set(T / tex.width, T / tex.height);
          sp.zIndex = m.z;
          this.sharp.addChild(sp);
          hold(cacheKey);
          this.shown.set(m.key, { sprite: sp, z: m.z, x: m.x, y: m.y, cacheKey });
        }
        // anything still missing on screen keeps the old level's tiles under it a little longer
        complete = true;
        for (const m of missing) if (m.d < -1e5 && !this.shown.has(m.key)) complete = false;
      }
    }
    // tiles of another level go once this level covers the screen; far ones of this level go too
    for (const [key, t] of this.shown) {
      const T = p.tile0 / 2 ** t.z;
      const vis = (t.x + 1) * T > x0 && t.x * T < x1 && (t.y + 1) * T > z0 && t.y * T < z1;
      if (t.sprite.visible !== vis) t.sprite.visible = vis;
      if (want.has(key)) continue;
      const gone = t.z !== level ? complete : (t.x + 2) * T < x0 || (t.x - 1) * T > x1 || (t.y + 2) * T < z0 || (t.y - 1) * T > z1;
      if (gone || level <= RESIDENT) {
        t.sprite.destroy();
        letGo(t.cacheKey);
        this.shown.delete(key);
      }
    }
    this.updateOver(x0, z0, x1, z1, need, budget);
  }

  /** The over layer from its preloaded blobs, at the size closest to the zoom. */
  private updateOver(x0: number, z0: number, x1: number, z1: number, need: number, budget?: number) {
    const p = this.pyr!;
    if (!p.over.size) return;
    const T = p.overTile;
    const size = OVER_SIZES.find((s) => s / T >= need) ?? OVER_PX;
    const ring = T;
    for (const [key, parts] of p.over) {
      const [i, j] = key.split("_").map(Number);
      const near = (i + 1) * T > x0 - ring && i * T < x1 + ring && (j + 1) * T > z0 - ring && j * T < z1 + ring;
      const have = this.overShown.get(key);
      if (!near) {
        if (have && ((i + 2) * T < x0 || (i - 1) * T > x1 || (j + 2) * T < z0 || (j - 1) * T > z1)) this.dropOver(key);
        else if (have) for (const sp of have.sprites) sp.visible = false;
        continue;
      }
      if (have) for (const sp of have.sprites) sp.visible = true;
      if (have?.size === size || !parts.length) continue;
      // every part of the tile at the new size, decoded and uploaded, before it replaces the old one
      const keys = parts.map((_, k) => `over:${p.folder}/${key}/${k}@${size}`);
      let all = true;
      const texs: Texture[] = [];
      for (let k = 0; k < parts.length; k++) {
        const tex = this.gpu(keys[k], budget);
        if (tex) texs.push(tex);
        else {
          all = false;
          if (!known(keys[k])) request(keys[k], parts[k].blob, size);
        }
      }
      if (!all) continue;
      if (have) this.dropOver(key);
      const sprites: Sprite[] = [];
      for (let k = 0; k < parts.length; k++) {
        const sp = this.tileSprite(texs[k], i, j, T);
        const id = parts[k].id;
        if (id) {
          sp.label = id;
          sp.alpha = this.roofAlpha.get(id) ?? 1;
          this.roofs.set(id, [...(this.roofs.get(id) ?? []), sp]);
        }
        this.over.addChild(sp);
        hold(keys[k]);
        sprites.push(sp);
      }
      this.overShown.set(key, { size, sprites, keys });
    }
  }

  private dropOver(key: string) {
    const o = this.overShown.get(key);
    if (!o) return;
    for (const sp of o.sprites) {
      if (sp.label) this.roofs.set(sp.label, (this.roofs.get(sp.label) ?? []).filter((x) => x !== sp));
      sp.destroy();
    }
    for (const k of o.keys) letGo(k);
    this.overShown.delete(key);
  }

  private async draw(key: string, i: number, j: number, files: Record<string, string>, level: number) {
    const svg = this.svg!;
    this.busy.add(key);
    try {
      const id = `${svg.root}${key}@${level}`;
      let r = rasters.get(id) ?? null;
      if (!r) {
        let job = rasterJobs.get(id);
        if (!job) {
          job = this.raster(i, j, files, level).finally(() => rasterJobs.delete(id));
          rasterJobs.set(id, job);
        }
        r = await job;
        if (r && !r.failed) rasters.set(id, r);
      }
      if (!this.alive || !r) return;
      r.refs++;
      const sprite = this.tileSprite(r.base, i, j);
      const over: Sprite[] = [];
      for (const o of r.over) {
        const sp = this.tileSprite(o.tex, i, j);
        if (o.id) {
          sp.label = o.id;
          sp.alpha = this.roofAlpha.get(o.id) ?? 1;
          this.roofs.set(o.id, [...(this.roofs.get(o.id) ?? []), sp]);
        }
        this.over.addChild(sp);
        over.push(sp);
      }
      // a layer that failed to load is shown without it and fetched again in a few seconds
      if (r.failed) this.retryAt.set(key, performance.now() + 3000);
      else this.retryAt.delete(key);
      const old = this.drawn.get(key);
      this.sharp.addChild(sprite);
      if (old) this.drop(old);
      this.drawn.set(key, { lod: r.failed ? -1 : level, sprite, over, raster: r.failed ? null : id, own: r.failed ? r : null, i, j });
    } finally {
      this.busy.delete(key);
    }
  }

  /** Fetch a tile's layers and rasterise them at this level (one canvas per frame at most). */
  private async raster(i: number, j: number, files: Record<string, string>, level: number): Promise<Raster | null> {
    const svg = this.svg!;
    const px = Math.round(svg.tile * LODS[level]);
    const imgs = await Promise.all(
      svg.layers.filter((l) => files[l] && l !== "over").map((l) => image(`${svg.root}${files[l]}`).catch(() => null)),
    );
    const split = files.over ? await splitOver(`${svg.root}${files.over}`, i, j, svg.tile, this.overheads.filter(fades)).catch(() => null) : null;
    const overImgs = split
      ? await Promise.all([split.solid, ...split.parts.map((p) => p.svg)].map((t) => svgImage(t).catch(() => null)))
      : [];
    if (!this.alive) return null;
    await rasterTurn();
    const base = canvasTexture(imgs, px);
    if (!base) return null;
    const over: Raster["over"] = [];
    for (let k = 0; k < overImgs.length; k++) {
      const img = overImgs[k];
      if (!img) continue;
      await rasterTurn();
      const tex = canvasTexture([img], px);
      if (tex) over.push({ id: k > 0 ? split!.parts[k - 1].id : "", tex });
    }
    const failed = imgs.includes(null) || (!!files.over && (!split || overImgs.includes(null)));
    return { base, over, failed, refs: 0 };
  }

  private tileSprite(tex: Texture, i: number, j: number, tile = this.svg!.tile) {
    const sprite = new Sprite(tex);
    sprite.position.set(i * tile, j * tile);
    sprite.scale.set(tile / tex.width, tile / tex.height);
    return sprite;
  }

  private drop(d: Drawn) {
    for (const sp of d.over) {
      if (sp.label) this.roofs.set(sp.label, (this.roofs.get(sp.label) ?? []).filter((x) => x !== sp));
      sp.destroy();
    }
    d.sprite.destroy();
    if (d.own) {
      if (--d.own.refs <= 0) release(d.own);
    }
    else if (d.raster) {
      const r = rasters.get(d.raster);
      if (r && --r.refs <= 0) {
        rasters.delete(d.raster);
        release(r);
      }
    }
  }

  stats() {
    let shown = 0;
    for (const d of this.drawn.values()) if (d.sprite.visible) shown++;
    if (this.mode === "pyramid") for (const t of this.shown.values()) if (t.sprite.visible) shown++;
    return {
      mapMode: this.mode,
      photoTiles: this.base.children.filter((c) => c.visible).length,
      sharpTiles: shown,
      kept: this.drawn.size + this.shown.size,
      rasters: rasters.size,
      ...cacheStats(),
    };
  }

  /** How solid a tunnel or roof is drawn (1 solid .. 0 gone). */
  setRoofAlpha(id: string, alpha: number) {
    this.roofAlpha.set(id, alpha);
    for (const sp of this.roofs.get(id) ?? []) sp.alpha = alpha;
  }
}
