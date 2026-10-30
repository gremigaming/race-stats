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
 */
import { Container, Sprite, Texture } from "pixi.js";

const TILE = 512;
const MAPS = ["https://maps.gremigaming.com/", "https://gremigaming.github.io/race-stats-maps/"];

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
    img.onload = () => done(img);
    img.onerror = fail;
    img.src = src;
  });
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
  private drawn = new Map<string, { lod: number; sprite: Sprite; over: Sprite[] }>();
  private busy = new Set<string>();
  /** Tiles whose fetch failed, by when they may be tried again. */
  private retryAt = new Map<string, number>();
  private alive = true;
  /** World bounds of the map tiles: [minX, minZ, maxX, maxZ]. */
  bounds: [number, number, number, number] | null = null;

  constructor(track: string) {
    this.view.addChild(this.base, this.sharp);
    void this.loadPhotos(track);
    void this.loadSvgIndex(track);
  }

  destroy() {
    this.alive = false;
    this.view.destroy({ children: true, texture: true });
    this.over.destroy({ children: true, texture: true });
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
    const svg = this.svg;
    if (!svg) return;
    let level = -1;
    if (scale >= 1.2) {
      level = LODS.findIndex((l) => l >= scale * 0.8);
      if (level < 0) level = LODS.length - 1;
    }
    const seen = new Set<string>();
    if (level >= 0) {
      for (let i = Math.floor(x0 / svg.tile); i <= Math.floor(x1 / svg.tile); i++) {
        for (let j = Math.floor(z0 / svg.tile); j <= Math.floor(z1 / svg.tile); j++) {
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
    // tiles far out of view go, so a long session doesn't fill the GPU
    for (const [key, d] of this.drawn) {
      if (seen.has(key)) continue;
      const [i, j] = key.split("_").map(Number);
      const far = (i + 1) * svg.tile < x0 - 400 || i * svg.tile > x1 + 400 || (j + 1) * svg.tile < z0 - 400 || j * svg.tile > z1 + 400;
      if (far || level < 0) {
        this.drop(d);
        this.drawn.delete(key);
      }
    }
  }

  private async draw(key: string, i: number, j: number, files: Record<string, string>, level: number) {
    const svg = this.svg!;
    this.busy.add(key);
    try {
      const px = Math.round(svg.tile * LODS[level]);
      const imgs = await Promise.all(
        svg.layers.filter((l) => files[l] && l !== "over").map((l) => image(`${svg.root}${files[l]}`).catch(() => null)),
      );
      const split = files.over ? await splitOver(`${svg.root}${files.over}`, i, j, svg.tile, this.overheads.filter(fades)).catch(() => null) : null;
      const overImgs = split
        ? await Promise.all([split.solid, ...split.parts.map((p) => p.svg)].map((t) => svgImage(t).catch(() => null)))
        : [];
      if (!this.alive) return;
      const sprite = this.tileSprite(imgs, px, i, j);
      if (!sprite) return;
      const over: Sprite[] = [];
      overImgs.forEach((img, k) => {
        const sp = img && this.tileSprite([img], px, i, j);
        if (!sp) return;
        if (k > 0) {
          const id = split!.parts[k - 1].id;
          sp.label = id;
          sp.alpha = this.roofAlpha.get(id) ?? 1;
          this.roofs.set(id, [...(this.roofs.get(id) ?? []), sp]);
        }
        this.over.addChild(sp);
        over.push(sp);
      });
      // a layer that failed to load is shown without it and fetched again in a few seconds
      const failed = imgs.includes(null) || (!!files.over && (!split || overImgs.includes(null)));
      if (failed) this.retryAt.set(key, performance.now() + 3000);
      else this.retryAt.delete(key);
      const old = this.drawn.get(key);
      this.sharp.addChild(sprite);
      if (old) this.drop(old);
      this.drawn.set(key, { lod: failed ? -1 : level, sprite, over });
    } finally {
      this.busy.delete(key);
    }
  }

  private tileSprite(imgs: (HTMLImageElement | null)[], px: number, i: number, j: number) {
    const svg = this.svg!;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = px;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    for (const img of imgs) if (img) ctx.drawImage(img, 0, 0, px, px);
    const sprite = new Sprite(Texture.from(canvas));
    sprite.position.set(i * svg.tile, j * svg.tile);
    sprite.width = svg.tile;
    sprite.height = svg.tile;
    return sprite;
  }

  private drop(d: { sprite: Sprite; over: Sprite[] }) {
    for (const sp of d.over) {
      if (sp.label) this.roofs.set(sp.label, (this.roofs.get(sp.label) ?? []).filter((x) => x !== sp));
      sp.destroy({ texture: true, textureSource: true });
    }
    d.sprite.destroy({ texture: true, textureSource: true });
  }

  /** How solid a tunnel or roof is drawn (1 solid .. 0 gone). */
  setRoofAlpha(id: string, alpha: number) {
    this.roofAlpha.set(id, alpha);
    for (const sp of this.roofs.get(id) ?? []) sp.alpha = alpha;
  }
}
