/**
 * The Live Race Viewer's WebGL scene (PixiJS v8): track map and cars live on the GPU in world
 * metres; pan, zoom, rotate and follow only move the camera. Zoomed out, each car fades into a
 * team-coloured dot with its race position (leader on top). Dots, name chips, event tags, the
 * incident marker and edge arrows are drawn in screen space so they stay the same size.
 */
import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import { CAR_LENGTH, CAR_WIDTH, carTexture, clearCarTextures, inkOn, liveryOf, loadLiveries, retainCarTextures, type Livery } from "./cars";
import type { RaceCar } from "./format";
import { TrackMap } from "./map";
import type { CarState } from "./store";

export type CameraMode = "track" | "follow" | "free" | "tv";

interface Cam {
  x: number;
  z: number;
  scale: number;
  rot: number;
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 60;
const DOT_R = 12;
const FOLLOW_CAP = 500; // metres: followed cars further apart get an edge arrow instead
const TV_MIN_SCALE = 3.4; // px per metre: the broadcast camera never zooms out so far that cars turn into dots
const CUT_MS = 1800; // a broadcast cut: zoom out a little, pan, zoom back in
const FONT = "Geist Variable, system-ui, sans-serif";

/** Event tags pinned to a car, like the game's broadcast graphics. */
export type CarTag = "CONTACT" | "OFF TRACK" | "SLIDE" | "LOCK-UP?";

export function tagsOf(s: CarState, contact: boolean): CarTag[] {
  const out: CarTag[] = [];
  if (contact) out.push("CONTACT");
  if (bits(s.off) >= 2) out.push("OFF TRACK");
  const slide = Math.abs(s.slip) * (180 / Math.PI);
  if (s.speed > 40 && s.brake >= 0.8 && slide >= 4) out.push("LOCK-UP?");
  else if (s.speed > 40 && slide >= 9) out.push("SLIDE");
  return out;
}

export function bits(v: number) {
  let n = 0;
  for (let b = v; b; b >>= 1) n += b & 1;
  return n;
}

const wrap = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

interface Frame {
  t: number;
  states: CarState[];
}

export class RaceScene {
  readonly app = new Application();
  private world = new Container();
  private carLayer = new Container();
  private overlay = new Container();
  private dotLayer = new Container();
  private tagLayer = new Container();
  private chipLayer = new Container();
  private marks = new Graphics();
  private sprites = new Map<number, Sprite>();
  private dots = new Map<number, { c: Container; t: Text; pos: number }>();
  private tags = new Map<number, { c: Container; t: Text; label: string }>();
  private chips = new Map<number, Container>();
  private arrowText: Text[] = [];
  private liveries: Record<string, Livery> = {};
  private map: TrackMap;
  private cam: Cam = { x: 0, z: 0, scale: 0.2, rot: 0 };
  private followScale = 4;
  private zoomBias = 1;
  private host: HTMLElement;
  private carInfo: Record<string, RaceCar>;
  private frame: (dtMs: number) => Frame;
  private states: CarState[] = [];
  private now = 0;
  private clockMs = 0;
  private pointers = new Map<number, { x: number; y: number }>();
  private drag: { x: number; y: number; moved: boolean; rotate: boolean } | null = null;
  private pinch: { d: number; a: number } | null = null;
  private snapRot = false;
  private ready = false;
  private destroyed = false;

  mode: CameraMode = "track";
  followCars: number[] = [];
  /** The broadcast camera's shot (set by the director) and the cars around it that get edge arrows. */
  tvCars: number[] = [];
  tvContext: number[] = [];
  private cut: number | null = null;
  /** Smallest frame (metres) the multi-car camera zooms to. */
  minFrame = 60;
  /** In follow mode, turn the map so the (first) followed car points up. */
  autoRotate = false;
  /** The incident marker: where, and how strongly to show it (0..1). */
  incident: { x: number; z: number; strength: number } | null = null;
  /** Contacts, for the CONTACT tag. */
  contacts: { t: number; a: number; b: number }[] = [];
  selected = new Set<number>();
  hovered: number | null = null;
  /** World bounds the "full track" camera shows. */
  bounds: () => [number, number, number, number] | null = () => null;
  /** Screen space (px) covered by controls, kept clear when framing. */
  inset = { top: 0, right: 0, bottom: 0, left: 0 };
  onHover: (car: number | null) => void = () => {};
  onPick: (car: number, add: boolean) => void = () => {};
  onModeChange: (mode: CameraMode, cars: number[]) => void = () => {};

