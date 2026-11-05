import { NavLink } from "react-router-dom";
import type { SessionSummary } from "../types/telemetry";
import { useTelemetry } from "../context/TelemetryContext";
import { cn } from "../utils/cn";
import { formatSessionType, formatTime } from "../utils/format";
import { sessionSummaryPath } from "../utils/routes";
import { interactiveFocusClass } from "./Card";
import { SessionCard } from "./SessionCard";

interface SessionListItemProps {
  session: SessionSummary;
  isTrackBest: boolean;
  hideMode: boolean;
}

/** One session sidebar row, interactive for real data and static for demo data. */
export function SessionListItem({
  session,
  isTrackBest,
  hideMode,
}: SessionListItemProps) {
  const { scopeKey } = useTelemetry();
  const card = (
    <SessionCard
      sessionType={formatSessionType(session.sessionType, session.formula)}
      track={session.track}
      time={formatTime(session.date)}
      lapIndicators={session.lapIndicators}
      bestLapTime={session.bestLapTime}
      isTrackBest={isTrackBest}
      aiDifficulty={session.aiDifficulty}
      isOnline={session.isOnline}
      isSpectator={session.isSpectator}
      hideMode={hideMode}
    />
  );

  if (session.isSynthetic) {
    return (
      <div
        title="Demo data — upload your telemetry to explore detail"
        className="block rounded-xl border border-dashed border-white/[0.045] bg-zinc-900/20 px-3 py-2.5 text-zinc-500"
      >
        {card}
      </div>
    );
  }

  return (
    <NavLink
      to={sessionSummaryPath(session, scopeKey)}
      className={({ isActive }) =>
        cn(
          "block rounded-xl border px-3 py-2.5 transition-colors",
          isActive
            ? "border-rose-300/20 bg-gradient-to-r from-brand-red/[0.13] to-brand-violet/[0.09] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
            : "border-white/[0.045] bg-zinc-900/35 text-zinc-300 hover:border-rose-300/15 hover:bg-zinc-900/70 hover:text-white",
          interactiveFocusClass,
        )
      }
    >
      {card}
    </NavLink>
  );
}
