import { CalendarDays, Flag, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTelemetry } from "../context/TelemetryContext";
import { SessionList } from "../components/SessionList";
import { useSessionList } from "../hooks/useSessionList";
import { getSessionFormulaScopeKey } from "../utils/formulaScope";
import { getTrackId } from "../utils/tracks";

export function SessionsPage() {
  const { activeFormula, activeFormulaKey, league } = useTelemetry();
  const { sessions, loading } = useSessionList();
  const scopedSessions = activeFormulaKey
    ? sessions.filter(
        (session) => getSessionFormulaScopeKey(session) === activeFormulaKey,
      )
    : sessions;
  const trackCount = new Set(
    scopedSessions.map((session) => getTrackId(session.track)),
  ).size;
  const dayCount = new Set(
    scopedSessions.map((session) => session.date.split("T")[0]),
  ).size;
  const sessionCount = loading ? "—" : scopedSessions.length.toLocaleString();
  const trackCountLabel = loading ? "—" : trackCount.toLocaleString();
  const dayCountLabel = loading ? "—" : dayCount.toLocaleString();

  return (
    <div className="mx-auto max-w-5xl space-y-5 px-4 py-5 sm:px-6 sm:py-7">
      <header className="relative isolate overflow-hidden rounded-3xl border border-white/[0.08] bg-[#100b0f] px-5 py-5 shadow-xl shadow-black/20 sm:px-7 sm:py-6">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_0%_0%,rgba(190,24,93,0.18),transparent_58%),radial-gradient(ellipse_at_100%_100%,rgba(124,58,237,0.14),transparent_54%)]"
        />
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rose-300/10 bg-rose-300/[0.06] px-2.5 py-1 font-mono text-2xs font-semibold uppercase tracking-[0.16em] text-rose-200/75">
              <CalendarDays className="size-3.5" aria-hidden="true" />
              Session archive
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              All sessions
            </h1>
            <p className="mt-1.5 text-sm text-zinc-400">
              {activeFormula?.label ?? "All games"} ·{" "}
              {league?.filterLabel ?? "All available dates"}
            </p>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-zinc-500">
              Find a race, qualifying run, or personal best by track, type, or
              date.
            </p>
          </div>

          <dl className="grid grid-cols-3 gap-2 sm:w-[19rem] sm:shrink-0">
            <ArchiveStat icon={Flag} value={sessionCount} label="Sessions" />
            <ArchiveStat icon={MapPin} value={trackCountLabel} label="Tracks" />
            <ArchiveStat
              icon={CalendarDays}
              value={dayCountLabel}
              label="Days"
            />
          </dl>
        </div>
      </header>

      <SessionList section="sessions" showAllSessions />
    </div>
  );
}

function ArchiveStat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-white/[0.07] bg-black/20 px-2.5 py-2.5 sm:px-3.5 sm:py-3">
      <dt className="flex items-center gap-1 text-3xs font-medium text-zinc-500">
        <Icon className="size-3 shrink-0 text-zinc-400" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-zinc-100 sm:text-xl">
        {value}
      </dd>
    </div>
  );
}