  constructor(host: HTMLElement, carInfo: Record<string, RaceCar>, track: string, frame: (dtMs: number) => Frame) {
    this.host = host;
    this.carInfo = carInfo;
    this.frame = frame;
    this.map = new TrackMap(track);
    retainCarTextures();
    void this.init();
  }

  private async init() {
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      background: "#15181c",
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.liveries = await loadLiveries();
    if (this.destroyed) return;
    this.carLayer.sortableChildren = true;
    this.dotLayer.sortableChildren = true;
    this.world.addChild(this.map.view, this.carLayer);
    this.overlay.addChild(this.marks, this.dotLayer, this.tagLayer, this.chipLayer);
    this.app.stage.addChild(this.world, this.overlay);
    this.app.ticker.add((t) => this.tick(t.deltaMS));
    const c = this.app.canvas;
    c.style.touchAction = "none";
    c.style.display = "block";
    c.addEventListener("pointerdown", this.down);
    c.addEventListener("pointermove", this.move);
    c.addEventListener("pointerup", this.up);
    c.addEventListener("pointercancel", this.up);
    c.addEventListener("pointerleave", this.leave);
    c.addEventListener("wheel", this.wheel, { passive: false });
    this.ready = true;
  }

  destroy() {
    this.destroyed = true;
    if (!this.ready) {
      clearCarTextures();
      return;
    }
    const c = this.app.canvas;
    c.removeEventListener("pointerdown", this.down);
    c.removeEventListener("pointermove", this.move);
    c.removeEventListener("pointerup", this.up);
    c.removeEventListener("pointercancel", this.up);
    c.removeEventListener("pointerleave", this.leave);
    c.removeEventListener("wheel", this.wheel);
    this.map.destroy();
    this.app.destroy(true, { children: true });
    clearCarTextures();
  }

  // ------------------------------------------------------------------ camera API

  get rotation() {
    return this.cam.rot;
  }

  showTrack() {
    this.mode = "track";
    this.followCars = [];
    this.onModeChange(this.mode, this.followCars);
  }

  /** Follow one or more cars; the camera keeps them all in frame (up to FOLLOW_CAP metres). */
  follow(cars: number[], minFrame = 60) {
    if (!cars.length) return this.showTrack();
    this.mode = "follow";
    this.followCars = [...new Set(cars)];
    this.minFrame = minFrame;
    this.zoomBias = 1;
    if (this.followCars.length === 1) this.followScale = Math.max(this.cam.scale, 3.5);
    this.onModeChange(this.mode, this.followCars);
  }

  free() {
    this.mode = "free";
    this.onModeChange(this.mode, this.followCars);
  }

  /** The broadcast camera: frames the director's shot, cutting smoothly between shots. */
  tv() {
    if (this.mode === "tv") return;
    this.mode = "tv";
    this.followCars = [];
    this.zoomBias = 1;
    this.cut = this.clockMs;
    this.onModeChange(this.mode, this.followCars);
  }

  /** A new shot from the director (the same cars again just refreshes it). */
  shoot(cars: number[], context: number[] = []) {
    const same = cars.length === this.tvCars.length && cars.every((c) => this.tvCars.includes(c));
    if (!same && this.tvCars.length) this.cut = this.clockMs;
    this.tvCars = cars;
    this.tvContext = context;
  }

  zoom(factor: number) {
    if (this.mode === "tv") {
      this.zoomBias = clamp(this.zoomBias * factor, 0.5, 4);
      return;
    }
    if (this.mode === "follow") {
      if (this.followCars.length === 1) this.followScale = clamp(this.followScale * factor, MIN_SCALE, MAX_SCALE);
      else this.zoomBias = clamp(this.zoomBias * factor, 0.2, 5);
      return;
    }
    this.cam.scale = clamp(this.cam.scale * factor, MIN_SCALE, MAX_SCALE);
    if (this.mode !== "free") this.free();
  }

  rotateBy(rad: number) {
    this.autoRotate = false;
    this.snapRot = false;
    this.cam.rot = wrap(this.cam.rot + rad);
  }

