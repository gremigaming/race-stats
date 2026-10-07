import { raceDate, type LeagueRace } from "./league";

/**
 * The site-wide time filter. Every page (dashboard, sessions, tracks,
 * leaderboard, head to head) only sees the races it lets through.
 */
export type LeagueFilter =
  | { kind: "today" | "week" | "month" | "year" | "all" }
  | { kind: "streams"; count: number }
  | { kind: "stream"; id: string }
  | { kind: "custom"; from: string; to: string };

export const DEFAULT_FILTER: LeagueFilter = { kind: "month" };

export const FILTER_KINDS: { value: LeagueFilter["kind"]; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "streams", label: "Last streams" },
  { value: "stream", label: "One stream" },
  { value: "custom", label: "Custom range" },
];

export const STREAM_COUNTS = [1, 2, 3, 5, 10, 20];

/** Sessions more than this far apart belong to different streams. */
const STREAM_GAP_MS = 3 * 60 * 60 * 1000;

export interface Stream {
  id: string;
  start: Date;
  end: Date;
  files: Set<string>;
  races: number;
}

/** Groups every session into race nights ("streams"), newest first. */
export function buildStreams(races: LeagueRace[]): Stream[] {
  const dated = races
    .map((r) => ({ file: r.file, date: raceDate(r.file), race: /race/i.test(r.session["session-info"]?.["session-type"] ?? "") }))
    .filter((r): r is { file: string; date: Date; race: boolean } => r.date != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const streams: Stream[] = [];
  for (const r of dated) {
    const last = streams[streams.length - 1];
    if (last && r.date.getTime() - last.end.getTime() <= STREAM_GAP_MS) {
      last.end = r.date;
      last.files.add(r.file);
      if (r.race) last.races += 1;
    } else {
      streams.push({
        id: isoDay(r.date) + "T" + pad(r.date.getHours()) + pad(r.date.getMinutes()),
        start: r.date,
        end: r.date,
        files: new Set([r.file]),
        races: r.race ? 1 : 0,
      });
    }
  }
  return streams.reverse();
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** [from, to) for the calendar filters, local time. */
function bounds(filter: LeagueFilter, now: Date): { from: Date | null; to: Date | null } {
  const today = startOfDay(now);
  switch (filter.kind) {
    case "today":
      return { from: today, to: null };
    case "week": {
      // Weeks start on Monday
      const back = (today.getDay() + 6) % 7;
      return { from: new Date(today.getFullYear(), today.getMonth(), today.getDate() - back), to: null };
    }
    case "month":
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: null };
    case "year":
      return { from: new Date(now.getFullYear(), 0, 1), to: null };
    case "custom": {
      const from = filter.from ? new Date(`${filter.from}T00:00:00`) : null;
      const to = filter.to ? new Date(`${filter.to}T00:00:00`) : null;
      if (to) to.setDate(to.getDate() + 1); // the end day counts in full
      return { from, to };
    }
    default:
      return { from: null, to: null };
  }
}

/** The files the filter lets through, or null for everything. */
export function allowedFiles(
  filter: LeagueFilter,
  races: LeagueRace[],
  streams: Stream[],
  now = new Date(),
): Set<string> | null {
  if (filter.kind === "all") return null;
  if (filter.kind === "streams") {
    const files = new Set<string>();
    for (const s of streams.slice(0, filter.count)) for (const f of s.files) files.add(f);
    return files;
  }
  if (filter.kind === "stream") {
    return new Set(streams.find((s) => s.id === filter.id)?.files ?? []);
  }
  const { from, to } = bounds(filter, now);
  const files = new Set<string>();
  for (const r of races) {
    const d = raceDate(r.file);
    if (d && (!from || d >= from) && (!to || d < to)) files.add(r.file);
  }
  return files;
}

const dayFmt = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export function streamLabel(s: Stream): string {
  return `${dayFmt(s.start)} · ${s.races} ${s.races === 1 ? "race" : "races"}`;
}

/** Short description used in page subtitles, e.g. "October 2026". */
export function describeFilter(filter: LeagueFilter, streams: Stream[], now = new Date()): string {
  switch (filter.kind) {
    case "today":
      return "Today";
    case "week":
      return "This week";
    case "month":
      return now.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
    case "year":
      return String(now.getFullYear());
    case "all":
      return "All time";
    case "streams":
      return filter.count === 1 ? "Last stream" : `Last ${filter.count} streams`;
    case "stream": {
      const s = streams.find((x) => x.id === filter.id);
      return s ? `Stream of ${dayFmt(s.start)}` : "One stream";
    }
    case "custom": {
      const f = filter.from ? dayFmt(new Date(`${filter.from}T00:00:00`)) : "the start";
      const t = filter.to ? dayFmt(new Date(`${filter.to}T00:00:00`)) : "today";
      return `${f} to ${t}`;
    }
  }
}

const STORAGE_KEY = "league-filter";

export function readStoredFilter(): LeagueFilter {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as LeagueFilter) : null;
    if (parsed && FILTER_KINDS.some((k) => k.value === parsed.kind)) return parsed;
  } catch {
    // storage unavailable or old value — fall back to the default
  }
  return DEFAULT_FILTER;
}

export function storeFilter(filter: LeagueFilter): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
  } catch {
    // storage unavailable — the choice lasts for this visit only
  }
}
