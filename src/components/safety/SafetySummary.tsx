import { Link } from "react-router-dom";
import { useTelemetry } from "../../context/TelemetryContext";
import { signedHalf, SR_START } from "../../league/safety";
import { cn } from "../../utils/cn";
import { RankTile } from "./RankTile";

/** The selected driver's SR, plus how it moved inside the date filter. */
export function SafetySummary() {
  const { league, scopeKey } = useTelemetry();
  const driver = league?.safety.get(league.selectedDriver);
  if (!league?.safetyData || !driver || driver.banned) return null;
  const inPeriod = new Set(league.races.map((r) => r.file));
  const streams = league.safetyData.streams;
  const hit = driver.history
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => streams[h.stream]?.files.some((f) => inPeriod.has(f)));
  let change: number | null = null;
  if (hit.length > 0) {
    const first = hit[0].i;
    const before = first > 0 ? driver.history[first - 1].sr : SR_START;
    change = hit[hit.length - 1].h.sr - before;
  }
  return (
    <Link
      to={`/${scopeKey ?? "all"}/safety`}
      className="flex items-center gap-3 rounded-xl bg-zinc-900/70 px-3 py-2 transition-colors hover:bg-zinc-900"
      title="Safety rating (not filtered by date)"
    >
      <RankTile sr={driver.sr} size={36} />
      <div className="leading-tight">
        <div className="font-mono text-lg font-bold tabular-nums text-zinc-100">
          {driver.sr.toFixed(1)}
        </div>
        <div className="text-[11px] text-zinc-500">
          Safety rating
          {change != null && (
            <>
              {" · "}
              <span
                className={cn(
                  change > 0 ? "text-emerald-300" : change < 0 ? "text-red-300" : "text-zinc-500",
                )}
              >
                {signedHalf(change)}
              </span>{" "}
              in {league.filterLabel}
            </>
          )}
        </div>
      </div>
    </Link>
  );
}
