import { Check, ChevronDown, Search, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueDriver } from "../league/league";
import { cn } from "../utils/cn";
import {
  DROPDOWN_OPTION_STYLES,
  DROPDOWN_OPTION_IDLE_STYLES,
  DROPDOWN_OPTION_SELECTED_STYLES,
  DROPDOWN_PANEL_STYLES,
  FORM_CONTROL_CHROME_STYLES,
} from "./ui/formControl";

/**
 * Driver picker you can type in. The list keeps the order it is given
 * (newest members first) and narrows as you type.
 */
export function DriverSearchSelect({
  drivers,
  value,
  onChange,
  ariaLabel = "Driver",
  className,
}: {
  drivers: LeagueDriver[];
  value: string;
  onChange: (key: string) => void;
  ariaLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = drivers.find((d) => d.key === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? drivers.filter((d) => d.name.toLowerCase().includes(q))
      : drivers;
  }, [drivers, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    input.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (query.trim()) {
      setActive(0);
      return;
    }
    const selectedIndex = drivers.findIndex((driver) => driver.key === value);
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [drivers, open, query, value]);

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          FORM_CONTROL_CHROME_STYLES,
          "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-zinc-800/70",
        )}
      >
        <User className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate">
          {current?.name ?? "Pick a driver"}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute left-0 right-0 top-full z-50 mt-1.5 min-w-56 overflow-hidden p-1.5",
            DROPDOWN_PANEL_STYLES,
          )}
        >
          <div className="flex items-center gap-2 rounded-lg border-b border-white/[0.07] px-2.5 py-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
            <input
              ref={input}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActive((i) => Math.min(i + 1, matches.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActive((i) => Math.max(i - 1, 0));
                } else if (e.key === "Enter" && matches[active]) {
                  pick(matches[active].key);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
              placeholder="Type your name..."
              className="min-w-0 flex-1 bg-transparent text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>
          <ul
            role="listbox"
            aria-label={ariaLabel}
            className="max-h-72 overflow-y-auto pt-1"
          >
            {matches.length === 0 && (
              <li className="px-2.5 py-2 text-xs text-zinc-500">
                No driver with that name
              </li>
            )}
            {matches.map((d, i) => (
              <li
                key={d.key}
                role="option"
                aria-selected={d.key === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(d.key);
                }}
                className={cn(
                  DROPDOWN_OPTION_STYLES,
                  i === active
                    ? DROPDOWN_OPTION_SELECTED_STYLES
                    : DROPDOWN_OPTION_IDLE_STYLES,
                )}
              >
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.key === value && (
                  <Check className="h-3.5 w-3.5 shrink-0 text-rose-200" />
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
