import { type ComponentType } from "react";
import { ArrowRight, FileText, Sparkles, Trophy, Wrench } from "lucide-react";
import { Link } from "react-router-dom";
import changelog from "../data/changelog";
import { useTelemetry } from "../context/TelemetryContext";
import { ALL_FORMULA_SCOPE_KEY } from "../utils/formulaScope";
import { dashboardPath } from "../utils/routes";
import { Modal } from "./ui/Modal";
import { ScrollArea } from "./ui/ScrollArea";
import { cn } from "../utils/cn";

const TYPE_CONFIG: Record<
  string,
  { icon: ComponentType<{ className?: string }>; bg: string; fg: string }
> = {
  feat: { icon: Sparkles, bg: "bg-emerald-500/15", fg: "text-emerald-400" },
  fix: { icon: Wrench, bg: "bg-amber-500/15", fg: "text-amber-400" },
  docs: { icon: FileText, bg: "bg-blue-500/15", fg: "text-blue-400" },
};

const DESTINATION_PATHS: Record<
  (typeof changelog)[number]["destination"],
  string
> = {
  home: "",
  tracks: "/tracks",
  sessions: "/sessions",
  drivers: "/drivers",
  "driver-dna": "/drivers/dna",
  safety: "/safety",
  "personal-safety": "/safety?tab=personal",
  race: "/race",
  incidents: "/incidents",
};

function groupByDate(
  entries: typeof changelog,
): Record<string, typeof changelog> {
  const groups: Record<string, typeof changelog> = {};
  for (const entry of entries) {
    (groups[entry.date] ??= []).push(entry);
  }
  return groups;
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function ChangelogModal({ onClose }: { onClose: () => void }) {
  const { scopeKey } = useTelemetry();
  const grouped = groupByDate(changelog);
  const dates = Object.keys(grouped);
  const scopePath = dashboardPath(scopeKey ?? ALL_FORMULA_SCOPE_KEY);

  return (
    <Modal
      onClose={onClose}
      className="max-w-[680px] max-h-[70vh]"
      ariaLabelledBy="changelog-modal-title"
    >
      {/* Header */}
      <div className="flex items-center px-6 pt-5 pb-4 border-b border-white/[0.05] pr-14">
        <h2 id="changelog-modal-title" className="text-base font-semibold text-zinc-100">
          What's new
        </h2>
      </div>

      {/* Content */}
      <ScrollArea axis="y" className="px-6 py-4 space-y-5">
        {dates.length === 0 && (
          <p className="text-sm text-zinc-500">No changelog available.</p>
        )}
        {dates.map((date) => (
          <div key={date}>
            <h3 className="text-xs font-medium text-zinc-500 mb-2">
              {formatDate(date)}
            </h3>
            <ul className="space-y-1.5">
              {grouped[date].map((entry) => {
                const config = TYPE_CONFIG[entry.type];
                return (
                  <li key={entry.id}>
                    <Link
                      to={`${scopePath}${DESTINATION_PATHS[entry.destination]}`}
                      onClick={onClose}
                      className={cn(
                        "group -mx-2 flex focus-visible:outline-none focus-visible:ring-2",
                        entry.milestone
                          ? "relative isolate items-center gap-4 overflow-hidden rounded-xl border border-rose-300/30 bg-gradient-to-br from-red-500/[0.16] via-rose-500/[0.09] to-amber-400/[0.10] px-4 py-4 shadow-lg shadow-red-950/20 ring-1 ring-white/[0.04] transition-all duration-200 hover:-translate-y-0.5 hover:border-rose-200/55 hover:shadow-xl hover:shadow-red-950/35 focus-visible:ring-amber-300/70"
                          : "items-start gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.04] focus-visible:ring-red-500/70",
                      )}
                    >
                      {entry.milestone ? (
                        <>
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-gradient-to-b from-amber-200 via-rose-300 to-red-500"
                          />
                          <span
                            aria-hidden="true"
                            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-200/20 bg-gradient-to-br from-red-400/30 via-rose-400/25 to-amber-300/20 text-rose-100 shadow-lg shadow-red-950/25"
                          >
                            <Sparkles className="h-5 w-5" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-amber-200/20 bg-amber-100/[0.08] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-amber-100">
                              <Trophy aria-hidden="true" className="h-3 w-3" />
                              Major milestone
                            </span>
                            <span className="block text-[15px] font-semibold leading-snug tracking-tight text-white">
                              {entry.title ?? entry.message}
                            </span>
                            {entry.title && (
                              <span className="mt-1 block text-xs leading-relaxed text-zinc-300">
                                {entry.message}
                              </span>
                            )}
                          </span>
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.05] text-rose-100 transition-all group-hover:translate-x-0.5 group-hover:border-white/20 group-hover:bg-white/[0.1]">
                            <ArrowRight
                              aria-hidden="true"
                              className="h-4 w-4"
                            />
                          </span>
                        </>
                      ) : (
                        <>
                          {config && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded",
                                config.bg,
                              )}
                            >
                              <config.icon
                                className={cn("h-3 w-3", config.fg)}
                              />
                            </span>
                          )}
                          <span className="flex-1 text-sm leading-snug text-zinc-300 group-hover:text-zinc-100">
                            {entry.message}
                          </span>
                          <ArrowRight
                            aria-hidden="true"
                            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500 opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                          />
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </ScrollArea>
    </Modal>
  );
}
