import { useId } from "react";
import { METAL, PR_RANKS, prRankOf } from "../../league/performance";
import { cn } from "../../utils/cn";

/** The Performance Rating emblem: a bevelled metal hexagon with the rank's Roman numeral. */
export function PrBadge({
  pr,
  size = 32,
  className,
}: {
  pr: number;
  size?: number;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const r = prRankOf(pr);
  const m = METAL[r.metal];
  const fontSize = r.numeral.length === 3 ? 30 : r.numeral.length === 2 ? 34 : 38;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`Performance rank ${r.metal} ${r.numeral}`}
      className={cn("shrink-0", className)}
    >
      <title>{`Performance rank ${r.metal} ${r.numeral} · PR ${pr.toFixed(1)}`}</title>
      <defs>
        <linearGradient id={`${id}a`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </linearGradient>
        <linearGradient id={`${id}b`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor={m.hi} />
          <stop offset=".45" stopColor={m.mid} />
          <stop offset="1" stopColor={m.lo} />
        </linearGradient>
      </defs>
      <polygon points="50,2 92,26 92,74 50,98 8,74 8,26" fill={`url(#${id}a)`} />
      <polygon
        points="50,13 82,31 82,69 50,87 18,69 18,31"
        fill={`url(#${id}b)`}
        opacity=".85"
      />
      <text
        x="50"
        y="62"
        textAnchor="middle"
        fontFamily="Inter, system-ui, sans-serif"
        fontWeight={800}
        fontSize={fontSize}
        letterSpacing="-1"
        fill={m.ink}
      >
        {r.numeral}
      </text>
    </svg>
  );
}

/** Every PR rank from Bronze I to Gold III with its score. */
export function PrRankLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-2 text-xs text-zinc-400", className)}>
      {[...PR_RANKS].reverse().map((r) => (
        <span key={`${r.metal}${r.numeral}`} className="inline-flex items-center gap-1.5">
          <PrBadge pr={Number.isFinite(r.min) ? r.min : 1} size={20} />
          {r.metal} {r.numeral}
          <span className="text-zinc-600">{r.label}</span>
        </span>
      ))}
    </div>
  );
}
