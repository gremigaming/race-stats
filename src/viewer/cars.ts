/**
 * The viewer's car: one top-down 2026-regulation car drawn by us (3.40 m wheelbase, 1.90 m wide,
 * about 5.35 m long, narrower front wing, 18" tyres, wide floor and sidepods), painted per team
 * from public/cars/liveries.json and rendered once per car into a texture. Nose +x, metres,
 * centre origin.
 */
import { Texture } from "pixi.js";
import type { RaceCar } from "./format";

export interface Livery {
  base: string;
  accent: string;
  nose: string;
  /** Second body colour (sidepods and engine cover), for two-tone liveries. */
  side?: string;
  /** Short team code for the timing tower badge. */
  code?: string;
  /** Team logo for the timing tower, relative to the site (public/), when we have one. */
  logo?: string;
}

export const CAR_LENGTH = 5.5; // texture frame, metres (the car itself is ~5.35 m)
export const CAR_WIDTH = 2.0; // the car is 1.90 m over the tyres

const GENERIC: Livery = { base: "#8a8f98", accent: "#d6d9de", nose: "#4a4e55" };
let liveries: Promise<Record<string, Livery>> | null = null;
export const loadLiveries = () =>
  (liveries ??= fetch(`${import.meta.env.BASE_URL}cars/liveries.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: { teams: Record<string, Livery> }) => d.teams)
    .catch(() => ({ generic: GENERIC })));

const TEAM_ORDER = ["mercedes", "ferrari", "red_bull", "williams", "aston_martin", "alpine", "rb", "haas", "mclaren", "sauber"];
/** The 2026 season pack (ids from 476): Sauber's slot is Audi and Cadillac follows (checked against race files, 25 Oct). */
const TEAM_ORDER_26 = ["mercedes", "ferrari", "red_bull", "williams", "aston_martin", "alpine", "rb", "haas", "mclaren", "audi", "cadillac"];

/** "Red Bull Racing '26" -> red_bull, "Racing Bulls" -> rb; else the game's team id. The 2026 pack's Sauber races as Audi. */
export function teamKey(car: RaceCar | undefined): string {
  const t = (car?.team_name ?? "").toLowerCase();
  if (t) {
    if (t.includes("racing bulls") || t.includes("vcarb") || /\brb\b/.test(t)) return "rb";
    if (t.includes("red bull")) return "red_bull";
    if (t.includes("sauber") || t.includes("kick")) return t.includes("'26") ? "audi" : "sauber";
    for (const k of ["mercedes", "ferrari", "williams", "alpine", "haas", "mclaren", "audi", "cadillac"]) if (t.includes(k)) return k;
    if (t.includes("aston")) return "aston_martin";
  }
  const id = car?.team ?? -1;
  if (id >= 0 && id < TEAM_ORDER.length) return TEAM_ORDER[id];
  if (id >= 476 && id < 476 + TEAM_ORDER_26.length) return TEAM_ORDER_26[id - 476];
  return "generic";
}

export function liveryOf(all: Record<string, Livery>, car: RaceCar | undefined): Livery {
  return all[teamKey(car)] ?? all.generic ?? GENERIC;
}

/** Black or white, whichever reads better on this colour. */
export function inkOn(hex: string) {
  const v = parseInt(hex.replace("#", ""), 16);
  const lum = 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum > 150 ? "#0c0e11" : "#ffffff";
}

function shade(hex: string, f: number) {
  const v = parseInt(hex.replace("#", ""), 16);
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? s * (1 + f) : s + (255 - s) * f)));
  return `rgb(${ch((v >> 16) & 255)},${ch((v >> 8) & 255)},${ch(v & 255)})`;
}

type Ctx = CanvasRenderingContext2D;

/** A closed shape from half the outline (y >= 0), mirrored to the other side. */
function sym(ctx: Ctx, pts: [number, number][]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
  for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0], -pts[i][1]);
  ctx.closePath();
}

/** Glossy fill across the car: darker flanks, a light spine. */
function gloss(ctx: Ctx, color: string, half: number) {
  const g = ctx.createLinearGradient(0, -half, 0, half);
  g.addColorStop(0, shade(color, -0.45));
  g.addColorStop(0.3, shade(color, 0.05));
  g.addColorStop(0.5, shade(color, 0.28));
  g.addColorStop(0.7, shade(color, 0.05));
  g.addColorStop(1, shade(color, -0.45));
  return g;
}

function tyre(ctx: Ctx, x: number, y: number, len: number, wid: number) {
  ctx.fillStyle = "#101113";
  ctx.beginPath();
  ctx.roundRect(x - len / 2, y - wid / 2, len, wid, 0.09);
  ctx.fill();
  // tread shine and the sidewall stripe
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(x - len / 2 + 0.05, y - wid / 2 + 0.06, len - 0.1, wid * 0.25);
  ctx.strokeStyle = "#d8d8d8";
  ctx.lineWidth = 0.03;
  ctx.beginPath();
  ctx.moveTo(x - len / 2 + 0.06, y + (y > 0 ? 1 : -1) * (wid / 2 - 0.05));
  ctx.lineTo(x + len / 2 - 0.06, y + (y > 0 ? 1 : -1) * (wid / 2 - 0.05));
  ctx.stroke();
}

function drawCar(ctx: Ctx, l: Livery, number: number | undefined, ppm: number) {
  const dark = "#121316";
  const side = l.side ?? l.base;
  const FA = 1.62; // front axle
  const RA = -1.78; // rear axle (3.40 m wheelbase)
  // suspension arms
  ctx.strokeStyle = "#1c1d21";
  ctx.lineWidth = 0.05;
  for (const [x, y, ix] of [[FA, 0.8, 1.2], [RA, 0.76, -1.45]] as const)
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(x - 0.12, s * y);
      ctx.lineTo(ix, s * 0.22);
      ctx.moveTo(x + 0.12, s * y);
      ctx.lineTo(ix + 0.25, s * 0.2);
      ctx.stroke();
    }
  // 18" tyres: 0.72 m tall, fronts 0.30 m wide, rears 0.375 m, 1.90 m over the outsides
  tyre(ctx, FA, 0.8, 0.72, 0.3);
  tyre(ctx, FA, -0.8, 0.72, 0.3);
  tyre(ctx, RA, 0.7625, 0.72, 0.375);
  tyre(ctx, RA, -0.7625, 0.72, 0.375);
  // floor: wide between the wheels
  ctx.fillStyle = dark;
  sym(ctx, [[-2.35, 0.0], [-2.35, 0.42], [-1.3, 0.56], [-1.15, 0.7], [0.75, 0.72], [1.05, 0.5], [1.3, 0.24], [1.3, 0.0]]);
  ctx.fill();
  // rear wing: simpler 2026 wing, team plane over black endplates
  ctx.fillStyle = gloss(ctx, l.base, 0.52);
  ctx.beginPath();
  ctx.roundRect(-2.72, -0.5, 0.42, 1.0, 0.04);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(-2.74, -0.54, 0.46, 0.07);
  ctx.fillRect(-2.74, 0.47, 0.46, 0.07);
  ctx.fillRect(-2.52, -0.47, 0.05, 0.94);
  // bodywork: broad sidepods with the coke-bottle waist, engine cover
  ctx.fillStyle = gloss(ctx, side, 0.68);
  sym(ctx, [[-2.3, 0.0], [-2.3, 0.15], [-1.55, 0.3], [-0.85, 0.56], [-0.2, 0.67], [0.35, 0.66], [0.7, 0.46], [0.92, 0.24], [1.08, 0.18], [1.08, 0.0]]);
  ctx.fill();
  // sidepod top in the main colour when the livery is two-tone
  if (l.side && l.side !== l.base) {
    ctx.fillStyle = gloss(ctx, l.base, 0.5);
    sym(ctx, [[-1.9, 0.0], [-1.9, 0.12], [-0.8, 0.36], [-0.1, 0.46], [0.5, 0.44], [0.85, 0.22], [1.08, 0.18], [1.08, 0.0]]);
    ctx.fill();
  }
  // sidepod inlets in black, accent flash
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(-0.2, s * 0.5);
    ctx.lineTo(0.38, s * 0.64);
    ctx.lineTo(0.5, s * 0.55);
    ctx.lineTo(-0.05, s * 0.44);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = l.accent;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(-1.65, s * 0.31);
    ctx.lineTo(-0.5, s * 0.58);
    ctx.lineTo(-0.45, s * 0.5);
    ctx.lineTo(-1.55, s * 0.26);
    ctx.closePath();
    ctx.fill();
  }
  // engine cover spine with the airbox
  ctx.fillStyle = shade(l.base, -0.28);
  sym(ctx, [[-2.15, 0.0], [-2.15, 0.06], [-0.4, 0.17], [0.05, 0.21], [0.05, 0.0]]);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-0.18, 0, 0.16, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // nose: shorter and wider than 2025, darker tip
  ctx.fillStyle = gloss(ctx, l.base, 0.24);
  sym(ctx, [[0.92, 0.0], [0.92, 0.22], [1.6, 0.2], [2.15, 0.15], [2.42, 0.1], [2.5, 0.0]]);
  ctx.fill();
  ctx.fillStyle = l.nose;
  sym(ctx, [[2.12, 0.0], [2.12, 0.15], [2.42, 0.1], [2.5, 0.0]]);
  ctx.fill();
  // front wing: 1.90 m span, black main plane, team flaps, accent tip
  ctx.fillStyle = dark;
  sym(ctx, [[2.66, 0.0], [2.38, 0.95], [2.14, 0.95], [2.14, 0.84], [2.38, 0.0]]);
  ctx.fill();
  ctx.fillStyle = gloss(ctx, l.base, 0.92);
  sym(ctx, [[2.6, 0.0], [2.34, 0.84], [2.21, 0.84], [2.46, 0.0]]);
  ctx.fill();
  ctx.fillStyle = l.accent;
  sym(ctx, [[2.66, 0.0], [2.39, 0.88], [2.36, 0.84], [2.62, 0.0]]);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(2.1, 0.87, 0.32, 0.08);
  ctx.fillRect(2.1, -0.95, 0.32, 0.08);
  // race number on the nose, reading across
  if (number !== undefined) {
    ctx.save();
    ctx.translate(1.7, 0);
    ctx.rotate(Math.PI / 2);
    ctx.scale(1 / ppm, 1 / ppm); // fonts under 1 px don't render: draw it in pixels
    ctx.fillStyle = inkOn(l.base);
    ctx.font = `bold ${Math.round(0.3 * ppm)}px Geist Variable, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), 0, 0);
    ctx.restore();
  }
  // cockpit, helmet, halo
  ctx.fillStyle = "#0a0a0c";
  ctx.beginPath();
  ctx.ellipse(0.42, 0, 0.36, 0.21, 0, 0, Math.PI * 2);
  ctx.fill();
  const helmet = ctx.createRadialGradient(0.4, -0.04, 0.02, 0.38, 0, 0.15);
  helmet.addColorStop(0, "#f4ff8a");
  helmet.addColorStop(1, "#8fbf1a");
  ctx.fillStyle = helmet;
  ctx.beginPath();
  ctx.arc(0.38, 0, 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#1a1b1f";
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(0.45, 0, 0.36, 0.24, 0, 0, Math.PI * 2);
  ctx.moveTo(0.81, 0);
  ctx.lineTo(1.0, 0);
  ctx.stroke();
  // a soft highlight over the top, for the glossy look
  const hl = ctx.createLinearGradient(-2.3, 0, 2.5, 0);
  hl.addColorStop(0, "rgba(255,255,255,0)");
  hl.addColorStop(0.55, "rgba(255,255,255,0.10)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  sym(ctx, [[-2.2, 0.0], [-2.2, 0.08], [0.0, 0.1], [2.4, 0.05], [2.4, 0.0]]);
  ctx.fill();
}

const cache = new Map<string, Texture>();

/** The texture of one car (team livery + race number) at `ppm` pixels per metre. */
export function carTexture(l: Livery, number: number | undefined, ppm: number) {
  const key = `${l.base}|${l.accent}|${l.nose}|${l.side ?? ""}|${number ?? ""}|${ppm}`;
  let tex = cache.get(key);
  if (tex) return tex;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(CAR_LENGTH * ppm);
  canvas.height = Math.round(CAR_WIDTH * ppm);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.scale(ppm, ppm);
    ctx.translate(CAR_LENGTH / 2, CAR_WIDTH / 2);
    drawCar(ctx, l, number, ppm);
  }
  tex = Texture.from(canvas);
  cache.set(key, tex);
  return tex;
}

let users = 0;

/** A scene that draws cars (the main view and the picture-in-picture share the textures). */
export function retainCarTextures() {
  users++;
}

/** Drop the textures once the last scene using them is gone. */
export function clearCarTextures() {
  if (--users > 0) return;
  users = 0;
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}
