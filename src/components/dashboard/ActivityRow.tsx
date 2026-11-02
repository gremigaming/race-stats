import { ChevronDown, Siren } from "lucide-react";
import { useState } from "react";
import type { DashboardActivityGroup } from "../../analysis/dashboardActivity";
import { useTelemetry } from "../../context/TelemetryContext";
import { formatTime } from "../../utils/format";
import { sessionSummaryPath } from "../../utils/routes";
import { getTrackDisplayName } from "../../utils/tracks";
import { SessionResultMetric } from "../SessionResultMetric";
import { SessionResultStatusBadge } from "../SessionResultStatusBadge";
import { SessionTypeBadge } from "../SessionTypeBadge";
import { TrackFlag } from "../TrackFlag";
import { SessionRow } from "../SessionRow";
import { resolveSessionMode } from "../sessionModeMeta";
import { Badge } from "../ui/Badge";
import { RaceIncidentList, useRaceIncidents } from "../safety/RaceIncidents";
import { cn } from "../../utils/cn";
import { driverKey as driverKeyOf } from "../../league/league";

function modeLabel(session: DashboardActivityGroup["representative"]): string {
  if (session.isSpectator) return "Spectator";
  return (
    resolveSessionMode(session.isOnline, session.aiDifficulty, true)?.label ??
    "Offline"
  );
}

function attemptLabel(activity: DashboardActivityGroup): string | null {
  const count = activity.sessions.length;
  if (count <= 1) return null;
  if (activity.kind === "race") return `${count} attempts`;
  return `best of ${count}`;
}

export function ActivityRow({
  activity,
}: {
  activity: DashboardActivityGroup;
}) {
  const { scopeKey, league } = useTelemetry();
  const session = activity.representative;
  const result = session.playerRaceResult;
  const attempt = attemptLabel(activity);
  const isTimeTrial = activity.kind === "time-trial";
  const trackName = getTrackDisplayName(session.track);

  // Time Trial is solo by definition — "Online · 1 drivers" is meaningless
  // noise. For race/quali, keep the field size when we actually have an
  // online lobby or a classified grid bigger than the player.
  const showMode = !isTimeTrial;
  const fieldSize = isTimeTrial
    ? 0
    : session.onlineDriverCount ||
      session.qualifyingFieldSize ||
      session.classifiedDriverCount ||
      result?.fieldSize ||
      0;
  const showFieldSize = fieldSize > 1;

  const row = (
    <SessionRow
      to={session.isSynthetic ? null : sessionSummaryPath(session, scopeKey)}
      leading={
        <>
          <TrackFlag track={session.track} />
          <span className="truncate text-sm font-medium text-zinc-100">
            {trackName}
          </span>
          <SessionTypeBadge
            sessionType={session.sessionType}
            formula={session.formula}
          />
          <SessionResultStatusBadge status={result?.status} />
          {attempt && (
            <Badge tone="zinc" className="max-sm:hidden">
              {attempt}
            </Badge>
          )}
        </>
      }
      meta={
        <>
          {formatTime(session.date)}
          {showMode && ` · ${modeLabel(session)}`}
          {showFieldSize && ` · ${fieldSize} drivers`}
          {result?.totalLaps
            ? ` · ${result.playerLaps}/${result.totalLaps} laps`
            : ""}
        </>
      }
      trailing={<SessionResultMetric session={session} kind={activity.kind} />}
    />
  );
  if (!league || isTimeTrial || session.isSynthetic) return row;
  return (
    <div>
      {row}
      <RaceIncidentsFold
        files={activity.sessions.map((s) => s.relativePath)}
        driver={league.selectedDriver}
      />
    </div>
  );
}

/** League race history: the chosen driver's incidents in this race, folded open under the row. */
function RaceIncidentsFold({ files, driver }: { files: string[]; driver: string }) {
  const [open, setOpen] = useState(false);
  const incidents = useRaceIncidents(files, driver);
  if (!incidents?.length) return null;
  const lost = incidents.reduce(
    (n, inc) => n + Math.min(0, inc.sides.find((s) => s.item && driverKeyOf(s.name) === driver)?.item?.pts ?? 0),
    0,
  );
  return (
    <div className="px-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1 inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200"
      >
        <Siren className="h-3 w-3 text-red-300/80" />
        {incidents.length} {incidents.length === 1 ? "incident" : "incidents"}
        {lost < 0 && <span className="font-mono text-red-300">{lost.toFixed(1).replace("-", "−")} SR pts</span>}
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mb-1 mt-1">
          <RaceIncidentList incidents={incidents} driver={driver} />
        </div>
      )}
    </div>
  );
}
