import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import type { SessionSummary } from "../../types/telemetry";
import { buildTrackLapPaceBenchmark } from "../../analysis/trackLapPace";
import { cn } from "../../utils/cn";
import { formatShortDate, msToSectorTime } from "../../utils/format";
import { cardClass, interactiveFocusClass } from "../Card";
import { TrackFlag } from "../TrackFlag";
import { getTrackDisplayName } from "../../utils/tracks";
import { TrackLayout } from "../TrackLayout";
import { resolveSessionMode } from "../sessionModeMeta";
import {
  isProblemStatus,
  podiumIcon,
  positionLabel,
  positionTone,
  resultStatusLabel,
  signedNumber,
  type TrackLapRecord,
  type TrackRaceRecord,
  type TrackRecords,
  trackFormulaPath,
} from "./helpers";

function modeLabel(session: SessionSummary): string {
  return (
    resolveSessionMode(session.isOnline, session.aiDifficulty, true)?.label ??
    "Offline"
  );
}

function MetricShell({
  label,
  detail,
  children,
}: {
  label: string;
  detail?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-2xs font-medium uppercase tracking-wider text-zinc-500">
        {label}
      </div>
      <div className="mt-1 min-w-0">{children}</div>
      {detail && (
        <div className="mt-0.5 truncate font-mono text-2xs tabular-nums text-zinc-500">
          {detail}
        </div>
      )}
    </div>
  );
}

function LapMetric({
  label,
  record,
  tone,
}: {
  label: string;
  record: TrackLapRecord | undefined;
  tone: string;
}) {
  return (
    <MetricShell
      label={label}
      detail={record ? formatShortDate(record.session.date) : undefined}
    >
      <div
        className={cn(
          "truncate font-mono text-md font-semibold tabular-nums",
          record ? tone : "text-zinc-700",
        )}
      >
        {record?.time ?? "—"}
      </div>
    </MetricShell>
  );
}

function RaceMetric({ record }: { record: TrackRaceRecord | undefined }) {
  if (!record) {
    return (
      <MetricShell label="Race">
        <div className="truncate font-mono text-md font-semibold tabular-nums text-zinc-700">
          —
        </div>
      </MetricShell>
    );
  }

  const statusProblem = isProblemStatus(record.status);
  const Icon = podiumIcon(record.position);
  const tone = statusProblem ? "text-red-300" : positionTone(record.position);
  const detail = [
    statusProblem ? resultStatusLabel(record.status) : null,
    modeLabel(record.session),
    record.gridGain != null ? `${signedNumber(record.gridGain)} grid` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <MetricShell label="Race" detail={detail}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 truncate font-mono text-md font-semibold tabular-nums",
          tone,
        )}
      >
        {Icon ? <Icon className="size-3.5 shrink-0" /> : null}
        <span>{positionLabel(record.position)}</span>
      </div>
    </MetricShell>
  );
}

function PaceMetric({ sessions }: { sessions: SessionSummary[] }) {
  const benchmark = buildTrackLapPaceBenchmark(sessions);
  if (!benchmark) {
    return (
      <MetricShell label="Race pace vs. field" detail="No matched race data">
        <div className="truncate font-mono text-md font-semibold tabular-nums text-zinc-700">
          —
        </div>
      </MetricShell>
    );
  }

  const gap = benchmark.gapMs;
  const tone =
    gap === 0 ? "text-zinc-200" : gap > 0 ? "text-behind" : "text-ahead";
  const sign = gap > 0 ? "+" : gap < 0 ? "−" : "";
  const paceLabel = gap === 0 ? "matched" : gap > 0 ? "slower" : "faster";

  return (
    <MetricShell label="Race pace vs. field">
      <div
        className={cn(
          "truncate font-mono text-md font-semibold tabular-nums",
          tone,
        )}
      >
        {sign}
        {gap === 0 ? "0.000" : msToSectorTime(Math.abs(gap))}s {paceLabel}
      </div>
    </MetricShell>
  );
}

export function TrackOverviewCard({
  track,
  sessions,
  scopeKey,
  records,
}: {
  track: string;
  sessions: SessionSummary[];
  scopeKey: string | undefined;
  records: TrackRecords;
}) {
  const trackName = getTrackDisplayName(track);
  const lastDriven = sessions
    .map((session) => new Date(session.date).getTime())
    .sort((a, b) => b - a)[0];
  // Synthetic-only tracks have nothing to show on the TrackPage — render the
  // card as static, dim, and non-interactive in demo mode.
  const isSyntheticOnly = sessions.every((session) => session.isSynthetic);

  const inner = (
    <>
      <TrackLayout
        track={track}
        className="pointer-events-none absolute right-5 top-3 size-12 text-zinc-500/30 transition-colors group-hover:text-purple-400/50 sm:size-14 [&>svg]:size-full"
      />

      <div className="relative pr-20">
        <div className="flex min-w-0 items-center gap-1.5 text-base font-semibold">
          <TrackFlag track={track} />
          <span className="truncate">{trackName}</span>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs tabular-nums text-zinc-400">
          <span>
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
          </span>
          {lastDriven && (
            <span>
              Last {formatShortDate(new Date(lastDriven).toISOString())}
            </span>
          )}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-white/[0.06] pt-4">
        <RaceMetric record={records.race} />
        <LapMetric
          label="Qualifying"
          record={records.onlineQualifying}
          tone="text-best"
        />
        <PaceMetric sessions={sessions} />
      </div>
    </>
  );

  if (isSyntheticOnly) {
    return (
      <div
        title="Demo data — upload your telemetry to explore this track"
        className={cn(
          cardClass,
          "relative min-h-40 overflow-hidden opacity-70",
        )}
      >
        {inner}
      </div>
    );
  }

  if (!scopeKey) {
    return (
      <div
        className={cn(
          cardClass,
          "relative min-h-40 overflow-hidden opacity-70",
        )}
      >
        {inner}
      </div>
    );
  }

  return (
    <Link
      to={trackFormulaPath(track, scopeKey)}
      className={cn(
        cardClass,
        "group relative min-h-40 overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-800/50 hover:shadow-xl hover:shadow-black/20",
        interactiveFocusClass,
      )}
    >
      {inner}
    </Link>
  );
}
