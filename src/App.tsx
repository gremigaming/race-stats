import { lazy, Suspense, type ReactNode } from "react";
import {
  Link,
  Navigate,
  Routes,
  Route,
  useLocation,
  useParams,
} from "react-router-dom";
import { Analytics } from "@vercel/analytics/react";
import { Layout } from "./components/Layout";
import { DriverWelcomeModal } from "./components/DriverWelcomeModal";
import { LoadingSpinner } from "./components/ui/LoadingSpinner";
import { SetupCardsPage } from "./pages/SetupCardsPage";
import { SETUP_MANAGER_ON } from "./league/setupManager";
import { TelemetryProvider, useTelemetry } from "./context/TelemetryContext";
import { ZipUploadScreen } from "./components/ZipUploadScreen";
import { GlobalDropZone } from "./components/GlobalDropZone";
import { PNG_VERSION_TITLE_PREFIX } from "./config/branding";
import { ALL_FORMULA_SCOPE_KEY } from "./utils/formulaScope";
import { dashboardPath, replaceFormulaScopeInPath } from "./utils/routes";

const DashboardPage = lazy(() =>
  import("./pages/DashboardPage").then((module) => ({
    default: module.DashboardPage,
  })),
);
const DriversPage = lazy(() =>
  import("./pages/DriversPage").then((module) => ({
    default: module.DriversPage,
  })),
);
const DriverInsightsPage = lazy(() =>
  import("./pages/DriverInsightsPage").then((module) => ({
    default: module.DriverInsightsPage,
  })),
);
const IncidentsPage = lazy(() =>
  import("./pages/IncidentsPage").then((module) => ({
    default: module.IncidentsPage,
  })),
);
const SafetyPage = lazy(() =>
  import("./pages/SafetyPage").then((module) => ({
    default: module.SafetyPage,
  })),
);
const RaceListPage = lazy(() =>
  import("./pages/RaceListPage").then((module) => ({
    default: module.RaceListPage,
  })),
);
const HeadToHeadPage = lazy(() =>
  import("./pages/HeadToHeadPage").then((module) => ({
    default: module.HeadToHeadPage,
  })),
);
const SetupManagerPage = lazy(() =>
  import("./pages/SetupManagerPage").then((module) => ({
    default: module.SetupManagerPage,
  })),
);
const SessionsPage = lazy(() =>
  import("./pages/SessionsPage").then((module) => ({
    default: module.SessionsPage,
  })),
);
const SessionPage = lazy(() =>
  import("./pages/SessionPage").then((module) => ({
    default: module.SessionPage,
  })),
);
const TracksPage = lazy(() =>
  import("./pages/TracksPage").then((module) => ({
    default: module.TracksPage,
  })),
);
const TrackProgressPage = lazy(() =>
  import("./pages/TrackProgressPage").then((module) => ({
    default: module.TrackProgressPage,
  })),
);
const RaceViewerPage = lazy(() =>
  import("./pages/RaceViewerPage").then((module) => ({
    default: module.RaceViewerPage,
  })),
);

const UiDebugPage = import.meta.env.DEV
  ? lazy(() =>
      import("./pages/UiDebugPage").then((module) => ({
        default: module.UiDebugPage,
      })),
    )
  : null;

