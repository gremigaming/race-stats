import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { TelemetrySession } from "../types/telemetry";
import { useTelemetry } from "../context/TelemetryContext";
import { formatSessionType } from "../utils/format";
import {
  getFormulaComparisonKey,
  getFormulaLabel,
  shouldShowFormulaLabel,
} from "../utils/sessionTypes";
import {
  linkScopeKey,
  trackPath,
  trackTabForSessionType,
} from "../utils/routes";
import { getTrackDisplayName } from "../utils/tracks";
import { TrackFlag } from "./TrackFlag";
import { TrackLayout } from "./TrackLayout";
import { SessionDriverSelect } from "./SessionDriverSelect";
import { getSessionTypeMeta } from "./sessionTypeMeta";
import { HStack } from "./ui/Stack";

const EXT_LINK_TEMPLATE = import.meta.env.VITE_EXTERNAL_LINK_TEMPLATE as
  | string
  | undefined;
const EXT_LINK_LABEL = import.meta.env.VITE_EXTERNAL_LINK_LABEL as
  | string
  | undefined;

interface SessionHeaderProps {
  session: TelemetrySession;
  focusedDriverIndex: number;
  onFocusedDriverChange: (index: number) => void;
  controls?: ReactNode;
  slug?: string;
  showDriverSelector?: boolean;
  showTrackLayout?: boolean;
}

export function SessionHeader({
  session,
  focusedDriverIndex,
  onFocusedDriverChange,
  controls,
  slug,
  showDriverSelector = true,
  showTrackLayout = true,
}: SessionHeaderProps) {
  const info = session["session-info"];
  const { scopeKey } = useTelemetry();

  const sessionType = formatSessionType(info["session-type"], info.formula);
  const TypeIcon = getSessionTypeMeta(sessionType).icon;
  const formulaKey = getFormulaComparisonKey(
    info.formula,
    session["game-year"],
  );
  const showFormula = shouldShowFormulaLabel(
    info.formula,
    session["game-year"],
  );
  const trackTab = trackTabForSessionType(info["session-type"]);
  const trackName = getTrackDisplayName(info["track-id"]);
  const hasControls =
    showDriverSelector ||
    Boolean(slug && EXT_LINK_TEMPLATE && EXT_LINK_LABEL) ||
    Boolean(controls);

  return (
    <section
      aria-labelledby="session-header-title"
      className="brand-stripe-wash relative isolate overflow-hidden rounded-2xl border border-white/[0.08] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] sm:p-5"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/20 via-transparent to-black/10"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-brand-red/50 via-white/10 to-brand-violet/50"
      />
      <HStack align="start" className="relative gap-4">
        <div className="min-w-0 flex-1">
          <p className="mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-rose-200/70">
            Session
          </p>
          <HStack wrap className="gap-x-3 gap-y-2">
            <h1
              id="session-header-title"
              className="min-w-0 text-2xl font-bold tracking-tight text-white sm:text-3xl"
            >
              <Link
                to={trackPath(
                  linkScopeKey(scopeKey, formulaKey),
                  info["track-id"],
                  trackTab,
                )}
                className="inline-flex min-w-0 items-center transition-colors hover:text-best"
              >
                <TrackFlag
                  track={info["track-id"]}
                  className="mr-2 size-5 shrink-0"
                />
                <span className="truncate">{trackName}</span>
              </Link>
            </h1>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-red/20 bg-brand-red/10 px-2.5 py-1 text-xs font-semibold text-rose-200">
              <TypeIcon className="size-3.5" />
              {sessionType}
            </span>
            {showFormula && (
              <span className="rounded-full border border-white/[0.08] bg-black/20 px-2.5 py-1 font-mono text-[11px] font-semibold text-zinc-300">
                {getFormulaLabel(info.formula, session["game-year"])}
              </span>
            )}
          </HStack>

          {hasControls && (
            <HStack wrap className="mt-4 gap-2">
              {showDriverSelector && (
                <SessionDriverSelect
                  session={session}
                  focusedDriverIndex={focusedDriverIndex}
                  onFocusedDriverChange={onFocusedDriverChange}
                />
              )}

              {slug && EXT_LINK_TEMPLATE && EXT_LINK_LABEL && (
                <a
                  href={EXT_LINK_TEMPLATE.replace("{slug}", slug)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <ExternalLink className="size-3" />
                  {EXT_LINK_LABEL}
                </a>
              )}

              {controls && <div className="contents">{controls}</div>}
            </HStack>
          )}
        </div>
        {showTrackLayout && (
          <TrackLayout
            track={info["track-id"]}
            className="hidden size-20 shrink-0 text-zinc-600 sm:block [&>svg]:size-full"
          />
        )}
      </HStack>
    </section>
  );
}
