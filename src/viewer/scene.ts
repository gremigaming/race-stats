/**
 * The Live Race Viewer's WebGL scene (PixiJS v8): track map and cars live on the GPU in world
 * metres; pan, zoom and follow only move the camera. Name chips are drawn in screen space, and
 * only for selected or hovered cars.
 */
import { Application, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import { CAR_LENGTH, CAR_WIDTH, carTextures, liveryOf, loadLiveries, teamKey, type Livery } from "./cars";
import type { RaceCar } from "./format";
import { TrackMap } from "./map";
import type { CarState } from "./store";

export type CameraMode = "track" | "follow" | "free" | "incident";

interface Cam {
  x: number;
  z: number;
  scale: number;
}

const MIN_CAR_PX = 16; // cars never shrink below this many pixels long
const MIN_SCALE = 0.05;
const MAX_SCALE = 60;

export class RaceScene {
  readonly app = new Application();
  private world = new Container();
  private cars = new Container();
  private marks = new Graphics();
  private chipLayer = new Container();
  private sprites = new Map<number, Sprite>();
  private chips = new Map<number, Container>();
  private textures = new Map<string, { big: Texture; small: Texture }>();
  private liveries: Record<string, Livery> = {};
  private map: TrackMap;
  private cam: Cam = { x: 0, z: 0, scale: 1 };
  private followScale = 4;
  private host: HTMLElement;
  private carInfo: Record<string, RaceCar>;
  private frame: (dtMs: number) => CarState[];
  private states: CarState[] = [];
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private ready = false;
  private destroyed = false;

  mode: CameraMode = "track";
  follow: number | null = null;
  /** Cars the incident camera keeps in frame, and the contact point to mark. */
  incident: { cars: number[]; x: number; z: number; strength: number } | null = null;
  selected = new Set<number>();
  hovered: number | null = null;
  /** World bounds the "full track" camera shows. */
  bounds: () => [number, number, number, number] | null = () => null;
  /** Bottom and right space (px) covered by the controls, kept clear by the track camera. */
  inset = { bottom: 0, right: 0 };
  onHover: (car: number | null) => void = () => {};
  onPick: (car: number) => void = () => {};
  onModeChange: (mode: CameraMode) => void = () => {};

  constructor(host: HTMLElement, carInfo: Record<string, RaceCar>, track: string, frame: (dtMs: number) => CarState[]) {
    this.host = host;
    this.carInfo = carInfo;
    this.frame = frame;
    this.map = new TrackMap(track);
    void this.init();
  }

  private async init() {
    await this.app.init({
      resizeTo: this.host,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      background: "#0c0e11",
      preference: "webgl",
    });
    if (this.destroyed) {
      this.app.destroy(true);
      return;
    }
    this.host.appendChild(this.app.canvas);
    this.liveries = await loadLiveries();
    if (this.destroyed) return;
    this.textures = carTextures(this.app.renderer, this.liveries);
    this.world.addChild(this.map.view, this.marks, this.cars);
    this.app.stage.addChild(this.world, this.chipLayer);
    this.app.ticker.add((t) => this.tick(t.deltaMS));
    const c = this.app.canvas;
    c.style.touchAction = "none";
    c.style.display = "block";
    c.addEventListener("pointerdown", this.down);
    c.addEventListener("pointermove", this.move);
    c.addEventListener("pointerup", this.up);
    c.addEventListener("pointerleave", this.leave);
    c.addEventListener("wheel", this.wheel, { passive: false });
    this.ready = true;
  }

  destroy() {
    this.destroyed = true;
    if (!this.ready) return;
    const c = this.app.canvas;
    c.removeEventListener("pointerdown", this.down);
    c.removeEventListener("pointermove", this.move);
    c.removeEventListener("pointerup", this.up);
    c.removeEventListener("pointerleave", this.leave);
    c.removeEventListener("wheel", this.wheel);
    this.map.destroy();
    for (const t of this.textures.values()) {
      t.big.destroy(true);
      t.small.destroy(true);
    }
    this.app.destroy(true, { children: true });
  }

  setMode(mode: CameraMode, follow: number | null = this.follow) {
    this.mode = mode;
    this.follow = follow;
    if (mode === "follow") this.followScale = Math.max(this.cam.scale, 4);
    this.onModeChange(mode);
  }

  zoom(factor: number) {
    this.cam.scale = clamp(this.cam.scale * factor, MIN_SCALE, MAX_SCALE);
    if (this.mode === "follow") this.followScale = this.cam.scale;
    else if (this.mode !== "free") this.setMode("free");
  }

  // ------------------------------------------------------------------ camera

  private size() {
    return { w: this.app.screen.width, h: this.app.screen.height };
  }

  private fit(b: [number, number, number, number], pad: number): Cam {
    const { w, h } = this.size();
    const vw = Math.max(50, w - this.inset.right - pad * 2);
    const vh = Math.max(50, h - this.inset.bottom - pad * 2);
    const scale = clamp(Math.min(vw / Math.max(b[2] - b[0], 1), vh / Math.max(b[3] - b[1], 1)), MIN_SCALE, MAX_SCALE);
    // centre in the free area (left of the panel, above the bar)
    return {
      x: (b[0] + b[2]) / 2 + this.inset.right / 2 / scale,
      z: (b[1] + b[3]) / 2 + this.inset.bottom / 2 / scale,
      scale,
    };
  }

  private aim(): Cam | null {
    const byCar = new Map(this.states.map((s) => [s.car, s]));
    if (this.mode === "track") {
      const b = this.bounds() ?? this.map.bounds;
      return b ? this.fit(b, 40) : null;
    }
    if (this.mode === "follow" && this.follow !== null) {
      const s = byCar.get(this.follow);
      return s ? { x: s.x, z: s.z, scale: this.followScale } : null;
    }
    if (this.mode === "incident" && this.incident) {
      const pts = this.incident.cars.map((c) => byCar.get(c)).filter((s): s is CarState => !!s);
      if (Number.isFinite(this.incident.x)) pts.push({ x: this.incident.x, z: this.incident.z } as CarState);
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x);
      const zs = pts.map((p) => p.z);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
      const half = Math.max(35, (Math.max(...xs) - Math.min(...xs)) / 2 + 20, (Math.max(...zs) - Math.min(...zs)) / 2 + 20);
      return this.fit([cx - half, cz - half, cx + half, cz + half], 30);
    }
    return null;
  }

  // ------------------------------------------------------------------ frame

  private tick(dtMs: number) {
    this.states = this.frame(dtMs);
    const aim = this.aim();
    if (aim) {
      const k = 1 - Math.exp(-dtMs / (this.mode === "follow" ? 90 : 220));
      this.cam.x += (aim.x - this.cam.x) * k;
      this.cam.z += (aim.z - this.cam.z) * k;
      this.cam.scale *= Math.pow(aim.scale / this.cam.scale, k);
    }
    const { w, h } = this.size();
    const { x, z, scale } = this.cam;
    this.world.scale.set(scale);
    this.world.position.set(w / 2 - x * scale, h / 2 - z * scale);
    this.map.update(x - w / 2 / scale, z - h / 2 / scale, x + w / 2 / scale, z + h / 2 / scale, scale);
    this.drawCars(scale);
    this.drawMarks(scale);
    this.drawChips();
  }

  private drawCars(scale: number) {
    const boost = Math.max(1, MIN_CAR_PX / (CAR_LENGTH * scale));
    const small = CAR_LENGTH * scale * boost < 48;
    const live = new Set<number>();
    for (const s of this.states) {
      live.add(s.car);
      let sp = this.sprites.get(s.car);
      const tex = this.textures.get(teamKey(this.carInfo[String(s.car)])) ?? this.textures.get("generic");
      if (!tex) continue;
      if (!sp) {
        sp = new Sprite(tex.big);
        sp.anchor.set(0.5);
        this.sprites.set(s.car, sp);
        this.cars.addChild(sp);
      }
      sp.texture = small ? tex.small : tex.big;
      sp.visible = true;
      sp.position.set(s.x, s.z);
      sp.rotation = s.heading;
      sp.width = CAR_LENGTH * boost;
      sp.height = CAR_WIDTH * boost;
      // the race order decides who is drawn on top: the leader last
      sp.zIndex = 100 - (s.pos || 99);
    }
    this.cars.sortableChildren = true;
    for (const [car, sp] of this.sprites) if (!live.has(car)) sp.visible = false;
  }

  private drawMarks(scale: number) {
    const g = this.marks;
    g.clear();
    const inc = this.incident;
    if (!inc || !Number.isFinite(inc.x) || inc.strength <= 0) return;
    const r = Math.max(6, 14 / scale);
    g.circle(inc.x, inc.z, r).stroke({ width: Math.max(0.25, 2 / scale), color: 0xffb020, alpha: 0.85 * inc.strength });
    g.circle(inc.x, inc.z, r * 0.25).fill({ color: 0xffb020, alpha: 0.6 * inc.strength });
  }

  private drawChips() {
    const show = new Set(this.selected);
    if (this.hovered !== null) show.add(this.hovered);
    if (this.mode === "follow" && this.follow !== null) show.add(this.follow);
    const byCar = new Map(this.states.map((s) => [s.car, s]));
    for (const [car, chip] of this.chips) {
      if (!show.has(car) || !byCar.has(car)) {
        chip.destroy({ children: true });
        this.chips.delete(car);
      }
    }
    const { scale } = this.cam;
    for (const car of show) {
      const s = byCar.get(car);
      if (!s) continue;
      let chip = this.chips.get(car);
      if (!chip) {
        chip = this.makeChip(car);
        this.chips.set(car, chip);
        this.chipLayer.addChild(chip);
      }
      const { w, h } = this.size();
      const p = { x: w / 2 + (s.x - this.cam.x) * scale, y: h / 2 + (s.z - this.cam.z) * scale };
      const lift = (Math.max(CAR_LENGTH * scale, MIN_CAR_PX) / 2) + 8;
      chip.position.set(Math.round(p.x - chip.width / 2), Math.round(p.y - lift - chip.height));
    }
  }

  private makeChip(car: number) {
    const info = this.carInfo[String(car)];
    const l = liveryOf(this.liveries, info);
    const c = new Container();
    const text = new Text({
      text: `${info?.number ?? ""} ${info?.name ?? `Car ${car}`}`.trim(),
      style: { fontFamily: "Geist Variable, system-ui, sans-serif", fontSize: 11, fontWeight: "600", fill: 0xf4f5f7 },
      resolution: Math.min(window.devicePixelRatio || 1, 2) * 1.5,
    });
    text.position.set(9, 3);
    const bg = new Graphics()
      .roundRect(0, 0, text.width + 15, text.height + 6, 4)
      .fill({ color: 0x0c0e11, alpha: 0.82 })
      .rect(0, 0, 4, text.height + 6)
      .fill(l.base);
    c.addChild(bg, text);
    return c;
  }

  // ------------------------------------------------------------------ input

  private toWorld(px: number, py: number) {
    const { w, h } = this.size();
    return { x: this.cam.x + (px - w / 2) / this.cam.scale, z: this.cam.z + (py - h / 2) / this.cam.scale };
  }

  private local(e: PointerEvent | WheelEvent) {
    const r = this.app.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private carAt(px: number, py: number) {
    const p = this.toWorld(px, py);
    const reach = Math.max(4, 12 / this.cam.scale);
    let best: number | null = null;
    let bestD = reach;
    for (const s of this.states) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = s.car;
      }
    }
    return best;
  }

  private down = (e: PointerEvent) => {
    const p = this.local(e);
    this.drag = { x: p.x, y: p.y, moved: false };
    this.app.canvas.setPointerCapture(e.pointerId);
  };

  private move = (e: PointerEvent) => {
    const p = this.local(e);
    if (this.drag) {
      const dx = p.x - this.drag.x;
      const dy = p.y - this.drag.y;
      if (!this.drag.moved && Math.hypot(dx, dy) < 4) return;
      if (!this.drag.moved && this.mode !== "free") this.setMode("free");
      this.drag.moved = true;
      this.cam.x -= dx / this.cam.scale;
      this.cam.z -= dy / this.cam.scale;
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
    const d = this.drag;
    this.drag = null;
    if (this.app.canvas.hasPointerCapture(e.pointerId)) this.app.canvas.releasePointerCapture(e.pointerId);
    if (d && !d.moved) {
      const car = this.carAt(d.x, d.y);
      if (car !== null) this.onPick(car);
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
    const p = this.local(e);
    const before = this.toWorld(p.x, p.y);
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
    this.cam.scale = clamp(this.cam.scale * factor, MIN_SCALE, MAX_SCALE);
    if (this.mode === "follow") {
      this.followScale = this.cam.scale;
      return;
    }
    if (this.mode !== "free") this.setMode("free");
    const after = this.toWorld(p.x, p.y);
    this.cam.x += before.x - after.x;
    this.cam.z += before.z - after.z;
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
