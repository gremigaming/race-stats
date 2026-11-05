import { type ComponentType } from "react";
import { ArrowRight, FileText, Sparkles, Wrench } from "lucide-react";
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
  drivers: "/drivers",
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
                      className="group -mx-2 flex items-start gap-2.5 rounded-md px-2 py-1 transition-colors hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/70"
                    >
                      {config && (
                        <span
                          aria-hidden="true"
                          className={cn(
                            "shrink-0 mt-0.5 flex h-5 w-5 items-center justify-center rounded",
                            config.bg,
                          )}
                        >
                          <config.icon className={cn("h-3 w-3", config.fg)} />
                        </span>
                      )}
                      <span className="flex-1 text-sm leading-snug text-zinc-300 group-hover:text-zinc-100">
                        {entry.message}
                      </span>
                      <ArrowRight
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500 opacity-50 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
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
