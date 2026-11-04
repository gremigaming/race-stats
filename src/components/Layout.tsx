import {
  BarChart3,
  Bell,
  CalendarDays,
  ChevronDown,
  Clapperboard,
  FolderUp,
  Gamepad2,
  LayoutDashboard,
  Menu,
  Route,
  ShieldCheck,
  Swords,
  Trophy,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import changelog from "../data/changelog";
import { useTelemetry } from "../context/TelemetryContext";
import { SETUP_MANAGER_ON } from "../league/setupManager";
import { useGameScope } from "../hooks/useGameScope";
import { cn } from "../utils/cn";
import { LiveDot, useIsLive } from "../viewer/LiveTab";
import { dashboardPath } from "../utils/routes";
import { readStoredString, writeStoredString } from "../utils/storage";
import { CHANGELOG_SEEN_STORAGE_KEY } from "../constants/storage";
import { AppBrand } from "./AppBrand";
import { ChangelogModal } from "./ChangelogModal";
import { RankTile } from "./safety/RankTile";
import { DriverSearchSelect } from "./DriverSearchSelect";
import { LeagueFilterPanel } from "./LeagueFilterPanel";
import { SessionList } from "./SessionList";
import { PillSelect } from "./ui/PillSelect";

type NavGroupKey = "drivers" | "races";

const navButtonClass = (active: boolean, open = false) =>
  cn(
    "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70",
    active || open
      ? "bg-brand-wine/55 text-white ring-1 ring-inset ring-brand-red/20"
      : "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100",
  );

const routeItemClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70",
    isActive
      ? "bg-brand-wine/55 text-white"
      : "text-zinc-300 hover:bg-white/[0.05] hover:text-white",
  );

