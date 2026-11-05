import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Gamepad2, SlidersHorizontal, type LucideIcon } from "lucide-react";
import {
  DEFAULT_FILTERS,
  type SessionListFilters,
  type SessionModeFilter,
  type SessionTypeFilter,
} from "../hooks/useSessionFilters";
import type { GameScope } from "../hooks/useGameScope";
import { cn } from "../utils/cn";
import { SESSION_MODE_META } from "./sessionModeMeta";
import { SESSION_TYPE_FILTER_META } from "./sessionTypeMeta";
import { DROPDOWN_PANEL_STYLES } from "./ui/formControl";
import { SegmentedControl } from "./ui/SegmentedControl";
import { HStack } from "./ui/Stack";

interface Props {
  value: SessionListFilters;
  onChange: (next: SessionListFilters) => void;
  game: GameScope;
  onReset: () => void;
  showGame?: boolean;
}

function countActive(
  value: SessionListFilters,
  game: GameScope,
  showGame: boolean,
): number {
  let n = showGame && game.isFiltered ? 1 : 0;
  if (value.type !== DEFAULT_FILTERS.type) n += 1;
  if (value.mode !== DEFAULT_FILTERS.mode) n += 1;
  return n;
}

function getButtonIcon(
  value: SessionListFilters,
  game: GameScope,
  showGame: boolean,
): {
  icon: LucideIcon;
  label: string;
} {
  if (value.type !== "all") {
    const meta = SESSION_TYPE_FILTER_META[value.type];
    return { icon: meta.icon, label: meta.buttonLabel };
  }
  if (value.mode !== "all") {
    const meta = SESSION_MODE_META[value.mode];
    return { icon: meta.icon, label: meta.buttonLabel };
  }
  if (showGame && game.isFiltered) {
    return { icon: Gamepad2, label: `${game.label ?? "Game"} only` };
  }
  return { icon: SlidersHorizontal, label: "Filters" };
}

const SessionTypeIcon = SESSION_TYPE_FILTER_META.race.icon;
const ModeIcon = SESSION_MODE_META.ai.icon;

export function SessionListFilterMenu({
  value,
  onChange,
  game,
  onReset,
  showGame = true,
}: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const activeCount = countActive(value, game, showGame);
  const buttonIcon = getButtonIcon(value, game, showGame);
  const ButtonIcon = buttonIcon.icon;
  const activeLabels = [
    showGame && game.isFiltered ? (game.label ?? null) : null,
    value.type === "all" ? null : SESSION_TYPE_FILTER_META[value.type].label,
    value.mode === "all" ? null : SESSION_MODE_META[value.mode].label,
  ].filter((label): label is string => label !== null);

  // Close on outside click and Escape
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Close when route changes (matches mobile sidebar behavior)
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const isDefault = activeCount === 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          activeCount > 0
            ? `${activeLabels.join(" and ")} filters active`
            : buttonIcon.label
        }
        aria-expanded={open}
        className={cn(
          "relative inline-flex min-h-8 items-center gap-2 rounded-lg border px-2.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/50",
          !isDefault
            ? "border-brand-red/25 bg-brand-wine/40 text-rose-100 hover:bg-brand-wine/55"
            : open
              ? "border-white/10 bg-zinc-900 text-zinc-200"
              : "border-white/[0.07] text-zinc-400 hover:bg-white/[0.045] hover:text-zinc-200",
        )}
      >
        <ButtonIcon className="size-3.5 shrink-0" />
        <span>Filters</span>
        {activeCount > 0 && (
          <span
            aria-hidden="true"
            className="inline-flex min-w-4 items-center justify-center rounded-full bg-white/10 px-1 text-[10px] tabular-nums text-rose-100"
          >
            {activeCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Session filters"
          className={cn(
            "absolute right-0 top-full z-20 mt-1.5 max-w-[calc(100vw-2rem)] divide-y divide-white/[0.07]",
            DROPDOWN_PANEL_STYLES,
            game.enabled && showGame ? "w-64" : "w-56",
          )}
        >
          {game.enabled && showGame && (
            <Section label="Game" icon={Gamepad2}>
              <SegmentedControl<string>
                size="sm"
                className="[&>button]:flex-auto"
                options={game.options}
                value={game.value}
                onChange={game.setGame}
              />
            </Section>
          )}

          <Section label="Session type" icon={SessionTypeIcon}>
            <SegmentedControl<SessionTypeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                {
                  value: "race",
                  label: SESSION_TYPE_FILTER_META.race.label,
                },
                {
                  value: "quali",
                  label: SESSION_TYPE_FILTER_META.quali.label,
                },
                {
                  value: "tt",
                  label: SESSION_TYPE_FILTER_META.tt.label,
                },
              ]}
              value={value.type}
              onChange={(type) => onChange({ ...value, type })}
            />
          </Section>

          <Section label="Mode" icon={ModeIcon}>
            <SegmentedControl<SessionModeFilter>
              size="sm"
              fullWidth
              options={[
                { value: "all", label: "All" },
                { value: "ai", label: SESSION_MODE_META.ai.label },
                { value: "online", label: SESSION_MODE_META.online.label },
              ]}
              value={value.mode}
              onChange={(mode) => onChange({ ...value, mode })}
            />
          </Section>

          {!isDefault && (
            <HStack justify="between" className="px-3 py-2">
              <span className="text-xs text-zinc-500">
                {activeCount} {activeCount === 1 ? "filter" : "filters"} active
              </span>
              <button
                type="button"
                onClick={onReset}
                className="rounded text-xs font-medium text-sky-400 transition-colors hover:text-sky-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-zinc-600"
              >
                Reset
              </button>
            </HStack>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <HStack className="mb-1.5 gap-1.5 font-mono text-2xs font-semibold uppercase tracking-wider text-zinc-500">
        <Icon className="h-3 w-3" />
        {label}
      </HStack>
      {children}
    </div>
  );
}