  resetRotation() {
    this.autoRotate = false;
    this.snapRot = true;
  }

  // ------------------------------------------------------------------ transforms

  private size() {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  toScreen(x: number, z: number) {
    const { w, h } = this.size();
    const { scale, rot } = this.cam;
    const dx = (x - this.cam.x) * scale;
    const dz = (z - this.cam.z) * scale;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: w / 2 + dx * c - dz * s, y: h / 2 + dx * s + dz * c };
  }

  private toWorld(px: number, py: number) {
    const { w, h } = this.size();
    const { scale, rot } = this.cam;
    const ux = px - w / 2;
    const uy = py - h / 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: this.cam.x + (ux * c + uy * s) / scale, z: this.cam.z + (-ux * s + uy * c) / scale };
  }

  /** The middle of the area not covered by controls, as an offset from the screen centre. */
  private freeCentre() {
    const { w, h } = this.size();
    const i = this.inset;
    return {
      ox: (i.left - i.right) / 2,
      oy: (i.top - i.bottom) / 2,
      vw: Math.max(80, w - i.left - i.right),
      vh: Math.max(80, h - i.top - i.bottom),
    };
  }

  /** Camera that puts world point (x, z) in the middle of the free area at this scale and rotation. */
  private centreOn(x: number, z: number, scale: number, rot: number): Cam {
    const { ox, oy } = this.freeCentre();
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    return { x: x - (ox * c + oy * s) / scale, z: z - (-ox * s + oy * c) / scale, scale, rot };
  }