export function Layout() {
  const { mode, setShowUploadModal, scopeKey, league } = useTelemetry();
  const game = useGameScope();
  const isLive = useIsLive();
  const mySafety = league?.safety.get(league.selectedDriver);
  const location = useLocation();
  const routeParts = location.pathname.split("/").filter(Boolean);
  const section = routeParts[1];
  const pageScope = scopeKey ?? routeParts[0];
  const homePath = dashboardPath(pageScope);
  const [showChangelog, setShowChangelog] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sessionBrowserOpen, setSessionBrowserOpen] = useState(false);
  const [openGroup, setOpenGroup] = useState<NavGroupKey | null>(null);
  const desktopNavRef = useRef<HTMLElement>(null);
  const latestChangelogId = changelog[0]?.id ?? "";
  const [hasUnseen, setHasUnseen] = useState(
    () =>
      latestChangelogId !== "" &&
      readStoredString(CHANGELOG_SEEN_STORAGE_KEY) !== latestChangelogId,
  );

  const isDriversActive =
    section === "drivers" ||
    section === "head-to-head" ||
    section === "safety" ||
    section === "insights";
  const isRacesActive =
    section === "sessions" || section === "tracks" || section === "race";

  useEffect(() => {
    setMobileNavOpen(false);
    setSessionBrowserOpen(false);
    setOpenGroup(null);
  }, [location.pathname]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenGroup(null);
        setMobileNavOpen(false);
        setSessionBrowserOpen(false);
      }
    };
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        openGroup &&
        desktopNavRef.current &&
        !desktopNavRef.current.contains(event.target as Node)
      ) {
        setOpenGroup(null);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
    };
  }, [openGroup]);

  const openChangelog = useCallback(() => {
    setShowChangelog(true);
    if (latestChangelogId) {
      writeStoredString(CHANGELOG_SEEN_STORAGE_KEY, latestChangelogId);
      setHasUnseen(false);
    }
  }, [latestChangelogId]);

  // ?embed renders only the page, for Discord images and cards.
  if (new URLSearchParams(location.search).has("embed")) {
    return (
      <main className="min-h-screen bg-canvas">
        <Outlet />
      </main>
    );
  }

  const hasLeagueNavigation = Boolean(league && pageScope);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas text-zinc-100">
      <header className="relative z-40 shrink-0 border-b border-white/[0.07] bg-[#0d090c]/95 shadow-[0_10px_30px_rgba(0,0,0,0.18)] backdrop-blur-xl">
        <div className="brand-stripe-wash pointer-events-none absolute inset-x-0 top-0 h-px opacity-90" />
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => setMobileNavOpen((value) => !value)}
            aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"}
            aria-expanded={mobileNavOpen}
            aria-controls="mobile-navigation"
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70 lg:hidden"
          >
            {mobileNavOpen ? (
              <X className="size-5" />
            ) : (
              <Menu className="size-5" />
            )}
          </button>

          <Link
            to={homePath}
            aria-label="GreMi Gang Race Stats home"
            className="group flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
          >
            <span className="brand-mark flex size-9 shrink-0 items-center justify-center rounded-xl text-sm font-black tracking-tight text-white shadow-lg shadow-rose-950/25">
              GG
            </span>
            <span className="hidden min-w-0 sm:block">
              <span className="block truncate text-sm font-bold tracking-tight text-zinc-100 group-hover:text-white">
                <AppBrand />
              </span>
              <span className="block font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">
                Race stats
              </span>
            </span>
          </Link>

          {hasLeagueNavigation && (
            <nav
              ref={desktopNavRef}
              aria-label="Primary navigation"
              className="ml-2 hidden items-center gap-1 lg:flex"
            >
              <NavLink to={homePath} end className={routeItemClass}>
                <LayoutDashboard className="size-4" />
                Home
              </NavLink>
              <NavGroup
                label="Drivers"
                icon={Trophy}
                active={isDriversActive}
                open={openGroup === "drivers"}
                onToggle={() =>
                  setOpenGroup((current) =>
                    current === "drivers" ? null : "drivers",
                  )
                }
              >
                <DropdownLink to={`/${pageScope}/drivers`} icon={Trophy}>
                  Leaderboard
                </DropdownLink>
                <DropdownLink to={`/${pageScope}/head-to-head`} icon={Swords}>
                  Head to head
                </DropdownLink>
                <DropdownLink to={`/${pageScope}/safety`} icon={ShieldCheck}>
                  Safety rating
                </DropdownLink>
                <DropdownLink to={`/${pageScope}/insights`} icon={BarChart3}>
                  Performance insights
                </DropdownLink>
              </NavGroup>
              <NavGroup
                label="Races"
                icon={Route}
                active={isRacesActive}
                open={openGroup === "races"}
                onToggle={() =>
                  setOpenGroup((current) =>
                    current === "races" ? null : "races",
                  )
                }
              >
                <DropdownLink to={`/${pageScope}/sessions`} icon={CalendarDays}>
                  Sessions
                </DropdownLink>
                <DropdownLink to={`/${pageScope}/tracks`} icon={Route}>
                  Tracks
                </DropdownLink>
                <DropdownLink
                  to={`/${pageScope}/race`}
                  icon={Clapperboard}
                  badge={isLive ? <LiveDot className="ml-auto" /> : undefined}
                >
                  Race viewer
                </DropdownLink>
              </NavGroup>
              {SETUP_MANAGER_ON && (
                <NavLink to={`/${pageScope}/setups`} className={routeItemClass}>
                  <Wrench className="size-4" />
                  Setups
                </NavLink>
              )}
            </nav>
          )}

          {!hasLeagueNavigation && (
            <button
              type="button"
              onClick={() => setSessionBrowserOpen((value) => !value)}
              aria-expanded={sessionBrowserOpen}
              className={cn(
                "hidden min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70 lg:inline-flex",
                sessionBrowserOpen
                  ? "bg-brand-wine/55 text-white"
                  : "text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-100",
              )}
            >
              <CalendarDays className="size-4" />
              Sessions
              <ChevronDown
                className={cn(
                  "size-3.5 text-zinc-500 transition-transform",
                  sessionBrowserOpen && "rotate-180",
                )}
              />
            </button>
          )}

          <div className="ml-auto flex shrink-0 items-center gap-1">
            {!hasLeagueNavigation && (
              <button
                type="button"
                onClick={() => setSessionBrowserOpen((value) => !value)}
                aria-label="Browse sessions"
                aria-expanded={sessionBrowserOpen}
                className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 lg:hidden"
              >
                <CalendarDays className="size-4" />
              </button>
            )}
            <button
              type="button"
              onClick={openChangelog}
              title="What's new"
              aria-label="What's new"
              className="relative inline-flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
            >
              <Bell className="size-4" />
              {hasUnseen && (
                <span className="absolute right-2.5 top-2.5 size-1.5 rounded-full bg-brand-red ring-2 ring-[#0d090c]" />
              )}
            </button>
            {(mode === "upload" || mode === "demo") && (
              <button
                type="button"
                onClick={() => setShowUploadModal(true)}
                title="Load different data"
                aria-label="Load different data"
                className="inline-flex size-10 items-center justify-center rounded-xl text-zinc-400 transition-colors hover:bg-white/[0.06] hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70"
              >
                <FolderUp className="size-4" />
              </button>
            )}
          </div>
        </div>

        {((hasLeagueNavigation && league) || game.enabled) && (
          <div className="border-t border-white/[0.045] bg-white/[0.012]">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
              {league && league.drivers.length > 0 && (
                <div className="w-full sm:w-56">
                  <DriverSearchSelect
                    drivers={league.drivers}
                    value={league.selectedDriver}
                    onChange={league.setSelectedDriver}
                  />
                </div>
              )}
              {league?.safetyData && pageScope && (
                <Link
                  to={`/${pageScope}/safety`}
                  title={
                    mySafety
                      ? `Safety rating ${mySafety.sr.toFixed(1)} (not filtered by date)`
                      : "Safety rating (not filtered by date)"
                  }
                  aria-label="Open your safety rating"
                  className="hidden shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/70 sm:block"
                >
                  {mySafety ? (
                    <RankTile sr={mySafety.sr} size={34} />
                  ) : (
                    <span className="inline-flex size-[34px] items-center justify-center rounded-[9px] bg-zinc-800 text-zinc-400">
                      <ShieldCheck className="size-4" />
                    </span>
                  )}
                </Link>
              )}
              {league && (
                <div className="min-w-[9.5rem] flex-1 sm:w-48 sm:flex-none">
                  <LeagueFilterPanel />
                </div>
              )}
              {game.enabled && (
                <div className="min-w-[9.5rem] flex-1 sm:flex-none">
                  <PillSelect
                    value={game.value}
                    onChange={game.setGame}
                    options={game.options}
                    ariaLabel="Game scope"
                    leadingIcon={Gamepad2}
                    width="full"
                    size="sm"
                  />
                </div>
              )}
              {league?.analysisPending && (
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[11px] font-medium text-amber-200/90">
                  <span className="size-1.5 animate-pulse rounded-full bg-amber-300" />
                  Race analysis updating
                </span>
              )}
            </div>
          </div>
        )}

        {mobileNavOpen && hasLeagueNavigation && pageScope && (
          <nav
            id="mobile-navigation"
            aria-label="Mobile navigation"
            className="border-t border-white/[0.06] bg-[#100b0f] px-4 py-4 shadow-xl lg:hidden"
          >
            <div className="mx-auto grid max-w-7xl gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div className="space-y-1">
                <p className="px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Your stats
                </p>
                <MobileNavLink to={homePath} icon={LayoutDashboard}>
                  Home
                </MobileNavLink>
                <MobileNavLink to={`/${pageScope}/drivers`} icon={Trophy}>
                  Leaderboard
                </MobileNavLink>
                <MobileNavLink to={`/${pageScope}/head-to-head`} icon={Swords}>
                  Head to head
                </MobileNavLink>
                <MobileNavLink to={`/${pageScope}/safety`} icon={ShieldCheck}>
                  Safety rating
                </MobileNavLink>
                <MobileNavLink to={`/${pageScope}/insights`} icon={BarChart3}>
                  Performance insights
                </MobileNavLink>
              </div>
              <div className="space-y-1">
                <p className="px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                  Race archive
                </p>
                <MobileNavLink
                  to={`/${pageScope}/sessions`}
                  icon={CalendarDays}
                >
                  Sessions
                </MobileNavLink>
                <MobileNavLink to={`/${pageScope}/tracks`} icon={Route}>
                  Tracks
                </MobileNavLink>
                <MobileNavLink
                  to={`/${pageScope}/race`}
                  icon={Clapperboard}
                  badge={isLive ? <LiveDot className="ml-auto" /> : undefined}
                >
                  Race viewer
                </MobileNavLink>
              </div>
              {SETUP_MANAGER_ON && (
                <div className="space-y-1">
                  <p className="px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    Setups
                  </p>
                  <MobileNavLink to={`/${pageScope}/setups`} icon={Wrench}>
                    Setup manager
                  </MobileNavLink>
                </div>
              )}
            </div>
          </nav>
        )}

        {mobileNavOpen && !hasLeagueNavigation && (
          <div
            id="mobile-navigation"
            className="border-t border-white/[0.06] px-4 py-3 lg:hidden"
          >
            <p className="mx-auto max-w-7xl px-1 text-sm text-zinc-400">
              Choose a session below, or load a telemetry archive.
            </p>
          </div>
        )}

        {sessionBrowserOpen && !hasLeagueNavigation && (
          <div className="absolute left-4 right-4 top-full z-50 mx-auto h-[min(70vh,42rem)] max-w-7xl overflow-hidden rounded-b-2xl bg-black shadow-2xl shadow-black/60 ring-1 ring-white/[0.08] sm:left-6 sm:right-6 lg:left-8 lg:right-8">
            <SessionList />
          </div>
        )}
      </header>

      <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-canvas">
        {mode === "demo" && (
          <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
            <div className="brand-stripe-wash relative flex flex-wrap items-center justify-between gap-4 overflow-hidden rounded-2xl border border-white/[0.08] px-5 py-4 sm:px-6">
              <div className="relative">
                <h2 className="text-base font-bold tracking-tight text-white">
                  <AppBrand />
                </h2>
                <p className="mt-0.5 text-sm text-zinc-300/80">
                  Dive into your{" "}
                  <a
                    href="https://www.pitsngiggles.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-rose-200 underline decoration-rose-200/40 underline-offset-2 hover:text-white"
                  >
                    Pits n&apos; Giggles
                  </a>{" "}
                  telemetry.
                </p>
              </div>
              <button
                onClick={() => setShowUploadModal(true)}
                className="relative inline-flex shrink-0 items-center gap-2 rounded-xl bg-gradient-to-r from-brand-red to-brand-violet px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-rose-950/30 transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
              >
                Load telemetry
                <FolderUp className="size-4" />
              </button>
            </div>
          </div>
        )}
        <Outlet />
      </main>

      {showChangelog && (
        <ChangelogModal onClose={() => setShowChangelog(false)} />
      )}
    </div>
  );
}

function NavGroup({
  label,
  icon: Icon,
  active,
  open,
  onToggle,
  children,
}: {
  label: string;
  icon: LucideIcon;
  active: boolean;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={onToggle}
        className={navButtonClass(active, open)}
      >
        <Icon className="size-4" />
        {label}
        <ChevronDown
          className={cn(
            "size-3.5 text-zinc-500 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-56 rounded-2xl bg-zinc-950/98 p-2 shadow-2xl shadow-black/60 ring-1 ring-white/[0.08] backdrop-blur-xl">
          {children}
        </div>
      )}
    </div>
  );
}

function DropdownLink({
  to,
  icon: Icon,
  badge,
  children,
}: {
  to: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink to={to} className={routeItemClass}>
      <Icon className="size-4 shrink-0 text-zinc-500" />
      <span className="min-w-0 flex-1">{children}</span>
      {badge}
    </NavLink>
  );
}

function MobileNavLink({
  to,
  icon: Icon,
  badge,
  children,
}: {
  to: string;
  icon: LucideIcon;
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <NavLink to={to} className={routeItemClass}>
      <Icon className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">{children}</span>
      {badge}
    </NavLink>
  );
}
