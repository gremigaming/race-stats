import { rankOf, SR_RANKS, type SrRank } from "../../league/safety";
import { cn } from "../../utils/cn";

/** The rank letter, styled like the race control icons. */
export function RankTile({
  sr,
  rank,
  size = 32,
}: {
  sr?: number;
  rank?: SrRank;
  size?: number;
}) {
  const r = rank ?? rankOf(sr ?? 0);
  const top = r.rank === "S+";
  const fontSize = Math.round(size / 2) - (top ? 2 : 0);
  return (
    <span
      title={`Rank ${r.rank}`}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden font-extrabold tracking-tighter",
        "shadow-[inset_0_1px_0_rgba(255,255,255,.08)]",
        top && "sr-top",
      )}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 28 ? 8 : 5,
        fontSize,
        background: top
          ? "linear-gradient(160deg,rgba(254,243,199,.32),rgba(252,211,77,.16) 45%,rgba(180,83,9,.14))"
          : `linear-gradient(180deg,rgba(${r.rgb},.26),rgba(${r.rgb},.07))`,
      }}
    >
      <span
        className="bg-clip-text text-transparent"
        style={{
          backgroundImage: top
            ? "linear-gradient(180deg,#fffbeb,#fbbf24 72%)"
            : `linear-gradient(180deg,${r.light},${r.color} 72%)`,
        }}
      >
        {r.rank}
      </span>
    </span>
  );
}

/** Compact scale from S+ down to F. */
export function RankLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-[22px] overflow-hidden rounded-md", className)}>
      {SR_RANKS.map((r) => (
        <div
          key={r.rank}
          className="flex flex-1 items-center justify-center gap-1 border-r border-zinc-950/80 font-mono text-[10.5px] text-zinc-400 last:border-r-0"
          style={{ background: `linear-gradient(180deg,rgba(${r.rgb},.22),rgba(${r.rgb},.07))` }}
        >
          <b className="font-sans" style={{ color: r.color }}>
            {r.rank}
          </b>
          {r.label}
        </div>
      ))}
    </div>
  );
}
