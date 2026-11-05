import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import { cn } from "../utils/cn";

/** How a race's weather looks on a picker card. One entry per kind; game codes map onto these. */
interface Kind {
  key: "sun" | "cloud" | "overcast" | "rain" | "storm";
  label: string;
  icon: LucideIcon;
  glow: string;
  frame: string;
  chip: string;
  text: string;
}

const KINDS: Record<Kind["key"], Kind> = {
  sun: {
    key: "sun",
    label: "Sunny",
    icon: Sun,
    glow: "rgba(251,191,36,0.22)",
    frame: "ring-amber-300/12",
    chip: "bg-amber-300/10 ring-amber-200/25",
    text: "text-amber-300",
  },
  cloud: {
    key: "cloud",
    label: "Light cloud",
    icon: CloudSun,
    glow: "rgba(253,230,138,0.16)",
    frame: "ring-amber-100/10",
    chip: "bg-amber-100/[0.06] ring-amber-100/20",
    text: "text-amber-100",
  },
  overcast: {
    key: "overcast",
    label: "Overcast",
    icon: Cloud,
    glow: "rgba(161,161,170,0.15)",
    frame: "ring-zinc-300/10",
    chip: "bg-zinc-300/[0.07] ring-zinc-300/20",
    text: "text-zinc-300",
  },
  rain: {
    key: "rain",
    label: "Rain",
    icon: CloudRain,
    glow: "rgba(56,189,248,0.2)",
    frame: "ring-sky-300/12",
    chip: "bg-sky-400/10 ring-sky-300/25",
    text: "text-sky-300",
  },
  storm: {
    key: "storm",
    label: "Storm",
    icon: CloudLightning,
    glow: "rgba(129,140,248,0.23)",
    frame: "ring-indigo-300/14",
    chip: "bg-indigo-400/15 ring-indigo-300/30",
    text: "text-indigo-300",
  },
};

/** Game weather code (0 clear, 1 light cloud, 2 overcast, 3 light rain, 4 heavy rain, 5 storm) to its kind. */
function kindOf(code: number): Kind {
  return code <= 0
    ? KINDS.sun
    : code === 1
      ? KINDS.cloud
      : code === 2
        ? KINDS.overcast
        : code <= 4
          ? KINDS.rain
          : KINDS.storm;
}

/** The kinds a race went through, repeats merged ("rain, heavy rain" is one Rain), at most 3 shown. */
export function weatherSteps(codes: number[] | undefined): Kind[] {
  const out: Kind[] = [];
  for (const code of codes ?? []) {
    const kind = kindOf(code);
    if (out[out.length - 1]?.key !== kind.key) out.push(kind);
  }
  return out.length > 3
    ? [out[0], out[Math.floor(out.length / 2)], out[out.length - 1]]
    : out;
}

/** A restrained corner glow reinforces the weather chip without tinting the whole card. */
export function WeatherBackdrop({ codes }: { codes?: number[] }) {
  const steps = weatherSteps(codes);
  if (!steps.length) return null;

  const last = steps[steps.length - 1];
  const wash: CSSProperties = {
    backgroundImage: `radial-gradient(ellipse at 100% 0%, ${last.glow} 0%, transparent 74%)`,
  };

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute right-0 top-0 h-28 w-44" style={wash} />
      <div
        className={cn(
          "absolute inset-0 rounded-2xl ring-1 ring-inset",
          last.frame,
        )}
      />
    </div>
  );
}

/** Small condition label, or a start-to-end summary when weather changed mid-race. */
export function WeatherChip({
  codes,
  className,
}: {
  codes?: number[];
  className?: string;
}) {
  const steps = weatherSteps(codes);
  if (!steps.length) return null;
  const changed = steps.length > 1;
  const last = steps[steps.length - 1];
  const title = changed
    ? `Weather changed: ${steps.map((step) => step.label).join(" → ")}`
    : last.label;

  return (
    <span
      title={title}
      className={cn(
        "flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        last.chip,
        className,
      )}
    >
      {steps.map((step, index) => (
        <span key={index} className="flex items-center gap-1">
          {index > 0 && <span className="text-zinc-400/70">→</span>}
          <step.icon className={cn("size-3", step.text)} />
          {!changed && <span className={step.text}>{step.label}</span>}
        </span>
      ))}
      {changed && <span className="ml-0.5 text-zinc-200">Changed</span>}
    </span>
  );
}
