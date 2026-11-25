import { Link } from "react-router-dom";
import { useTelemetry } from "../../context/TelemetryContext";
import { prRankName } from "../../league/performance";
import { cn } from "../../utils/cn";
import { interactiveFocusClass } from "../Card";
import { PrBadge } from "./PrBadge";

/** The selected driver's PR on the home page, before the SR tile. */
export function PerformanceSummary() {
  const { league, scopeKey } = useTelemetry();
  const d = league?.performance.get(league.selectedDriver);
  if (!league?.performanceData || !d) return null;
  const pos = league.performanceData.drivers.indexOf(d) + 1;
  return (
    <Link
      to={`/${scopeKey ?? "all"}/performance?tab=driver&driver=${encodeURIComponent(league.selectedDriver)}`}
      className={cn("flex items-center gap-3 rounded-xl bg-zinc-900/70 px-3 py-2 transition-colors hover:bg-zinc-900", interactiveFocusClass)}
      title="Performance rating (not filtered by date)"
    >
      <PrBadge pr={d.pr} size={36} />
      <div className="leading-tight">
        <div className="font-mono text-lg font-bold tabular-nums text-zinc-100">{d.pr.toFixed(1)}</div>
        <div className="text-[11px] text-zinc-500">
          Performance rating · {prRankName(d.pr)} · #{pos}
        </div>
      </div>
    </Link>
  );
}