function AppRoutes() {
  const { mode, sessions, sessionsLoading, showUploadModal } = useTelemetry();
  const location = useLocation();
  const isUiDebugRoute =
    import.meta.env.DEV && location.pathname === "/ui-debug";

  if (!isUiDebugRoute && (mode === "detecting" || sessionsLoading)) {
    return (
      <div className="flex h-screen items-center justify-center bg-black">
        <LoadingSpinner className="h-10 w-10 border-4" label="Loading site" />
      </div>
    );
  }

  const needsData =
    !isUiDebugRoute && mode === "upload" && sessions.length === 0;

  return (
    <>
      <Routes>
        {/* The Live Race Viewer is one full screen, outside the site layout */}
        <Route
          path=":formulaKey/race/:id"
          element={
            <Suspense fallback={<RaceViewerLoading />}>
              <RaceViewerPage />
            </Suspense>
          }
        />
        <Route element={<Layout />}>
          {UiDebugPage && (
            <Route
              path="ui-debug"
              element={
                <Suspense fallback={<UiDebugLoading />}>
                  <UiDebugPage />
                </Suspense>
              }
            />
          )}
          <Route index element={<DefaultScopeRedirect />} />
          {/* The F1-SETUPS pictures for Discord (scripts/discord-card.mjs) */}
          <Route path="setup-cards" element={<SetupCardsPage />} />
          <Route
            path=":formulaKey"
            element={
              <ScopedFormulaRoute>
                <DashboardPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/drivers"
            element={
              <ScopedFormulaRoute>
                <DriversPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/insights"
            element={
              <ScopedFormulaRoute>
                <DriverInsightsPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/incidents"
            element={
              <ScopedFormulaRoute>
                <IncidentsPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/safety"
            element={
              <ScopedFormulaRoute>
                <SafetyPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/race"
            element={
              <ScopedFormulaRoute>
                <RaceListPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/head-to-head"
            element={
              <ScopedFormulaRoute>
                <HeadToHeadPage />
              </ScopedFormulaRoute>
            }
          />
          {SETUP_MANAGER_ON && (
            <Route
              path=":formulaKey/setups"
              element={
                <ScopedFormulaRoute>
                  <SetupManagerPage />
                </ScopedFormulaRoute>
              }
            />
          )}
          <Route
            path=":formulaKey/sessions"
            element={
              <ScopedFormulaRoute>
                <SessionsPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/sessions/*"
            element={
              <ScopedFormulaRoute>
                <SessionPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/tracks"
            element={
              <ScopedFormulaRoute>
                <TracksPage />
              </ScopedFormulaRoute>
            }
          />
          <Route
            path=":formulaKey/tracks/:trackId"
            element={
              <ScopedFormulaRoute>
                <TrackProgressPage />
              </ScopedFormulaRoute>
            }
          />
          <Route path="*" element={<RouteNotFound />} />
        </Route>
      </Routes>
      <DriverWelcomeModal />
      {(needsData || showUploadModal) && (
        <ZipUploadScreen dismissable={!needsData} />
      )}
      <GlobalDropZone />
    </>
  );
}

function UiDebugLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6 text-center">
      <div>
        <LoadingSpinner className="mx-auto h-8 w-8 border-4" />
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.18em] text-zinc-500">
          loading ui debug
        </p>
      </div>
    </div>
  );
}

function RouteLoadingFallback() {
  return (
    <div
      className="flex min-h-[48vh] items-center justify-center px-6"
    >
      <LoadingSpinner className="size-8 border-2" label="Loading view" />
    </div>
  );
}

function RaceViewerLoading() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-[#0d0b10] text-zinc-100">
      <div className="brand-stripe-wash pointer-events-none absolute inset-x-0 top-0 h-px" />
      <div className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-zinc-900/80 px-5 py-4 shadow-2xl shadow-black/30">
        <LoadingSpinner className="size-5 border-2" />
        <span className="text-sm text-zinc-300">Loading race viewer</span>
      </div>
    </div>
  );
}

function DefaultScopeRedirect() {
  const { scopeKey } = useTelemetry();
  if (!scopeKey) return null;
  return <Navigate to={dashboardPath(scopeKey)} replace />;
}

function ScopedFormulaRoute({ children }: { children: ReactNode }) {
  const { formulaKey } = useParams<{ formulaKey: string }>();
  const location = useLocation();
  const { scopeKey, formulaOptions } = useTelemetry();
  const matchedFormula = formulaOptions.find(
    (option) => option.key === formulaKey,
  );

  if (formulaKey && scopeKey && formulaKey !== scopeKey) {
    return (
      <Navigate
        to={`${replaceFormulaScopeInPath(location.pathname, scopeKey)}${location.search}`}
        replace
      />
    );
  }

  if (!formulaKey || formulaKey !== scopeKey) {
    return (
      <EmptyRouteState
        title={
          formulaKey
            ? matchedFormula
              ? `No data for ${matchedFormula.label}`
              : "Game scope not found"
            : "Formula scope missing"
        }
        description={
          formulaOptions.length > 0
            ? "Choose one of the available game scopes. Scoped URLs are intentionally strict so the data you see always matches the URL."
            : "Load telemetry files to open a scoped dashboard."
        }
      />
    );
  }

  return <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>;
}

function RouteNotFound() {
  return (
    <EmptyRouteState
      title="Page not found"
      description="This app uses scoped URLs like /all, /f1-26/tracks/sakhir, and /f1-26/sessions/session-slug."
    />
  );
}

function EmptyRouteState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { formulaOptions } = useTelemetry();
  return (
    <div className="flex h-full items-center justify-center px-6 text-center">
      <div className="max-w-sm">
        <h2 className="text-base font-semibold text-zinc-200">{title}</h2>
        <p className="mt-2 text-sm text-zinc-500">{description}</p>
        {formulaOptions.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link
              to={dashboardPath(ALL_FORMULA_SCOPE_KEY)}
              className="inline-flex rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              All games
            </Link>
            {formulaOptions.map((option) => (
              <Link
                key={option.key}
                to={dashboardPath(option.key)}
                className="inline-flex rounded-lg bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
              >
                {option.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const analyticsEnabled = import.meta.env.VITE_DISABLE_ANALYTICS !== "true";
const appVersion = (window as Window & { __PNG_VERSION__?: string })
  .__PNG_VERSION__;
if (appVersion) {
  document.title = `${PNG_VERSION_TITLE_PREFIX} v${appVersion}`;
}

export function App() {
  return (
    <TelemetryProvider>
      <AppRoutes />
      {analyticsEnabled && <Analytics />}
    </TelemetryProvider>
  );
}
