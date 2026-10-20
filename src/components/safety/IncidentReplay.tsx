import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/** One replay written by scripts/telemetry/incident_replays.py (metres, the pair's direction of travel up). */
interface ReplayData {
  fps: number;
  contact: number;
  pair: [number, number];
  names: Record<string, string>;
  frames: [number, number, number, number][][];
  contacts: { f: number; at: [number, number] }[];
  track?: { l: number[]; r: number[]; kerbs: number[][] };
}

const COLORS = { a: "#ff8a1f", b: "#4fb6ff", other: "#9aa1ad" };
const VIEW = 64; // metres across the shorter side

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, col: string) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(h);
  ctx.fillStyle = "#08090b";
  for (const [wx, wy] of [[1.55, 0.78], [1.55, -0.78], [-1.75, 0.78], [-1.75, -0.78]])
    ctx.fillRect(wx - 0.36, wy - (wy > 0 ? 0 : 0.4), 0.72, 0.4);
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.moveTo(-2.2, -0.32);
  ctx.lineTo(-1.0, -0.62);
  ctx.lineTo(0.7, -0.62);
  ctx.lineTo(1.1, -0.2);
  ctx.lineTo(2.55, -0.12);
  ctx.lineTo(2.75, 0);
  ctx.lineTo(2.55, 0.12);
  ctx.lineTo(1.1, 0.2);
  ctx.lineTo(0.7, 0.62);
  ctx.lineTo(-1.0, 0.62);
  ctx.lineTo(-2.2, 0.32);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(2.25, -0.95, 0.42, 1.9);
  ctx.fillRect(-2.8, -0.5, 0.38, 1.0);
  ctx.fillStyle = "#08090b";
  ctx.beginPath();
  ctx.ellipse(0.15, 0, 0.42, 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function path(ctx: CanvasRenderingContext2D, p: number[]) {
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i], p[i + 1]);
}

