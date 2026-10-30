/**
 * How the map and cars are lit: livelier colours always, wet or dry and the time of day from the
 * race (the session packet's weather and local time), unless the viewer overrides them.
 * One colour matrix on the world, so it costs one pass on the GPU.
 */
import { ColorMatrixFilter } from "pixi.js";
import type { RaceManifest } from "./format";

export type SurfacePick = "auto" | "dry" | "wet";
export type TimePick = "auto" | "day" | "night";

export interface Look {
  /** 0 dry, 0.5 damp, 1 wet. */
  wet: number;
  /** Local time at the track, hours (0..24). */
  hour: number;
}

/** The race's own conditions at session time t. */
export function lookAt(m: Pick<RaceManifest, "weather" | "tod">, t: number, surface: SurfacePick, time: TimePick): Look {
  let code = 0;
  for (const [at, c] of m.weather ?? []) if (at <= t) code = c;
  const wet = surface === "dry" ? 0 : surface === "wet" ? 1 : code >= 4 ? 1 : code === 3 ? 0.5 : 0;
  const hour = time === "day" ? 14 : time === "night" ? 22 : m.tod ? ((m.tod[1] + (t - m.tod[0]) / 60) / 60 + 24) % 24 : 14;
  return { wet, hour };
}

/** Night 0..1 and golden hour 0..1 from the clock. */
export function sky(hour: number) {
  const night = hour >= 20 ? Math.min(1, (hour - 19.6) / 1.4) : hour <= 6 ? Math.min(1, (6.6 - hour) / 1.4) : 0;
  const near = (c: number) => Math.max(0, 1 - Math.abs(hour - c) / 1.6);
  return { night, golden: Math.max(near(18.3), near(6.8)) * (1 - night) };
}

/** The 5 x 4 colour matrix: saturation, per-channel gain, then contrast around mid grey. */
export function lookMatrix(look: Look) {
  const { night, golden } = sky(look.hour);
  const w = look.wet;
  const sat = 1.3 - 0.4 * w - 0.35 * night;
  const con = 1.06 + 0.1 * w;
  const gain = [
    1.03 * (1 - 0.2 * w) * (1 + 0.12 * golden) * (1 - 0.62 * night),
    1.03 * (1 - 0.18 * w) * (1 - 0.55 * night),
    1.03 * (1 - 0.12 * w) * (1 - 0.18 * golden) * (1 - 0.35 * night),
  ];
  const lum = [0.2126, 0.7152, 0.0722];
  const m: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) m.push(con * gain[r] * (lum[c] * (1 - sat) + (r === c ? sat : 0)));
    m.push(0, 0.5 * (1 - con));
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}

export function lookFilter() {
  return new ColorMatrixFilter();
}

export function applyLook(f: ColorMatrixFilter, look: Look) {
  f.matrix = lookMatrix(look) as typeof f.matrix;
}
