import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Clapperboard,
  Flag,
  Trophy,
  UsersRound,
  Wrench,
} from "lucide-react";
import { Link } from "react-router-dom";
import { buildDashboardActivity } from "../analysis/dashboardActivity";
import { getDashboardResultStats } from "../analysis/dashboardResultStats";
import { ActivityRow } from "../components/dashboard/ActivityRow";
import { LoadingState } from "../components/ui/LoadingState";
import { PageFrame } from "../components/ui/PageFrame";
import { useTelemetry } from "../context/TelemetryContext";
import { SETUP_MANAGER_ON } from "../league/setupManager";
import {
  areSessionFiltersDefault,
  matchesSessionFilters,
  useSessionFilters,
} from "../hooks/useSessionFilters";
import { useSessionList } from "../hooks/useSessionList";
import { cn } from "../utils/cn";
import { dashboardPath } from "../utils/routes";

const SHORTCUTS = [
  {
    key: "drivers",
    label: "Drivers",
    detail: "Leaderboard and team standings",
    icon: Trophy,
    path: "drivers",
    tone: "from-rose-500/15 to-fuchsia-500/5 text-rose-200",
  },
  {
    key: "sessions",
    label: "Race history",
    detail: "Browse every saved session",
    icon: CalendarDays,
    path: "sessions",
    tone: "from-violet-500/15 to-indigo-500/5 text-violet-200",
  },
  {
    key: "tracks",
    label: "Tracks",
    detail: "Records, pace, and progress",
    icon: Flag,
    path: "tracks",
    tone: "from-fuchsia-500/15 to-rose-500/5 text-fuchsia-200",
  },
  {
    key: "race",
    label: "Race viewer",
    detail: "Watch a replay or live race",
    icon: Clapperboard,
    path: "race",
    tone: "from-red-500/15 to-orange-500/5 text-red-200",
  },
  {
    key: "insights",
    label: "Performance insights",
    detail: "Pace trends and rival comparisons",
    icon: BarChart3,
    path: "insights",
    tone: "from-sky-500/15 to-violet-500/5 text-sky-200",
  },
] as const;