/** Overhead replay of one contact: loops a few seconds around it at half speed. */
export function IncidentReplay({ id }: { id: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [data, setData] = useState<ReplayData | null>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(!matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [slow, setSlow] = useState(true);
  const state = useRef({ t: 0, last: 0 });

  useEffect(() => {
    let alive = true;
    fetch(`${import.meta.env.BASE_URL}league/replays/${id}.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: ReplayData) => {
        if (!alive) return;
        state.current.t = 0;
        setData(d);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    const cv = ref.current;
    if (!data || !cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const [a, b] = data.pair;
    const n = data.frames.length;
    // the camera follows the pair (smoothed), so they stay in view for the whole clip
    const mid = data.frames.map((f) => {
      const p = f.filter((c) => c[0] === a || c[0] === b);
      return p.length ? [p.reduce((s, c) => s + c[1], 0) / p.length, p.reduce((s, c) => s + c[2], 0) / p.length] : null;
    });
    const cam = mid.map((_, i) => {
      let x = 0, y = 0, m = 0;
      for (let j = Math.max(0, i - 15); j <= Math.min(n - 1, i + 15); j++) {
        const q = mid[j];
        if (q) {
          x += q[0];
          y += q[1];
          m++;
        }
      }
      return m ? [x / m, y / m] : [0, 0];
    });
    let raf = 0;
    const draw = (now: number) => {
      const st = state.current;
      if (playing && st.last) st.t = (st.t + ((now - st.last) / 1000) * data.fps * (slow ? 0.5 : 1)) % n;
      st.last = now;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      const s = Math.min(w, h) / VIEW;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#1c2620";
      ctx.fillRect(0, 0, w, h);
      const fi = Math.floor(state.current.t), k = state.current.t - fi;
      const c0 = cam[fi], c1 = cam[Math.min(fi + 1, n - 1)];
      const cx = c0[0] + (c1[0] - c0[0]) * k, cy = c0[1] + (c1[1] - c0[1]) * k;
      ctx.setTransform(s, 0, 0, s, w / 2 - cx * s, h / 2 - cy * s);
      ctx.lineJoin = "round";
      if (data.track) {
        const { l, r, kerbs } = data.track;
        ctx.fillStyle = "#121418";
        ctx.beginPath();
        path(ctx, l);
        for (let i = r.length - 2; i >= 0; i -= 2) ctx.lineTo(r[i], r[i + 1]);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "#cfd3da";
        ctx.lineWidth = 0.3;
        for (const e of [l, r]) {
          ctx.beginPath();
          path(ctx, e);
          ctx.stroke();
        }
        ctx.fillStyle = "#e2392c";
        for (const k of kerbs) {
          ctx.beginPath();
          path(ctx, k);
          ctx.closePath();
          ctx.fill();
        }
      }
      const f0 = data.frames[fi], f1 = data.frames[Math.min(fi + 1, n - 1)];
      const next = new Map(f1.map((c) => [c[0], c]));
      // trails of the two cars
      for (const [car, col] of [[a, COLORS.a], [b, COLORS.b]] as const) {
        ctx.strokeStyle = col;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 0.35;
        ctx.beginPath();
        let started = false;
        for (let j = Math.max(0, fi - data.fps * 2); j <= fi; j++) {
          const c = data.frames[j].find((x) => x[0] === car);
          if (!c) continue;
          if (started) ctx.lineTo(c[1], c[2]);
          else ctx.moveTo(c[1], c[2]);
          started = true;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      const drawn: Record<number, [number, number]> = {};
      const inPair = (c: (typeof f0)[number]) => (c[0] === a || c[0] === b ? 1 : 0);
      const order = [...f0].sort((p, q) => inPair(p) - inPair(q));
      for (const c of order) {
        const q = next.get(c[0]) ?? c;
        let dh = q[3] - c[3];
        while (dh > Math.PI) dh -= 2 * Math.PI;
        while (dh < -Math.PI) dh += 2 * Math.PI;
        const x = c[1] + (q[1] - c[1]) * k, y = c[2] + (q[2] - c[2]) * k;
        drawn[c[0]] = [x, y];
        drawCar(ctx, x, y, c[3] + dh * k, c[0] === a ? COLORS.a : c[0] === b ? COLORS.b : COLORS.other);
      }
      // contact markers: a ring that grows at the moment of contact, then a cross
      for (const c of data.contacts) {
        if (fi < c.f) continue;
        const age = (fi - c.f) / data.fps;
        ctx.strokeStyle = "#ff3b30";
        if (age < 0.8) {
          ctx.globalAlpha = 1 - age / 0.8;
          ctx.lineWidth = 0.3;
          ctx.beginPath();
          ctx.arc(c.at[0], c.at[1], 0.8 + age * 6, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.lineWidth = 0.22;
        ctx.beginPath();
        ctx.moveTo(c.at[0] - 0.45, c.at[1] - 0.45);
        ctx.lineTo(c.at[0] + 0.45, c.at[1] + 0.45);
        ctx.moveTo(c.at[0] + 0.45, c.at[1] - 0.45);
        ctx.lineTo(c.at[0] - 0.45, c.at[1] + 0.45);
        ctx.stroke();
      }
      // name labels in screen space
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const fs = Math.round(11 * dpr);
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      for (const [car, col, dy] of [[a, COLORS.a, -2.6], [b, COLORS.b, 2.6]] as const) {
        const p = drawn[car];
        if (!p) continue;
        const txt = data.names[String(car)] ?? "";
        const tw = ctx.measureText(txt).width + fs * 0.6;
        const sx = w / 2 + (p[0] - cx) * s - tw / 2, sy = h / 2 + (p[1] - cy + dy) * s - fs * 0.7;
        ctx.fillStyle = "rgba(13,15,19,.82)";
        ctx.fillRect(sx, sy, tw, fs * 1.4);
        ctx.fillStyle = col;
        ctx.fillText(txt, sx + fs * 0.3, sy + fs * 1.05);
      }
      const sec = (fi - data.contact) / data.fps;
      ctx.fillStyle = "rgba(13,15,19,.82)";
      ctx.fillRect(fs * 0.6, fs * 0.6, fs * 6.2, fs * 1.6);
      ctx.fillStyle = "#e5e7eb";
      ctx.fillText(`${sec >= 0 ? "+" : "−"}${Math.abs(sec).toFixed(1)} s`, fs * 1.0, fs * 1.75);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [data, playing, slow]);

  if (failed) return <p className="text-zinc-500">The replay of this contact could not be loaded.</p>;
  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-white/[0.06]">
      <canvas ref={ref} className="block aspect-[4/3] w-full bg-[#1c2620]" aria-label="Overhead replay of this contact" />
      <div className="flex items-center gap-2 bg-black/30 px-2 py-1.5 text-[11px] text-zinc-400">
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-zinc-200 hover:bg-white/[0.06]"
        >
          {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => setSlow((v) => !v)}
          className="rounded px-1.5 py-0.5 text-zinc-200 hover:bg-white/[0.06]"
        >
          {slow ? "0.5×" : "1×"}
        </button>
        <span className="ml-auto">Every car's real position from the race · red cross = contact</span>
      </div>
    </div>
  );
}
