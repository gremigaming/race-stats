import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, TelemetrySession } from "../types/telemetry";
import {
  detectDataSource,
  fetchSessionList,
  getSessionPollIntervalMs,
  sessionDetailQueryOptions,
  telemetryKeys,
  type Mode,
  type SessionDetailQueryOptions,
} from "../queries/telemetry";
import {
  loadZipFile,
  loadJsonFiles,
  type LoadedSessionSummary,
} from "./zipLoader";
import { deduplicateSessions } from "../utils/deduplicateSessions";
import {
  ALL_FORMULA_SCOPE_KEY,
  getFormulaScopeOptions,
  isAllFormulaScope,
  resolveFormulaScopeAlias,
  type FormulaScopeOption,
} from "../utils/formulaScope";
import { getFormulaScopeCandidateFromPath, isRootPath } from "../utils/routes";
import { buildSessionSummary } from "../utils/sessionSummary";
import {
  asSeenBy,
  listDrivers,
  type LeagueDriver,
  type LeagueIndex,
  type LeagueRace,
} from "../league/league";
import { safetyByKey, type SafetyData, type SafetyDriver } from "../league/safety";
import {
  allowedFiles,
  buildStreams,
  describeFilter,
  readStoredFilter,
  storeFilter,
  type LeagueFilter,
  type Stream,
} from "../league/filter";

export interface LeagueState {
  /** Races inside the site-wide filter. */
  races: LeagueRace[];
  /** Every race, whatever the filter says. */
  allRaces: LeagueRace[];
  drivers: LeagueDriver[];
  selectedDriver: string;
  setSelectedDriver: (key: string) => void;
  filter: LeagueFilter;
  setFilter: (filter: LeagueFilter) => void;
  filterLabel: string;
  streams: Stream[];
  /** Safety rating per driver key. Never date-filtered. */
  safety: Map<string, SafetyDriver>;
  safetyData: SafetyData | null;
}

const LEAGUE_DRIVER_STORAGE_KEY = "league-driver";

// Session files never change once published, so they are fetched once; only
// the index is re-read to pick up new races while the page is open.
const leagueSessionCache = new Map<string, TelemetrySession>();
let lastLeague: { index: LeagueIndex; races: LeagueRace[]; safety: SafetyData | null } | null = null;

async function fetchLeague(): Promise<{
  index: LeagueIndex;
  races: LeagueRace[];
  safety: SafetyData | null;
}> {
  const base = `${import.meta.env.BASE_URL}league/`;
  const res = await fetch(`${base}index.json?t=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load league index");
  const index = (await res.json()) as LeagueIndex;
  if (lastLeague && lastLeague.index.files.join("\n") === index.files.join("\n")) {
    return lastLeague;
  }
  const races = await Promise.all(
    index.files.map(async (file) => {
      let session = leagueSessionCache.get(file);
      if (!session) {
        const r = await fetch(`${base}sessions/${encodeURIComponent(file)}`);
        if (!r.ok) throw new Error(`Failed to load ${file}`);
        session = (await r.json()) as TelemetrySession;
        leagueSessionCache.set(file, session);
      }
      return { file, session };
    }),
  );
  // The rating is built alongside the race files; a missing file just hides it
  const safety = await fetch(`${base}safety.json?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? (r.json() as Promise<SafetyData>) : null))
    .catch(() => null);
  lastLeague = { index, races, safety };
  return lastLeague;
}

