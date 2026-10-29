/**
 * The viewer's car: one top-down 2025-shape car drawn by us (after GreMi's reference: glossy
 * team bodywork, black floor and halo, long nose with the race number, wide wings), painted per
 * team from public/cars/liveries.json and rendered once per car into a texture. Nose +x, metres,
 * centre origin.
 */
import { Texture } from "pixi.js";
import type { RaceCar } from "./format";

export interface Livery {
  base: string;
  accent: string;
  nose: string;
}

export const CAR_LENGTH = 5.9; // texture frame, metres (the car itself is 5.7 m)
export const CAR_WIDTH = 2.3;

const GENERIC: Livery = { base: "#8a8f98", accent: "#d6d9de", nose: "#4a4e55" };
let liveries: Promise<Record<string, Livery>> | null = null;
export const loadLiveries = () =>
  (liveries ??= fetch(`${import.meta.env.BASE_URL}cars/liveries.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: { teams: Record<string, Livery> }) => d.teams)
    .catch(() => ({ generic: GENERIC })));

const TEAM_ORDER = ["mercedes", "ferrari", "red_bull", "williams", "aston_martin", "alpine", "rb", "haas", "mclaren", "sauber", "audi", "cadillac"];

/** "Red Bull Racing '26" -> red_bull, "Racing Bulls" -> rb; else the game's team id. */
export function teamKey(car: RaceCar | undefined): string {
  const t = (car?.team_name ?? "").toLowerCase();
  if (t) {
    if (t.includes("racing bulls") || t.includes("vcarb") || /\brb\b/.test(t)) return "rb";
    if (t.includes("red bull")) return "red_bull";
    for (const k of ["mercedes", "ferrari", "williams", "alpine", "haas", "mclaren", "sauber", "audi", "cadillac"])
      if (t.includes(k)) return k;
    if (t.includes("aston")) return "aston_martin";
    if (t.includes("kick")) return "sauber";
  }
  const id = car?.team ?? -1;
  if (id >= 0 && id < TEAM_ORDER.length) return TEAM_ORDER[id];
  if (id >= 476 && id < 476 + TEAM_ORDER.length) return TEAM_ORDER[id - 476];
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
  // suspension arms
  ctx.strokeStyle = "#1c1d21";
  ctx.lineWidth = 0.05;
  for (const [x, y, ix] of [[1.62, 0.8, 1.2], [-1.75, 0.8, -1.45]] as const)
    for (const s of [1, -1]) {
      ctx.beginPath();
      ctx.moveTo(x - 0.12, s * y);
      ctx.lineTo(ix, s * 0.2);
      ctx.moveTo(x + 0.12, s * y);
      ctx.lineTo(ix + 0.25, s * 0.18);
      ctx.stroke();
    }
  tyre(ctx, 1.62, 0.8, 0.66, 0.38);
  tyre(ctx, 1.62, -0.8, 0.66, 0.38);
  tyre(ctx, -1.75, 0.79, 0.76, 0.44);
  tyre(ctx, -1.75, -0.79, 0.76, 0.44);
  // floor
  ctx.fillStyle = dark;
  sym(ctx, [[-2.3, 0.0], [-2.3, 0.38], [-1.35, 0.66], [0.55, 0.74], [0.95, 0.5], [1.25, 0.2], [1.25, 0.0]]);
  ctx.fill();
  // rear wing: team-colour plane, black endplates and DRS flap line
  ctx.fillStyle = gloss(ctx, l.base, 0.6);
  ctx.beginPath();
  ctx.roundRect(-2.85, -0.58, 0.48, 1.16, 0.04);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(-2.85, -0.62, 0.5, 0.07);
  ctx.fillRect(-2.85, 0.55, 0.5, 0.07);
  ctx.fillRect(-2.62, -0.55, 0.05, 1.1);
  // bodywork: sidepods with the coke-bottle waist, engine cover
  ctx.fillStyle = gloss(ctx, l.base, 0.66);
  sym(ctx, [[-2.35, 0.0], [-2.35, 0.13], [-1.6, 0.27], [-0.8, 0.5], [-0.15, 0.64], [0.35, 0.62], [0.7, 0.42], [0.9, 0.22], [1.05, 0.17], [1.05, 0.0]]);
  ctx.fill();
  // sidepod undercut and inlet in black, accent flash
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(-0.9, s * 0.48);
    ctx.lineTo(0.3, s * 0.6);
    ctx.lineTo(0.45, s * 0.52);
    ctx.lineTo(-0.7, s * 0.4);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = l.accent;
  for (const s of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(-1.6, s * 0.29);
    ctx.lineTo(-0.6, s * 0.47);
    ctx.lineTo(-0.55, s * 0.41);
    ctx.lineTo(-1.5, s * 0.25);
    ctx.closePath();
    ctx.fill();
  }
  // engine cover spine with the airbox
  ctx.fillStyle = shade(l.base, -0.3);
  sym(ctx, [[-2.2, 0.0], [-2.2, 0.05], [-0.4, 0.16], [0.05, 0.2], [0.05, 0.0]]);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.ellipse(-0.18, 0, 0.16, 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  // nose: long, team colour, darker tip
  ctx.fillStyle = gloss(ctx, l.base, 0.2);
  sym(ctx, [[0.9, 0.0], [0.9, 0.2], [1.6, 0.17], [2.2, 0.12], [2.55, 0.08], [2.62, 0.0]]);
  ctx.fill();
  ctx.fillStyle = l.nose;
  sym(ctx, [[2.2, 0.0], [2.2, 0.12], [2.55, 0.08], [2.62, 0.0]]);
  ctx.fill();
  // front wing: a chevron swept back from the nose, team colour over a black main plane
  ctx.fillStyle = dark;
  sym(ctx, [[2.82, 0.0], [2.44, 0.98], [2.2, 0.98], [2.2, 0.86], [2.5, 0.0]]);
  ctx.fill();
  ctx.fillStyle = gloss(ctx, l.base, 0.96);
  sym(ctx, [[2.74, 0.0], [2.4, 0.86], [2.27, 0.86], [2.58, 0.0]]);
  ctx.fill();
  ctx.fillStyle = l.accent;
  sym(ctx, [[2.8, 0.0], [2.45, 0.9], [2.42, 0.86], [2.76, 0.0]]);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.fillRect(2.18, 0.9, 0.3, 0.08);
  ctx.fillRect(2.18, -0.98, 0.3, 0.08);
  // race number on the nose, reading across like the reference
  if (number !== undefined) {
    ctx.save();
    ctx.translate(1.72, 0);
    ctx.rotate(Math.PI / 2);
    ctx.scale(1 / ppm, 1 / ppm); // fonts under 1 px don't render: draw it in pixels
    ctx.fillStyle = inkOn(l.base);
    ctx.font = `bold ${Math.round(0.28 * ppm)}px Geist Variable, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), 0, 0);
    ctx.restore();
  }
  // cockpit, helmet, halo
  ctx.fillStyle = "#0a0a0c";
  ctx.beginPath();
  ctx.ellipse(0.42, 0, 0.36, 0.2, 0, 0, Math.PI * 2);
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
  ctx.ellipse(0.45, 0, 0.36, 0.23, 0, 0, Math.PI * 2);
  ctx.moveTo(0.81, 0);
  ctx.lineTo(1.0, 0);
  ctx.stroke();
  // a soft highlight over the top, for the glossy look
  const hl = ctx.createLinearGradient(-2.4, 0, 2.6, 0);
  hl.addColorStop(0, "rgba(255,255,255,0)");
  hl.addColorStop(0.55, "rgba(255,255,255,0.10)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  sym(ctx, [[-2.3, 0.0], [-2.3, 0.08], [0.0, 0.1], [2.5, 0.05], [2.5, 0.0]]);
  ctx.fill();
}

const cache = new Map<string, Texture>();

/** The texture of one car (team livery + race number) at `ppm` pixels per metre. */
export function carTexture(l: Livery, number: number | undefined, ppm: number) {
  const key = `${l.base}|${l.accent}|${l.nose}|${number ?? ""}|${ppm}`;
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

export function clearCarTextures() {
  for (const t of cache.values()) t.destroy(true);
  cache.clear();
}