export function DashboardPage() {
  const { sessions, loading } = useSessionList();
  const { mode, scopeKey, activeFormulaKey, activeFormula, league } =
    useTelemetry();
  const [filters] = useSessionFilters();
  const driverName = league?.drivers.find(
    (driver) => driver.key === league.selectedDriver,
  )?.name;
  const rootPath = dashboardPath(scopeKey ?? "all");

  if (loading) {
    return <LoadingState label="Loading sessions" />;
  }

  const dashboardSessions = sessions.filter(
    (session) => session.validLapCount > 0 || session.playerRaceResult != null,
  );
  const visibleSessions = dashboardSessions.filter((session) =>
    matchesSessionFilters(session, filters),
  );
  const stats = getDashboardResultStats(visibleSessions, activeFormulaKey);
  const recentActivity = buildDashboardActivity(stats.scopedSessions, 4);
  const hasData = stats.scopedSessions.length > 0;
  const filtered = !areSessionFiltersDefault(filters);
  const formulaLabel = activeFormula?.label ?? "All games";

  return (
    <PageFrame className="space-y-5 sm:space-y-6">
      <section className="brand-stripe-wash relative isolate overflow-hidden rounded-3xl border border-white/[0.08] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/15"
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-200/75">
              Driver home
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {mode === "demo"
                ? "Explore the stats"
                : `Welcome, ${driverName ?? "driver"}`}
            </h1>
            <p className="mt-1.5 text-sm text-zinc-200/75">
              {formulaLabel} ·{" "}
              {league?.filterLabel ?? "Your saved race sessions"}
              {filtered ? " · Filtered" : ""}
            </p>
          </div>
        </div>

        {hasData ? (
          <div className="relative mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
            <SummaryStat
              label="Average finish"
              value={
                stats.averageFinish == null
                  ? "—"
                  : `P${stats.averageFinish.toFixed(1)}`
              }
            />
            <SummaryStat label="Wins" value={stats.wins} />
            <SummaryStat
              label="Podiums"
              value={stats.p2 + stats.p3 + stats.wins}
            />
            <SummaryStat label="Race starts" value={stats.starts} />
          </div>
        ) : (
          <div className="relative mt-6 rounded-2xl border border-white/[0.08] bg-black/20 px-4 py-5">
            <p className="text-sm font-semibold text-zinc-100">
              No sessions in this view yet
            </p>
            <p className="mt-1 text-sm text-zinc-300/70">
              {filtered
                ? "Adjust the time or session filters to see more of your racing history."
                : "Load telemetry or choose another game scope to get started."}
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="quick-links-heading">
        <div className="mb-3 flex items-end justify-between gap-3 px-1">
          <div>
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200/60">
              Go to
            </p>
            <h2
              id="quick-links-heading"
              className="mt-0.5 text-lg font-semibold text-white"
            >
              Your racing tools
            </h2>
          </div>
          <span className="hidden text-xs text-zinc-500 sm:block">
            Pick up where you want to race
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {SHORTCUTS.map(({ key, label, detail, icon: Icon, path, tone }) => (
            <Link
              key={key}
              to={`${rootPath}/${path}`}
              className="group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/65 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-rose-300/20 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
            >
              <span
                aria-hidden="true"
                className="brand-stripe-wash pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-20"
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-3 left-0 z-10 w-0.5 rounded-full bg-gradient-to-b from-brand-red/35 via-brand-red/80 to-brand-violet/45 opacity-70 transition-opacity group-hover:opacity-100"
              />
              <span
                className={cn(
                  "relative z-10 flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ring-1 ring-inset ring-white/[0.06]",
                  tone,
                )}
              >
                <Icon className="size-5" />
              </span>
              <span className="relative z-10 min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100 group-hover:text-white">
                  {label}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {detail}
                </span>
              </span>
              <ArrowRight className="relative z-10 size-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-rose-200" />
            </Link>
          ))}
          {SETUP_MANAGER_ON && (
            <Link
              to={`${rootPath}/setups`}
              className="group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/65 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-violet-300/20 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500/15 to-sky-500/5 text-violet-200 ring-1 ring-inset ring-white/[0.06]">
                <Wrench className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-zinc-100 group-hover:text-white">
                  Setups
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Recommendations by track
                </span>
              </span>
              <ArrowRight className="size-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-violet-200" />
            </Link>
          )}
          <Link
            to={`${rootPath}/head-to-head`}
            className="group relative flex min-h-24 items-center gap-3 overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/65 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-fuchsia-300/20 hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
          >
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500/15 to-violet-500/5 text-fuchsia-200 ring-1 ring-inset ring-white/[0.06]">
              <UsersRound className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-zinc-100 group-hover:text-white">
                Head to head
              </span>
              <span className="mt-0.5 block text-xs text-zinc-500">
                Compare your races with a rival
              </span>
            </span>
            <ArrowRight className="size-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-fuchsia-200" />
          </Link>
        </div>
      </section>

      {recentActivity.length > 0 && (
        <section aria-labelledby="recent-activity-heading">
          <div className="mb-3 flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-rose-200/60">
                Latest laps
              </p>
              <h2
                id="recent-activity-heading"
                className="mt-0.5 text-lg font-semibold text-white"
              >
                Recent activity
              </h2>
            </div>
            <Link
              to={`${rootPath}/sessions`}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-400 transition hover:bg-white/[0.05] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
            >
              All sessions <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="space-y-1.5">
            {recentActivity.slice(0, 3).map((activity) => (
              <ActivityRow key={activity.key} activity={activity} />
            ))}
          </div>
        </section>
      )}
    </PageFrame>
  );
}

function SummaryStat({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 sm:px-4 sm:py-3">
      <p className="font-mono text-[10px] uppercase tracking-[0.13em] text-zinc-400/80">
        {label}
      </p>
      <p className="mt-1 font-mono text-xl font-bold tabular-nums text-white sm:text-2xl">
        {value}
      </p>
    </div>
  );
}
