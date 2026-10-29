/**
 * The viewer's car: one top-down 2025-shape car drawn as vector art (nose +x, metres, centre
 * origin), painted per team from public/cars/liveries.json and rendered once into textures.
 */
import { Graphics, Rectangle, type Renderer, type Texture } from "pixi.js";
import type { RaceCar } from "./format";

export interface Livery {
  base: string;
  accent: string;
  nose: string;
}

export const CAR_LENGTH = 5.8; // texture frame, metres (the car itself is 5.6 m)
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

const mirror = (pts: number[][]) => {
  const out = pts.flat();
  for (let i = pts.length - 1; i >= 0; i--) out.push(pts[i][0], -pts[i][1]);
  return out;
};

/** Draw the car at `s` pixels per metre. */
function drawCar(l: Livery, s: number) {
  const g = new Graphics();
  const P = (pts: number[]) => pts.map((v) => v * s);
  const R = (x: number, y: number, w: number, h: number) => [x * s, y * s, w * s, h * s] as const;
  const dark = "#141518";
  // tyres
  for (const [x, y] of [[1.72, 0.8], [1.72, -0.8], [-1.68, 0.8], [-1.68, -0.8]]) {
    g.roundRect(...R(x - 0.36, y - 0.2, 0.72, 0.4), 0.08 * s).fill(dark);
  }
  // suspension arms
  for (const [x, y] of [[1.72, 0.8], [1.72, -0.8], [-1.68, 0.8], [-1.68, -0.8]]) {
    g.moveTo(x * s, y * s).lineTo((x > 0 ? 1.15 : -1.3) * s, Math.sign(y) * 0.18 * s).stroke({ width: 0.06 * s, color: dark });
  }
  // floor
  g.poly(P(mirror([[-2.25, 0.3], [-1.45, 0.72], [0.55, 0.78], [0.95, 0.4], [1.2, 0.18]]))).fill(dark);
  // bodywork with sidepods
  g.poly(P(mirror([[-2.2, 0.16], [-1.55, 0.42], [-0.55, 0.62], [0.15, 0.66], [0.55, 0.5], [0.85, 0.24], [1.0, 0.16]]))).fill(l.base);
  // sidepod flash
  g.poly(P([-0.45, 0.48, 0.1, 0.6, 0.45, 0.46, -0.1, 0.4])).fill(l.accent);
  g.poly(P([-0.45, -0.48, 0.1, -0.6, 0.45, -0.46, -0.1, -0.4])).fill(l.accent);
  // engine cover spine
  g.poly(P(mirror([[-2.1, 0.06], [-0.4, 0.12], [0.0, 0.14]]))).fill(l.accent);
  // nose
  g.poly(P(mirror([[0.95, 0.17], [2.0, 0.12], [2.55, 0.08], [2.62, 0.0]]))).fill(l.nose);
  // front wing
  g.poly(P(mirror([[2.32, 0.95], [2.55, 0.95], [2.68, 0.5], [2.7, 0.0]]))).fill(l.accent);
  g.rect(...R(2.3, 0.88, 0.32, 0.07)).fill(dark);
  g.rect(...R(2.3, -0.95, 0.32, 0.07)).fill(dark);
  // cockpit, halo, helmet
  g.ellipse(0.32 * s, 0, 0.42 * s, 0.22 * s).fill(dark);
  g.ellipse(0.25 * s, 0, 0.15 * s, 0.12 * s).fill("#f2f2f2");
  g.ellipse(0.38 * s, 0, 0.36 * s, 0.2 * s).stroke({ width: 0.05 * s, color: "#2a2c31" });
  // rear wing
  g.rect(...R(-2.82, -0.55, 0.42, 1.1)).fill(l.accent);
  g.rect(...R(-2.6, -0.55, 0.12, 1.1)).fill(dark);
  return g;
}

/** Big and small textures of every livery (small for cars drawn only a few pixels long). */
export function carTextures(renderer: Renderer, all: Record<string, Livery>) {
  const out = new Map<string, { big: Texture; small: Texture }>();
  for (const [key, l] of Object.entries({ ...all, generic: all.generic ?? GENERIC })) {
    const make = (s: number) => {
      const g = drawCar(l, s);
      const tex = renderer.generateTexture({
        target: g,
        frame: new Rectangle((-CAR_LENGTH / 2) * s, (-CAR_WIDTH / 2) * s, CAR_LENGTH * s, CAR_WIDTH * s),
        antialias: true,
      });
      g.destroy();
      return tex;
    };
    out.set(key, { big: make(40), small: make(8) });
  }
  return out;
}