  /** Fit world points in the free area, at rotation `rot`, with `pad` (fraction) and a minimum frame. */
  private fit(pts: { x: number; z: number }[], rot: number, pad: number, minFrame: number): Cam {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const p of pts) {
      const u = p.x * c - p.z * s;
      const v = p.x * s + p.z * c;
      u0 = Math.min(u0, u);
      u1 = Math.max(u1, u);
      v0 = Math.min(v0, v);
      v1 = Math.max(v1, v);
    }
    const du = Math.max(u1 - u0, minFrame) * (1 + pad);
    const dv = Math.max(v1 - v0, minFrame) * (1 + pad);
    const { vw, vh } = this.freeCentre();
    const scale = clamp(Math.min(vw / du, vh / dv), MIN_SCALE, MAX_SCALE);
    const um = (u0 + u1) / 2;
    const vm = (v0 + v1) / 2;
    // back from screen-aligned (u, v) to world
    return this.centreOn(um * c + vm * s, -um * s + vm * c, scale, rot);
  }

  /** The cars the follow (or broadcast) camera frames, and the ones it points to with edge arrows instead. */
  private followSplit(byCar: Map<number, CarState>) {
    const tv = this.mode === "tv";
    const { vw, vh } = this.freeCentre();
    const cap = tv ? (Math.min(vw, vh) / TV_MIN_SCALE) * 0.8 : FOLLOW_CAP;
    const present = (tv ? this.tvCars : this.followCars).map((c) => byCar.get(c)).filter((s): s is CarState => !!s);
    if (present.length <= 1) return { inFrame: present, outside: [] as CarState[] };
    const [first, ...rest] = present;
    rest.sort((a, b) => Math.hypot(a.x - first.x, a.z - first.z) - Math.hypot(b.x - first.x, b.z - first.z));
    const inFrame = [first];
    const outside: CarState[] = [];
    for (const s of rest) {
      const xs = [...inFrame, s].map((p) => p.x);
      const zs = [...inFrame, s].map((p) => p.z);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
      (span <= cap ? inFrame : outside).push(s);
    }
    return { inFrame, outside };
  }

  private aim(inFrame: CarState[]): Cam | null {
    let rot = this.cam.rot;
    if (this.snapRot) rot = 0;
    if (this.mode === "follow" && this.autoRotate && inFrame[0]) rot = -inFrame[0].heading - Math.PI / 2;
    if (this.mode === "track") {
      const b = this.bounds() ?? this.map.bounds;
      if (!b) return null;
      const pts = [
        { x: b[0], z: b[1] },
        { x: b[2], z: b[1] },
        { x: b[0], z: b[3] },
        { x: b[2], z: b[3] },
      ];
      return this.fit(pts, rot, 0.08, 50);
    }
    if (this.mode === "follow") {
      if (!inFrame.length) return null;
      if (inFrame.length === 1 && this.followCars.length === 1)
        return this.centreOn(inFrame[0].x, inFrame[0].z, this.followScale, rot);
      const f = this.fit(inFrame, rot, 0.2, this.minFrame);
      return this.centreOnScaled(f, this.zoomBias);
    }
    if (this.mode === "tv") {
      if (!inFrame.length) return null;
      const f = this.fit(inFrame, rot, 0.45, 70);
      let scale = Math.max(f.scale * this.zoomBias, TV_MIN_SCALE);
      if (this.cut !== null) {
        const p = (this.clockMs - this.cut) / CUT_MS;
        if (p >= 1) this.cut = null;
        else scale = Math.max(scale * (1 - 0.3 * Math.sin(Math.PI * p)), TV_MIN_SCALE * 0.9);
      }
      return this.centreOnScaled(f, scale / f.scale);
    }
    if (this.snapRot) return { ...this.cam, rot: 0 };
    return null;
  }

  private centreOnScaled(f: Cam, bias: number): Cam {
    if (bias === 1) return f;
    const mid = this.toWorldWith(f, this.freeCentre());
    return this.centreOn(mid.x, mid.z, clamp(f.scale * bias, MIN_SCALE, MAX_SCALE), f.rot);
  }

  /** The world point at the free-area centre for camera f. */
  private toWorldWith(f: Cam, o: { ox: number; oy: number }) {
    const c = Math.cos(f.rot);
    const s = Math.sin(f.rot);
    return { x: f.x + (o.ox * c + o.oy * s) / f.scale, z: f.z + (-o.ox * s + o.oy * c) / f.scale };
  }

  // ------------------------------------------------------------------ frame

  private tick(dtMs: number) {
    this.clockMs += dtMs;
    const f = this.frame(dtMs);
    this.states = f.states;
    this.now = f.t;
    const byCar = new Map(this.states.map((s) => [s.car, s]));
    const split = this.followSplit(byCar);
    const inFrame = split.inFrame;
    let outside = this.mode === "follow" || this.mode === "tv" ? split.outside : [];
    if (this.mode === "tv") outside = [...outside, ...this.tvContext.map((c) => byCar.get(c)).filter((s): s is CarState => !!s && !this.tvCars.includes(s.car))];
    const aim = this.aim(inFrame);
    if (aim) {
      const k = 1 - Math.exp(-dtMs / (this.mode === "tv" ? (this.cut !== null ? 420 : 160) : this.mode === "follow" ? 110 : 220));
      this.cam.x += (aim.x - this.cam.x) * k;
      this.cam.z += (aim.z - this.cam.z) * k;
      this.cam.scale *= Math.pow(aim.scale / this.cam.scale, k);
      this.cam.rot = wrap(this.cam.rot + wrap(aim.rot - this.cam.rot) * k);
      if (this.snapRot && Math.abs(this.cam.rot) < 0.002) {
        this.cam.rot = 0;
        this.snapRot = false;
      }
    }
    const { w, h } = this.size();
    const { x, z, scale, rot } = this.cam;
    this.world.pivot.set(x, z);
    this.world.position.set(w / 2, h / 2);
    this.world.scale.set(scale);
    this.world.rotation = rot;
    // visible world box (rotated view: take the box around all four corners)
    const corners = [this.toWorld(0, 0), this.toWorld(w, 0), this.toWorld(0, h), this.toWorld(w, h)];
    const xs = corners.map((p) => p.x);
    const zs = corners.map((p) => p.z);
    this.map.update(Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs), scale);
    const carPx = CAR_LENGTH * scale;
    const carAlpha = clamp((carPx - 10) / 8, 0, 1); // 10 px long: all dot; 18 px: all car
    this.drawCars(carAlpha);
    this.drawDots(1 - carAlpha);
    this.drawTags(carAlpha > 0.5);
    this.drawMarks(outside);
    this.drawChips(carAlpha);
  }

  private livery(car: number) {
    return liveryOf(this.liveries, this.carInfo[String(car)]);
  }

  private drawCars(alpha: number) {
    const live = new Set<number>();
    const ppm = this.cam.scale * (window.devicePixelRatio || 1) > 20 ? 48 : 16;
    for (const s of this.states) {
      live.add(s.car);
      let sp = this.sprites.get(s.car);
      const info = this.carInfo[String(s.car)];
      const tex = carTexture(this.livery(s.car), info?.number, ppm);
      if (!sp) {
        sp = new Sprite(tex);
        sp.anchor.set(0.5);
        this.sprites.set(s.car, sp);
        this.carLayer.addChild(sp);
      }
      if (sp.texture !== tex) sp.texture = tex;
      sp.visible = alpha > 0.01;
      sp.alpha = alpha;
      sp.position.set(s.x, s.z);
      sp.rotation = s.heading;
      sp.width = CAR_LENGTH;
      sp.height = CAR_WIDTH;
      sp.zIndex = 100 - (s.pos || 99); // the leader drawn last, on top
    }
    for (const [car, sp] of this.sprites) if (!live.has(car)) sp.visible = false;
  }

  private drawDots(alpha: number) {
    const live = new Set<number>();
    for (const s of this.states) {
      live.add(s.car);
      let d = this.dots.get(s.car);
      if (!d) {
        const l = this.livery(s.car);
        const c = new Container();
        const g = new Graphics()
          .circle(0, 0, DOT_R)
          .fill(l.base)
          .circle(0, 0, DOT_R)
          .stroke({ width: 2.5, color: l.accent })
          .circle(0, 0, DOT_R + 1.6)
          .stroke({ width: 1, color: 0x000000, alpha: 0.6 });
        const t = new Text({
          text: "",
          style: { fontFamily: FONT, fontSize: 10, fontWeight: "700", fill: inkOn(l.base) },
          resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
        });
        t.anchor.set(0.5);
        c.addChild(g, t);
        d = { c, t, pos: -1 };
        this.dots.set(s.car, d);
        this.dotLayer.addChild(c);
      }
      if (d.pos !== s.pos) {
        d.pos = s.pos;
        d.t.text = s.pos ? `P${s.pos}` : "";
      }
      const p = this.toScreen(s.x, s.z);
      d.c.position.set(p.x, p.y);
      d.c.visible = alpha > 0.01;
      d.c.alpha = alpha;
      d.c.zIndex = 100 - (s.pos || 99);
    }
    for (const [car, d] of this.dots) if (!live.has(car)) d.c.visible = false;
  }

  private drawTags(show: boolean) {
    const byCar = new Map(this.states.map((s) => [s.car, s]));
    const touched = new Set<number>();
    for (const c of this.contacts) {
      if (this.now >= c.t - 0.2 && this.now <= c.t + 1.2) {
        touched.add(c.a);
        touched.add(c.b);
      }
    }
    const want = new Map<number, string>();
    if (show) for (const s of this.states) {
      const tags = tagsOf(s, touched.has(s.car));
      if (tags.length) want.set(s.car, tags.join(" · "));
    }
    for (const [car, tag] of this.tags) {
      if (!want.has(car)) {
        tag.c.destroy({ children: true });
        this.tags.delete(car);
      }
    }
    for (const [car, label] of want) {
      let tag = this.tags.get(car);
      if (!tag || tag.label !== label) {
        tag?.c.destroy({ children: true });
        const c = new Container();
        const t = new Text({
          text: label,
          style: { fontFamily: FONT, fontSize: 10, fontWeight: "800", fontStyle: "italic", fill: 0xffffff, letterSpacing: 0.5 },
          resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
        });
        t.position.set(12, 2);
        const warn = label.includes("CONTACT") || label.includes("LOCK");
        const g = new Graphics()
          .roundRect(0, 0, t.width + 18, t.height + 4, 3)
          .fill({ color: 0x0c0e11, alpha: 0.78 })
          .circle(6, (t.height + 4) / 2, 3)
          .fill(warn ? 0xffb020 : 0xffffff);
        c.addChild(g, t);
        tag = { c, t, label };
        this.tags.set(car, tag);
        this.tagLayer.addChild(c);
      }
      const s = byCar.get(car)!;
      const p = this.toScreen(s.x, s.z);
      const r = (CAR_WIDTH * this.cam.scale) / 2 + 6;
      tag.c.position.set(Math.round(p.x + r), Math.round(p.y - tag.c.height / 2 - r));
    }
  }

  /** The incident marker (pulsing ring) and arrows at the screen edge for what's off screen. */
  private drawMarks(outside: CarState[]) {
    const g = this.marks;
    g.clear();
    const { w, h } = this.size();
    const i = this.inset;
    const box = { x0: i.left + 22, y0: i.top + 22, x1: w - i.right - 22, y1: h - i.bottom - 22 };
    const arrows: { x: number; y: number; color: string; label: string }[] = [];
    const inc = this.incident;
    if (inc && Number.isFinite(inc.x) && inc.strength > 0) {
      const p = this.toScreen(inc.x, inc.z);
      if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1) {
        arrows.push({ ...p, color: "#ffb020", label: "!" });
      } else {
        const pulse = (this.clockMs / 900) % 1;
        const a = inc.strength;
        g.circle(p.x, p.y, 14 + pulse * 30).stroke({ width: 3, color: 0xffb020, alpha: a * (1 - pulse) });
        g.circle(p.x, p.y, 15).stroke({ width: 3, color: 0xffb020, alpha: a });
        g.circle(p.x, p.y, 15).fill({ color: 0xffb020, alpha: 0.18 * a });
        g.moveTo(p.x - 6, p.y).lineTo(p.x + 6, p.y).moveTo(p.x, p.y - 6).lineTo(p.x, p.y + 6).stroke({ width: 2, color: 0xffb020, alpha: a });
      }
    }
    for (const s of outside) {
      const p = this.toScreen(s.x, s.z);
      if (p.x < box.x0 || p.x > box.x1 || p.y < box.y0 || p.y > box.y1)
        arrows.push({ ...p, color: this.livery(s.car).base, label: s.pos ? `P${s.pos}` : "" });
    }
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    arrows.forEach((a, n) => {
      const dx = a.x - cx;
      const dy = a.y - cy;
      const k = Math.min((box.x1 - cx) / Math.max(Math.abs(dx), 1e-6), (box.y1 - cy) / Math.max(Math.abs(dy), 1e-6));
      const ex = cx + dx * k;
      const ey = cy + dy * k;
      const ang = Math.atan2(dy, dx);
      const tip = (r: number, da: number) => [ex + Math.cos(ang + da) * r, ey + Math.sin(ang + da) * r];
      const [ax, ay] = tip(14, 0);
      const [bx, by] = tip(10, 2.4);
      const [qx, qy] = tip(10, -2.4);
      g.poly([ax, ay, bx, by, qx, qy]).fill(a.color).stroke({ width: 1.5, color: 0x000000, alpha: 0.6 });
      let t = this.arrowText[n];
      if (!t) {
        t = new Text({
          text: "",
          style: { fontFamily: FONT, fontSize: 10, fontWeight: "700", fill: 0xffffff, stroke: { color: 0x000000, width: 3 } },
          resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
        });
        t.anchor.set(0.5);
        this.arrowText[n] = t;
        this.overlay.addChild(t);
      }
      t.text = a.label;
      t.visible = true;
      t.position.set(ex - Math.cos(ang) * 14, ey - Math.sin(ang) * 14);
    });
    for (let n = arrows.length; n < this.arrowText.length; n++) this.arrowText[n].visible = false;
  }

  private drawChips(carAlpha: number) {
    const show = new Set(this.selected);
    if (this.hovered !== null) show.add(this.hovered);
    if (this.mode === "follow") for (const c of this.followCars) show.add(c);
    if (this.mode === "tv") for (const c of this.tvCars) show.add(c);
    const byCar = new Map(this.states.map((s) => [s.car, s]));
    for (const [car, chip] of this.chips) {
      if (!show.has(car) || !byCar.has(car)) {
        chip.destroy({ children: true });
        this.chips.delete(car);
      }
    }
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const order = [...show].map((c) => byCar.get(c)).filter((s): s is CarState => !!s).sort((a, b) => (a.pos || 99) - (b.pos || 99));
    const lift = carAlpha > 0.5 ? (CAR_WIDTH * this.cam.scale) / 2 + 10 : DOT_R + 6;
    for (const s of order) {
      let chip = this.chips.get(s.car);
      if (!chip) {
        chip = this.makeChip(s.car);
        this.chips.set(s.car, chip);
        this.chipLayer.addChild(chip);
      }
      const p = this.toScreen(s.x, s.z);
      let x0 = Math.round(p.x - chip.width / 2);
      let y0 = Math.round(p.y - lift - chip.height);
      // nudge up past chips already placed, so names don't overlap
      for (let guard = 0; guard < 8; guard++) {
        const hit = placed.find((r) => x0 < r.x1 && x0 + chip!.width > r.x0 && y0 < r.y1 && y0 + chip!.height > r.y0);
        if (!hit) break;
        y0 = hit.y0 - chip.height - 2;
      }
      x0 = Math.round(x0);
      chip.position.set(x0, y0);
      placed.push({ x0, x1: x0 + chip.width, y0, y1: y0 + chip.height });
    }
  }

  private makeChip(car: number) {
    const info = this.carInfo[String(car)];
    const l = this.livery(car);
    const c = new Container();
    const text = new Text({
      text: info?.name ?? `Car ${car}`,
      style: { fontFamily: FONT, fontSize: 11, fontWeight: "600", fill: 0xf4f5f7 },
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
    });
    text.position.set(9, 3);
    const bg = new Graphics()
      .roundRect(0, 0, text.width + 15, text.height + 6, 4)
      .fill({ color: 0x0c0e11, alpha: 0.85 })
      .rect(0, 0, 4, text.height + 6)
      .fill(l.base);
    c.addChild(bg, text);
    return c;
  }

  // ------------------------------------------------------------------ input

  private local(e: PointerEvent | WheelEvent) {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private carAt(px: number, py: number) {
    let best: number | null = null;
    let bestD = Math.max(DOT_R + 2, (CAR_LENGTH * this.cam.scale) / 2);
    for (const s of this.states) {
      const p = this.toScreen(s.x, s.z);
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) {
        bestD = d;
        best = s.car;
      }
    }
    return best;
  }

  private twoFinger() {
    const [a, b] = [...this.pointers.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), a: Math.atan2(b.y - a.y, b.x - a.x) };
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.app.canvas.setPointerCapture(e.pointerId);
    if (this.pointers.size === 2) {
      this.pinch = this.twoFinger();
      this.drag = null;
      return;
    }
    this.drag = { x: p.x, y: p.y, moved: false, rotate: e.shiftKey };
  };

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
    if (this.pinch && this.pointers.size === 2) {
      const now = this.twoFinger();
      this.zoom(now.d / Math.max(this.pinch.d, 1));
      this.rotateBy(wrap(now.a - this.pinch.a));
      this.pinch = now;
      return;
    }
    if (this.drag) {
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      this.drag.moved = true;
      if (this.drag.rotate) {
        this.rotateBy(dx * 0.006);
      } else {
        if (this.mode !== "free") this.free();
        const { scale, rot } = this.cam;
        const c = Math.cos(rot);
        const s = Math.sin(rot);
        this.cam.x -= (dx * c + dy * s) / scale;
        this.cam.z -= (-dx * s + dy * c) / scale;
      }
      this.drag.x = p.x;
      this.drag.y = p.y;
      return;
    }
    const car = this.carAt(p.x, p.y);
    if (car !== this.hovered) {
      this.hovered = car;
      this.app.canvas.style.cursor = car === null ? "grab" : "pointer";
      this.onHover(car);
    }
  };

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.app.canvas.hasPointerCapture(e.pointerId)) this.app.canvas.releasePointerCapture(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (d && !d.moved) {
      const car = this.carAt(d.x, d.y);
      if (car !== null) this.onPick(car, e.shiftKey || e.ctrlKey || e.metaKey);
    }
  };

  private leave = () => {
    if (this.hovered !== null) {
      this.hovered = null;
      this.onHover(null);
    }
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    if (e.shiftKey) return this.rotateBy((e.deltaY || e.deltaX) * 0.002);
    if (this.mode === "follow" || this.mode === "tv") return this.zoom(factor);
    const p = this.local(e);
    const before = this.toWorld(p.x, p.y);
    this.cam.scale = clamp(this.cam.scale * factor, MIN_SCALE, MAX_SCALE);
    if (this.mode !== "free") this.free();
    const after = this.toWorld(p.x, p.y);
    this.cam.x += before.x - after.x;
    this.cam.z += before.z - after.z;
  };
}