function initialDriver(): string | null {
  const fromUrl = new URLSearchParams(window.location.search).get("driver");
  if (fromUrl) return fromUrl.toLowerCase();
  try {
    return window.localStorage.getItem(LEAGUE_DRIVER_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface TelemetryContextValue {
  mode: Mode;
  sessions: SessionSummary[];
  sessionsLoading: boolean;
  sessionsError: string | null;
  formulaOptions: FormulaScopeOption[];
  /** First URL segment: a game key or "all". */
  scopeKey: string | undefined;
  /** The game being filtered to; undefined when the scope is "all". */
  activeFormulaKey: string | undefined;
  activeFormula: FormulaScopeOption | undefined;
  getSession: (slug: string) => Promise<TelemetrySession>;
  getSessionQueryOptions: (slug: string) => SessionDetailQueryOptions;
  loadFiles: (files: File[]) => Promise<void>;
  showUploadModal: boolean;
  setShowUploadModal: (show: boolean) => void;
  filesLoading: boolean;
  league: LeagueState | null;
}

const TelemetryContext = createContext<TelemetryContextValue | null>(null);

// Stable fallback so consumers memoized on `sessions` don't recompute while empty.
const EMPTY_SESSIONS: SessionSummary[] = [];

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx)
    throw new Error("useTelemetry must be used within TelemetryProvider");
  return ctx;
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [filesLoading, setFilesLoading] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  // Upload mode overrides whatever the startup probe detected, permanently for
  // this visit — dropping files while browsing api/demo data switches sources.
  const [uploadedSessions, setUploadedSessions] = useState<
    SessionSummary[] | null
  >(null);
  // In-memory store for upload mode
  const [sessionStore] = useState(() => new Map<string, TelemetrySession>());

  const detectionQuery = useQuery({
    queryKey: telemetryKeys.dataSource,
    queryFn: () => detectDataSource(queryClient),
    // Detection is a one-shot startup decision. Never refetch it: a transient
    // API blip on refocus must not flip a working api-mode UI into demo mode.
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const mode: Mode = uploadedSessions
    ? "upload"
    : (detectionQuery.data?.mode ?? "detecting");

  const leagueQuery = useQuery({
    queryKey: ["league"],
    queryFn: fetchLeague,
    enabled: detectionQuery.data?.mode === "league",
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
    // New races show up without a reload; unchanged data keeps its identity
    refetchInterval: 60_000,
    structuralSharing: false,
  });
  const [pickedDriver, setPickedDriver] = useState<string | null>(initialDriver);
  const [filter, setFilterState] = useState<LeagueFilter>(readStoredFilter);
  const setFilter = useCallback((next: LeagueFilter) => {
    setFilterState(next);
    storeFilter(next);
  }, []);
  const safetyData = leagueQuery.data?.safety ?? null;
  const safety = useMemo(() => safetyByKey(safetyData), [safetyData]);
  const streams = useMemo(
    () => (leagueQuery.data ? buildStreams(leagueQuery.data.races) : []),
    [leagueQuery.data],
  );
  const filteredRaces = useMemo(() => {
    if (!leagueQuery.data) return [];
    const allowed = allowedFiles(filter, leagueQuery.data.races, streams);
    return allowed
      ? leagueQuery.data.races.filter((r) => allowed.has(r.file))
      : leagueQuery.data.races;
  }, [leagueQuery.data, filter, streams]);
  const leagueDrivers = useMemo(
    () => (leagueQuery.data ? listDrivers(leagueQuery.data.races) : []),
    [leagueQuery.data],
  );
  const selectedDriver =
    (pickedDriver && leagueDrivers.some((d) => d.key === pickedDriver)
      ? pickedDriver
      : null) ??
    (leagueQuery.data?.index.defaultDriver &&
    leagueDrivers.some((d) => d.key === leagueQuery.data?.index.defaultDriver)
      ? leagueQuery.data.index.defaultDriver
      : leagueDrivers[0]?.key) ??
    "";
  const setSelectedDriver = useCallback((key: string) => {
    setPickedDriver(key);
    try {
      window.localStorage.setItem(LEAGUE_DRIVER_STORAGE_KEY, key);
    } catch {
      // storage unavailable — the choice lasts for this visit only
    }
  }, []);
  // Every page reads summaries/details as "the player", so build them from
  // each race as seen by the chosen driver.
  // Built for every race so session pages and game scopes keep working outside
  // the filter; the filtered list is what pages show.
  const allLeagueSessions = useMemo(() => {
    if (mode !== "league" || !leagueQuery.data || !selectedDriver) return null;
    const built: LoadedSessionSummary[] = [];
    const data = new Map<string, TelemetrySession>();
    for (const race of leagueQuery.data.races) {
      const seen = asSeenBy(race.session, selectedDriver);
      if (!seen) continue;
      const { summary, valid } = buildSessionSummary(race.file, seen, 0);
      if (!valid) continue;
      built.push(summary as LoadedSessionSummary);
      data.set(summary.slug, seen);
    }
    const kept = deduplicateSessions(built);
    kept.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    sessionStore.clear();
    for (const s of kept) {
      const d = data.get(s.slug);
      if (d) sessionStore.set(s.slug, d);
    }
    queryClient.removeQueries({
      queryKey: telemetryKeys.sessionDetailsByMode("league"),
    });
    return kept as SessionSummary[];
  }, [mode, leagueQuery.data, selectedDriver, sessionStore, queryClient]);
  const leagueSessions = useMemo(() => {
    if (!allLeagueSessions) return null;
    if (filteredRaces.length === leagueQuery.data?.races.length) return allLeagueSessions;
    const files = new Set(filteredRaces.map((r) => r.file));
    return allLeagueSessions.filter((s) => files.has(s.relativePath));
  }, [allLeagueSessions, filteredRaces, leagueQuery.data]);
  const league: LeagueState | null =
    mode === "league" && leagueQuery.data
      ? {
          races: filteredRaces,
          allRaces: leagueQuery.data.races,
          drivers: leagueDrivers,
          selectedDriver,
          setSelectedDriver,
          filter,
          setFilter,
          filterLabel: describeFilter(filter, streams),
          streams,
          safety,
          safetyData,
        }
      : null;

  const sessionListQuery = useQuery({
    queryKey: telemetryKeys.sessionList,
    queryFn: () => fetchSessionList(`${import.meta.env.BASE_URL}api/sessions`),
    // Only the local API has a live filesystem behind it — demo and uploaded
    // lists are static, so background refresh is api-mode only.
    enabled: mode === "api",
    // The detection probe seeds this cache; a short freshness window stops the
    // query from re-fetching the identical payload the moment it's enabled.
    staleTime: 5_000,
    // Polling is opt-in (PnG runtime config or VITE_SESSION_POLL_INTERVAL_S).
    // TanStack pauses the interval while the tab is hidden; the focus refetch
    // below catches up as soon as the user returns.
    refetchInterval: getSessionPollIntervalMs() || false,
    // A session saved while the tab was backgrounded shows up on return even
    // with polling disabled. On refetch failure TanStack keeps the previous
    // data, so a transient blip never clobbers a working session list.
    refetchOnWindowFocus: true,
  });

  const sessions =
    uploadedSessions ??
    leagueSessions ??
    (mode === "api" ? sessionListQuery.data : detectionQuery.data?.sessions) ??
    EMPTY_SESSIONS;
  const sessionsLoading = uploadedSessions
    ? false
    : detectionQuery.isPending ||
      (mode === "league" && !leagueSessions && !leagueQuery.isError);
  // Detection already proved the API once, and refetch failures keep previous
  // data — so this only surfaces when the list truly has nothing to show.
  const sessionsError =
    mode === "api" && sessionListQuery.isError && !sessionListQuery.data
      ? sessionListQuery.error.message
      : null;

  // Game scopes come from every league race so a quiet filter period never
  // makes the current scope (and its URLs) disappear.
  const scopeSessions = allLeagueSessions ?? sessions;
  const formulaOptions = useMemo(
    () => getFormulaScopeOptions(scopeSessions),
    [scopeSessions],
  );
  const isRouteRoot = isRootPath(location.pathname);
  const routeFormulaKey = getFormulaScopeCandidateFromPath(location.pathname);
  const routeFormulaKeyResolved = resolveFormulaScopeAlias(
    scopeSessions,
    routeFormulaKey,
  );
  // Root defaults to every game. Every other URL must carry an exact
  // first-segment scope, otherwise stale legacy links or typos would quietly
  // display data for the wrong game generation. Known legacy scope aliases,
  // such as `f1-modern`, resolve to their canonical key so the route wrapper
  // can replace the URL with `/f1-25/...`.
  const scopeKey = useMemo(() => {
    if (formulaOptions.length === 0) return undefined;
    if (isRouteRoot || isAllFormulaScope(routeFormulaKey)) {
      return ALL_FORMULA_SCOPE_KEY;
    }
    return routeFormulaKeyResolved;
  }, [
    formulaOptions.length,
    isRouteRoot,
    routeFormulaKey,
    routeFormulaKeyResolved,
  ]);
  const activeFormulaKey = isAllFormulaScope(scopeKey) ? undefined : scopeKey;
  const activeFormula = useMemo(
    () => formulaOptions.find((option) => option.key === activeFormulaKey),
    [activeFormulaKey, formulaOptions],
  );

  const getSessionQueryOptions = useCallback(
    (slug: string) => sessionDetailQueryOptions(mode, slug, sessionStore),
    [mode, sessionStore],
  );

  const getSession = useCallback(
    (slug: string): Promise<TelemetrySession> =>
      queryClient.fetchQuery(getSessionQueryOptions(slug)),
    [queryClient, getSessionQueryOptions],
  );

  const loadFiles = useCallback(
    async (files: File[]) => {
      setFilesLoading(true);
      try {
        const zips = files.filter((f) => f.name.endsWith(".zip"));
        const jsons = files.filter((f) => f.name.endsWith(".json"));

        // Load zip(s) first, then JSON files on top
        const allSessions: LoadedSessionSummary[] = [];
        const allData = new Map<string, TelemetrySession>();

        for (const zip of zips) {
          const result = await loadZipFile(zip);
          allSessions.push(...result.sessions);
          for (const [slug, data] of result.sessionData) {
            allData.set(slug, data);
          }
        }

        if (jsons.length > 0) {
          const result = await loadJsonFiles(jsons);
          allSessions.push(...result.sessions);
          for (const [slug, data] of result.sessionData) {
            allData.set(slug, data);
          }
        }

        const deduplicatedSessions = deduplicateSessions(allSessions);
        deduplicatedSessions.sort(
          (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
        const keptSlugs = new Set(deduplicatedSessions.map((s) => s.slug));

        sessionStore.clear();
        for (const [slug, data] of allData) {
          if (keptSlugs.has(slug)) {
            sessionStore.set(slug, data);
          }
        }
        // Re-uploading replaces the store, so cached upload-mode detail queries
        // (staleTime: Infinity) would otherwise keep serving the old files.
        queryClient.removeQueries({
          queryKey: telemetryKeys.sessionDetailsByMode("upload"),
        });
        setUploadedSessions(deduplicatedSessions);
      } finally {
        setFilesLoading(false);
      }
    },
    [sessionStore, queryClient],
  );

  return (
    <TelemetryContext.Provider
      value={{
        mode,
        sessions,
        sessionsLoading,
        sessionsError,
        formulaOptions,
        scopeKey,
        activeFormulaKey,
        activeFormula,
        getSession,
        getSessionQueryOptions,
        loadFiles,
        showUploadModal,
        setShowUploadModal,
        filesLoading,
        league,
      }}
    >
      {children}
    </TelemetryContext.Provider>
  );
}
