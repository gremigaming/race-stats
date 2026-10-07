import { Check, ChevronDown, Search, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { LeagueDriver } from "../league/league";
import { cn } from "../utils/cn";

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
    return q ? drivers.filter((d) => d.name.toLowerCase().includes(q)) : drivers;
  }, [drivers, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    input.current?.focus();
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => setActive(0), [query]);

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
        className="flex w-full items-center gap-2 rounded-lg bg-zinc-900/70 px-2.5 py-1.5 text-left text-sm text-zinc-100 ring-1 ring-inset ring-white/[0.08] transition-colors hover:bg-zinc-800/70"
      >
        <User className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1 truncate">{current?.name ?? "Pick a driver"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 min-w-56 overflow-hidden rounded-lg bg-zinc-900 shadow-xl shadow-black/50 ring-1 ring-white/[0.1]">
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-2.5 py-2">
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
          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 && (
              <li className="px-3 py-2 text-sm text-zinc-500">No driver with that name</li>
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
                  "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm",
                  i === active ? "bg-white/[0.06] text-zinc-100" : "text-zinc-300",
                )}
              >
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {d.key === value && <Check className="h-3.5 w-3.5 shrink-0 text-red-300" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
