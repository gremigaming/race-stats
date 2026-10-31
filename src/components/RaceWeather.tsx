import { Cloud, CloudLightning, CloudRain, CloudSun, Sun, type LucideIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "../utils/cn";

/** How a race's weather looks on a picker card. One entry per kind; game codes map onto these. */
interface Kind {
  key: "sun" | "cloud" | "overcast" | "rain" | "storm";
  label: string;
  icon: LucideIcon;
  /** Card wash colour (rgba) and chip text colour. */
  tint: string;
  text: string;
  wet: boolean;
}

const KINDS: Record<Kind["key"], Kind> = {
  sun: { key: "sun", label: "Sunny", icon: Sun, tint: "rgba(251,191,36,0.20)", text: "text-amber-300", wet: false },
  cloud: { key: "cloud", label: "Light cloud", icon: CloudSun, tint: "rgba(253,230,138,0.12)", text: "text-amber-100", wet: false },
  overcast: { key: "overcast", label: "Overcast", icon: Cloud, tint: "rgba(161,161,170,0.18)", text: "text-zinc-300", wet: false },
  rain: { key: "rain", label: "Rain", icon: CloudRain, tint: "rgba(56,189,248,0.20)", text: "text-sky-300", wet: true },
  storm: { key: "storm", label: "Storm", icon: CloudLightning, tint: "rgba(129,140,248,0.26)", text: "text-indigo-300", wet: true },
};

/** Game weather code (0 clear, 1 light cloud, 2 overcast, 3 light rain, 4 heavy rain, 5 storm) to its kind. */
function kindOf(code: number): Kind {
  return code <= 0 ? KINDS.sun : code === 1 ? KINDS.cloud : code === 2 ? KINDS.overcast : code <= 4 ? KINDS.rain : KINDS.storm;
}

/** The kinds a race went through, repeats merged ("rain, heavy rain" is one Rain), at most 3 shown. */
export function weatherSteps(codes: number[] | undefined): Kind[] {
  const out: Kind[] = [];
  for (const c of codes ?? []) {
    const k = kindOf(c);
    if (out[out.length - 1]?.key !== k.key) out.push(k);
  }
  return out.length > 3 ? [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]] : out;
}

const RAIN_STREAKS = "repeating-linear-gradient(105deg, rgba(186,230,253,0.10) 0 1px, transparent 1px 7px)";

/**
 * Card background for the race weather: a wash in the start weather from the top-left, and when the
 * weather changed, the end weather from the bottom-right. Rain adds faint streaks on the wet side.
 * Pure CSS gradients, no images or animation, so a full picker stays cheap to paint.
 */
export function WeatherBackdrop({ codes }: { codes?: number[] }) {
  const steps = weatherSteps(codes);
  if (!steps.length) return null;
  const first = steps[0];
  const last = steps[steps.length - 1];
  const wash: CSSProperties = {
    background:
      steps.length > 1
        ? `linear-gradient(135deg, ${first.tint} 0%, transparent 50%), linear-gradient(315deg, ${last.tint} 0%, transparent 55%)`
        : `linear-gradient(135deg, ${first.tint} 0%, transparent 65%)`,
  };
  const anyWet = steps.some((s) => s.wet);
  // where the rain falls: everywhere if it rained all race, otherwise fade in on the wet side
  const mask =
    steps.every((s) => s.wet) ? undefined : first.wet && !last.wet ? "linear-gradient(to left, transparent 20%, black)" : "linear-gradient(to right, transparent 20%, black)";
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0" style={wash} />
      {first.key === "sun" && <div className="absolute -left-8 -top-8 size-28 rounded-full bg-amber-300/15 blur-2xl" />}
      {anyWet && (
        <div className="absolute inset-0" style={{ backgroundImage: RAIN_STREAKS, maskImage: mask, WebkitMaskImage: mask }} />
      )}
    </div>
  );
}

/** Small chip: the weather icon and name, or "start -> end" icons when it changed mid-race. */
export function WeatherChip({ codes, className }: { codes?: number[]; className?: string }) {
  const steps = weatherSteps(codes);
  if (!steps.length) return null;
  const changed = steps.length > 1;
  const title = changed ? `Weather changed: ${steps.map((s) => s.label).join(" → ")}` : steps[0].label;
  return (
    <span
      title={title}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        changed ? "bg-white/10 ring-1 ring-sky-400/40" : "bg-black/20",
        className,
      )}
    >
      {steps.map((s, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-500">→</span>}
          <s.icon className={cn("size-3", s.text)} />
          {!changed && <span className={s.text}>{s.label}</span>}
        </span>
      ))}
      {changed && <span className="ml-0.5 text-zinc-200">Changed</span>}
    </span>
  );
}
