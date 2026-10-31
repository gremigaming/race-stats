/**
 * Live bits of the race viewer: the Live tab on the race picker (shows up by itself while a
 * session streams), the "LIVE now" button inside a replay, and the LIVE / GO LIVE badge.
 */
import { Radio } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "../utils/cn";
import { getTrackDisplayName } from "../utils/tracks";
import { useLiveSessions, type LiveSession } from "./live";

/** A pulsing red dot. */
export function LiveDot({ className }: { className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-2 rounded-full bg-red-500" />
    </span>
  );
}

/** In a live race: red LIVE at the live edge, else a GO LIVE button back to it. */
export function GoLive({ edge, onClick, className }: { edge: boolean; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={edge ? "Watching live" : "Back to live"}
      className={cn(
        "pointer-events-auto inline-flex items-center gap-1 rounded px-1 font-semibold",
        edge ? "text-red-400" : "bg-red-500/15 text-red-300 hover:bg-red-500/25",
        className,
      )}
    >
      <LiveDot className={edge ? "" : "opacity-50"} />
      {edge ? "LIVE" : "GO LIVE"}
    </button>
  );
}

/** Inside a replay while another session streams: one tap to the live race. */
export function LiveNow({ current, base }: { current: string; base: string }) {
  const live = useLiveSessions().filter((s) => s.uid !== current);
  if (!live.length) return null;
  const s = live[0];
  return (
    <Link
      to={`${base}/${s.uid}`}
      className="pointer-events-auto flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-red-500/40 bg-[#0c0e11]/85 px-2.5 text-xs font-semibold text-red-300 backdrop-blur hover:bg-red-500/15"
    >
      <LiveDot />
      <span>LIVE</span>
      <span className="hidden font-normal text-zinc-300 sm:inline">{getTrackDisplayName(s.track)}</span>
    </Link>
  );
}

const sessionLabel = (s: LiveSession) => `${getTrackDisplayName(s.track)} · ${s.session}`;

/**
 * The tabs at the top of the race picker: "Races" and, while a session streams, "Live".
 * Opens on Live by itself when something is streaming (unless the visitor picked Races).
 */
export function PickerTabs({
  tab,
  onTab,
  formulaKey,
}: {
  tab: "races" | "live";
  onTab: (t: "races" | "live") => void;
  formulaKey: string | undefined;
}) {
  const live = useLiveSessions();
  if (!live.length) return null; // the tab only shows while something streams
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Race viewer" className="flex gap-1 rounded-full bg-white/5 p-1 ring-1 ring-white/10 w-fit">
        <TabButton active={tab === "races"} onClick={() => onTab("races")}>
          Races
        </TabButton>
        <TabButton active={tab === "live"} onClick={() => onTab("live")}>
          <LiveDot />
          Live
        </TabButton>
      </div>
      {tab === "live" && (
        <div className="grid gap-3 sm:grid-cols-2">
          {live.map((s) => (
            <Link
              key={s.uid}
              to={`/${formulaKey ?? ""}/race/${s.uid}`}
              className="group flex items-center gap-4 rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/15 to-transparent p-4 hover:border-red-500/60"
            >
              <Radio className="size-8 shrink-0 text-red-400" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-300">
                  <LiveDot /> Live now
                </div>
                <div className="truncate text-base font-semibold text-zinc-50">{sessionLabel(s)}</div>
                <div className="text-xs text-zinc-400">
                  {s.cars} cars{s.laps ? ` · ${s.laps} laps` : ""}
                </div>
              </div>
              <span className="rounded-full bg-red-500 px-3 py-1.5 text-sm font-semibold text-white group-hover:bg-red-400">Watch</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
        active ? "bg-red-500/20 text-red-200" : "text-zinc-400 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

/** For the site menu: true while a session streams. */
export function useIsLive() {
  return useLiveSessions().length > 0;
}
