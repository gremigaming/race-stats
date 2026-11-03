import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";

function monthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1, 12);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKeyForDay(year: number, monthIndex: number, day: number) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatDate(dateKey: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T12:00:00Z`));
}

export function SessionDatePicker({
  availableDates,
  selectedDate,
  onSelect,
}: {
  availableDates: readonly string[];
  selectedDate: string | null;
  onSelect: (date: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [manualMonth, setManualMonth] = useState<string | null>(null);
  const sortedDates = [...availableDates].sort();
  const latestDate = sortedDates.at(-1);
  const currentMonth =
    manualMonth ??
    (selectedDate ? monthKey(selectedDate) : undefined) ??
    (latestDate ? monthKey(latestDate) : undefined) ??
    monthKey(dateKeyForDay(new Date().getFullYear(), new Date().getMonth(), 1));
  const [year, month] = currentMonth.split("-").map(Number);
  const monthDate = new Date(year, month - 1, 1, 12);
  const monthLabel = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(monthDate);
  const firstWeekday = (monthDate.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const dateSet = new Set(availableDates);
  const latestMonth = latestDate ? monthKey(latestDate) : currentMonth;
  const canGoForward = currentMonth < latestMonth;

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={selectedDate ? `Filter by ${formatDate(selectedDate)}` : "Choose a session date"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-8 items-center gap-2 rounded-md border border-white/10 bg-zinc-950/70 px-2.5 text-xs text-zinc-300 transition-colors hover:bg-white/[0.06]"
      >
        <CalendarDays className="size-3.5 text-zinc-500" />
        {selectedDate ? formatDate(selectedDate) : "Choose date"}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date with saved sessions"
          className="absolute left-0 top-full z-30 mt-2 w-72 rounded-xl border border-white/10 bg-zinc-950 p-3 shadow-2xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setManualMonth(shiftMonth(currentMonth, -1))}
              className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.07] hover:text-white"
            >
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-sm font-medium text-zinc-200">{monthLabel}</span>
            <button
              type="button"
              aria-label="Next month"
              disabled={!canGoForward}
              onClick={() => setManualMonth(shiftMonth(currentMonth, 1))}
              className="flex size-8 items-center justify-center rounded-md text-zinc-400 hover:bg-white/[0.07] hover:text-white disabled:cursor-default disabled:opacity-30"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mb-1 grid grid-cols-7 text-center">
            {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
              <span
                key={`${day}-${index}`}
                className="py-1 text-[10px] font-medium uppercase text-zinc-600"
              >
                {day}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-y-1 text-center">
            {Array.from({ length: cellCount }, (_, cell) => {
              const day = cell - firstWeekday + 1;
              if (day < 1 || day > daysInMonth) {
                return <span key={`empty-${cell}`} className="size-9" />;
              }

              const dateKey = dateKeyForDay(year, month - 1, day);
              const hasSessions = dateSet.has(dateKey);
              const isSelected = selectedDate === dateKey;
              return (
                <button
                  key={dateKey}
                  type="button"
                  disabled={!hasSessions}
                  aria-label={`${formatDate(dateKey)}${hasSessions ? ", sessions available" : ", no sessions"}`}
                  aria-pressed={isSelected}
                  title={hasSessions ? `${formatDate(dateKey)} · sessions saved` : undefined}
                  onClick={() => {
                    onSelect(dateKey);
                    setManualMonth(monthKey(dateKey));
                    setOpen(false);
                  }}
                  className={`relative mx-auto flex size-8 items-center justify-center rounded-full text-xs tabular-nums transition-colors ${
                    isSelected
                      ? "bg-sky-400/20 text-sky-200 ring-1 ring-sky-300"
                      : hasSessions
                        ? "text-zinc-200 ring-1 ring-white/25 hover:bg-white/10 hover:ring-sky-300/70"
                        : "cursor-default text-zinc-700"
                  }`}
                >
                  {day}
                  {hasSessions && (
                    <span
                      aria-hidden="true"
                      className={`absolute bottom-0.5 size-1 rounded-full ${
                        isSelected ? "bg-sky-200" : "bg-sky-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-2">
            <span className="flex items-center gap-1.5 text-[10px] text-zinc-500">
              <span className="size-1.5 rounded-full bg-sky-400" />
              Sessions saved
            </span>
            {selectedDate && (
              <button
                type="button"
                onClick={() => {
                  onSelect(null);
                  setOpen(false);
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Clear date
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
