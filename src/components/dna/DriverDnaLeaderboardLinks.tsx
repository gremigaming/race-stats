import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import {
  driverDnaSignalLabel,
  type DriverDnaSignal,
} from "../../analysis/driverDna";
import { cn } from "../../utils/cn";
import { driverDnaLeaderboardPath } from "../../utils/routes";

export const DRIVER_DNA_SIGNAL_INFO: Record<DriverDnaSignal, string> = {
  recovery:
    "Grid-to-finish places gained, adjusted for field size and ranked against the other drivers in this view.",
  grid: "Starting position, normalized for field size. Drivers who start further forward rank higher.",
  pole: "Pole positions per start, compared with the other drivers in this view.",
  stability:
    "How tightly a driver's classified finishing positions cluster around their usual result.",
  openingLap:
    "Places gained by the end of lap one, adjusted for field size and ranked against peers.",
  overtaking:
    "Recorded passes per race, adjusted for field size and ranked against peers.",
  podium:
    "Top-three finishes earn more weight in larger fields, based on how unlikely a podium is by chance; scores are averaged across classified finishes.",
  fastestLap: "Fastest laps as a share of race starts.",
  reliability: "Classified finishes as a share of race starts.",
  lapsLed: "Share of recorded race laps spent in the lead.",
  racePace:
    "Race pace compared with the field in each race, then combined across the selected window.",
  cleanRacing:
    "A blend of clean close-racing sectors, contact-free close battles, and clean overtakes.",
  wetPerformance:
    "Wet-race performance compared with the same driver's dry-race baseline.",
  tyreCare:
    "Estimated worst-wheel wear added per lap from recorded wear curves. Lower rates rank higher, compared with drivers on the same compound in the same race.",
  streetPerformance:
    "Street-circuit performance compared with the same driver's other circuits.",
  qualifyingPace:
    "Best valid lap ranked against the timed field in each qualifying session, then averaged across the selected window.",
  qualifyingPosition:
    "Qualifying positions normalized for field size, using fastest-lap rank when a result position is missing.",
  qualifyingPoleRate:
    "Qualifying poles as a share of sessions with a classified position or valid fastest lap.",
  finish: "Average classified finishing position, normalized for field size.",
};

export const DRIVER_DNA_SIGNALS = Object.keys(
  DRIVER_DNA_SIGNAL_INFO,
) as DriverDnaSignal[];

export function DriverDnaLeaderboardLinks({
  scopeKey,
  search = "",
  counts,
  compact = false,
}: {
  scopeKey: string | null | undefined;
  search?: string;
  counts?: Partial<Record<DriverDnaSignal, number>>;
  compact?: boolean;
}) {
  const params = new URLSearchParams(search);
  params.delete("profile");
  params.delete("driver");
  params.delete("embed");
  const query = params.size ? `?${params.toString()}` : "";

  return (
    <div
      className={cn(
        "grid",
        compact
          ? "grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4"
          : "gap-2.5 sm:grid-cols-2 xl:grid-cols-3",
      )}
    >
      {DRIVER_DNA_SIGNALS.map((signal) => {
        const count = counts?.[signal];
        return (
          <Link
            key={signal}
            to={`${driverDnaLeaderboardPath(scopeKey, signal)}${query}`}
            className={cn(
              "group border border-white/[0.07] bg-zinc-950/50 transition hover:border-cyan-300/30 hover:bg-cyan-300/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300",
              compact ? "rounded-lg px-2.5 py-2" : "rounded-xl p-3.5",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-zinc-100 transition group-hover:text-cyan-200">
                {driverDnaSignalLabel(signal)}
              </span>
              <ArrowUpRight className="size-3.5 shrink-0 text-zinc-600 transition group-hover:text-cyan-200" />
            </span>
            {!compact && (
              <span className="mt-1.5 block min-h-10 text-xs leading-relaxed text-zinc-400">
                {DRIVER_DNA_SIGNAL_INFO[signal]}
              </span>
            )}
            {count != null ? (
              <span
                className={cn(
                  "block font-mono text-[10px] tabular-nums text-zinc-500",
                  compact ? "mt-0.5" : "mt-2",
                )}
              >
                {count} {count === 1 ? "driver ranked" : "drivers ranked"}
              </span>
            ) : compact ? (
              <span className="mt-0.5 block truncate text-[10px] text-zinc-500">
                Open leaderboard
              </span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}
