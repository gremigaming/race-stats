import { Flame, Gauge, Play, Search, Swords, Timer, Trophy, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { cardClass, cardHighlight } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";
import { TrackLayout } from "../components/TrackLayout";
import { WeatherBackdrop, WeatherChip } from "../components/RaceWeather";
import { PillSelect } from "../components/ui/PillSelect";
import { cn } from "../utils/cn";
import { msToLapTime } from "../utils/format";
import { getTrackDisplayName } from "../utils/tracks";
import { loadRaceIndex, type RaceIndexEntry } from "../viewer/format";
import { useLiveSessions } from "../viewer/live";
import { PickerTabs } from "../viewer/LiveTab";

type Race = RaceIndexEntry & { base: string };
type Sort = "newest" | "chaos" | "incidents" | "cars" | "closest";

/** A stream night: races less than 3 hours apart (same rule as build-league-data.mjs). */
interface Night {
  key: string;
  label: string;
  races: Race[];
}

const NIGHT_GAP_MS = 3 * 3600 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "chaos", label: "Most chaotic" },
  { value: "incidents", label: "Most incidents" },
  { value: "cars", label: "Most cars" },
  { value: "closest", label: "Closest finish" },
] as const;

/** "28 Oct" from the race's own start string (local time of the racing PC, no time zone). */
function dayLabel(started: string): string {
  return `${Number(started.slice(8, 10))} ${MONTHS[Number(started.slice(5, 7)) - 1] ?? ""}`;
}

function nightsOf(races: Race[]): Night[] {
  const out: Night[] = [];
  let prev: number | null = null;
  for (const r of races) {
    const t = Date.parse(r.started);
    if (prev === null || prev - t > NIGHT_GAP_MS) out.push({ key: r.uid, label: "", races: [] });
    out[out.length - 1].races.push(r);
    prev = t;
  }
  for (const n of out) n.label = dayLabel(n.races[n.races.length - 1].started);
  return out;
}

const shownDriver = (name: string) => !/^Car #/.test(name);

/** The race picker for the Live Race Viewer: every published race, grouped by stream night, with filters. */
export function RaceListPage() {
  const { formulaKey } = useParams<{ formulaKey: string }>();
  const [races, setRaces] = useState<Race[] | null>(null);
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const track = params.get("track") ?? "";
  const driver = params.get("driver") ?? "";
  const night = params.get("night") ?? "";
  const sort = (params.get("sort") as Sort) || "newest";
  // the Live tab opens by itself while a session streams, unless the visitor picked a tab
  const liveNow = useLiveSessions().length > 0;
  const [tabPick, setTabPick] = useState<"races" | "live" | null>(null);
  const tab = liveNow && tabPick !== "races" ? "live" : "races";

  const set = (key: string, value: string) =>
    setParams(
      (p) => {
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );

  useEffect(() => {
    let alive = true;
    loadRaceIndex().then((r) => alive && setRaces(r));
    return () => {
      alive = false;
    };
  }, []);

  const nights = useMemo(() => nightsOf(races ?? []), [races]);
  const nightOf = useMemo(() => new Map(nights.flatMap((n) => n.races.map((r) => [r.uid, n] as const))), [nights]);
  const tracks = useMemo(() => [...new Set((races ?? []).map((r) => r.track))].sort(), [races]);
  const drivers = useMemo(
    () => [...new Set((races ?? []).flatMap((r) => r.drivers ?? []).filter(shownDriver))].sort((a, b) => a.localeCompare(b)),
    [races],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (races ?? []).filter(
      (r) =>
        (!track || r.track === track) &&
        (!driver || r.drivers?.includes(driver)) &&
        (!night || nightOf.get(r.uid)?.key === night) &&
        (!needle ||
          getTrackDisplayName(r.track).toLowerCase().includes(needle) ||
          r.track.toLowerCase().includes(needle) ||
          r.drivers?.some((d) => shownDriver(d) && d.toLowerCase().includes(needle))),
    );
  }, [races, q, track, driver, night, nightOf]);

  const sorted = useMemo(() => {
    const by: Record<Sort, (r: Race) => number> = {
      newest: () => 0,
      chaos: (r) => -(r.chaos ?? -1),
      incidents: (r) => -(r.incidents ?? -1),
      cars: (r) => -r.cars,
      closest: (r) => r.gap ?? Infinity,
    };
    return [...shown].sort((a, b) => by[sort](a) - by[sort](b));
  }, [shown, sort]);

  // badges: the most chaotic race and the closest finish of each stream night
  const badges = useMemo(() => {
    const out = new Map<string, ("chaos" | "close")[]>();
    const add = (uid: string, b: "chaos" | "close") => out.set(uid, [...(out.get(uid) ?? []), b]);
    for (const n of nights) {
      const wild = n.races.reduce<Race | null>((m, r) => ((r.chaos ?? 0) > (m?.chaos ?? 0) ? r : m), null);
      if (wild && (wild.chaos ?? 0) >= 3) add(wild.uid, "chaos");
      const close = n.races.reduce<Race | null>((m, r) => (r.gap !== undefined && r.gap < (m?.gap ?? 2) ? r : m), null);
      if (close) add(close.uid, "close");
    }
    return out;
  }, [nights]);

  const filtered = !!(q || track || driver || night);
  const totals = useMemo(
    () => ({
      incidents: (races ?? []).reduce((s, r) => s + (r.incidents ?? 0), 0),
      laps: (races ?? []).reduce((s, r) => s + r.laps * r.cars, 0),
    }),
    [races],
  );

  const card = (r: Race) => (
    <RaceCard key={r.uid} race={r} to={`/${formulaKey}/race/${encodeURIComponent(r.uid)}`} badges={badges.get(r.uid) ?? []} />
  );

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PickerTabs tab={tab} onTab={setTabPick} formulaKey={formulaKey} />
      {tab === "races" && (
        <>
      <section className={cn(cardClass, "relative overflow-hidden")}>
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-red-500/10 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-zinc-50">Race viewer</h1>
            <p className="mt-1 max-w-xl text-sm text-zinc-400">
              Pick a race and watch it from above: every car, every lap and every incident.
            </p>
          </div>
          {races && races.length > 0 && (
            <div className="flex gap-6 text-right">
              <Stat value={races.length} label="races" />
              <Stat value={nights.length} label="stream nights" />
              <Stat value={totals.incidents} label="incidents" />
            </div>
          )}
        </div>

        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <label className="relative min-w-48 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => set("q", e.target.value)}
              placeholder="Search track or driver"
              aria-label="Search track or driver"
              className="h-9 w-full rounded-full bg-white/5 pl-8 pr-3 text-sm text-zinc-100 placeholder:text-zinc-500 outline-none ring-1 ring-white/10 focus:ring-red-500/60"
            />
          </label>
          <PillSelect
            ariaLabel="Track"
            value={track}
            onChange={(v) => set("track", v)}
            options={[{ value: "", label: "All tracks" }, ...tracks.map((t) => ({ value: t, label: getTrackDisplayName(t) }))]}
          />
          <PillSelect
            ariaLabel="Driver"
            leadingIcon={Users}
            value={driver}
            onChange={(v) => set("driver", v)}
            options={[{ value: "", label: "All drivers" }, ...drivers.map((d) => ({ value: d, label: d }))]}
          />
          <PillSelect
            ariaLabel="Stream night"
            value={night}
            onChange={(v) => set("night", v)}
            options={[
              { value: "", label: "All stream nights" },
              ...nights.map((n) => ({ value: n.key, label: `${n.label} · ${n.races.length} ${n.races.length === 1 ? "race" : "races"}` })),
            ]}
          />
          <PillSelect
            ariaLabel="Sort"
            leadingIcon={Gauge}
            value={sort}
            onChange={(v) => set("sort", v === "newest" ? "" : v)}
            options={SORTS}
          />
          {filtered && (
            <button
              onClick={() => setParams(sort === "newest" ? {} : { sort }, { replace: true })}
              className="flex h-9 items-center gap-1 rounded-full px-3 text-xs text-zinc-400 hover:bg-white/5 hover:text-zinc-100"
            >
              <X className="size-3.5" /> Clear
            </button>
          )}
        </div>
      </section>

      {races === null ? (
        <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
      ) : sorted.length === 0 ? (
        <p className="text-center text-sm text-zinc-500">{races.length ? "No races match these filters." : "No races yet."}</p>
      ) : sort === "newest" ? (
        nights
          .map((n) => ({ n, list: sorted.filter((r) => nightOf.get(r.uid) === n) }))
          .filter(({ list }) => list.length)
          .map(({ n, list }) => (
            <section key={n.key} className="space-y-3">
              <h2 className="flex items-baseline gap-2 px-1">
                <span className="text-base font-semibold text-zinc-100">{n.label}</span>
                <span className="text-xs text-zinc-500">
                  {n.races.length} {n.races.length === 1 ? "race" : "races"} · {n.races.reduce((s, r) => s + (r.incidents ?? 0), 0)} incidents
                </span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.map(card)}</div>
            </section>
          ))
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{sorted.map(card)}</div>
      )}
        </>
      )}
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums text-zinc-50">{value.toLocaleString("en")}</div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
    </div>
  );
}

/** Chaos rating 0-10 as a little five-segment meter that warms up from amber to red. */
function ChaosMeter({ value }: { value: number }) {
  const lit = Math.round(value / 2);
  return (
    <span className="flex items-center gap-1.5" title={`Chaos rating ${value.toFixed(1)} / 10`}>
      <Flame className={cn("size-3.5", value >= 6 ? "text-red-400" : value >= 3 ? "text-amber-400" : "text-zinc-500")} />
      <span className="flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={cn("h-1.5 w-3 rounded-full", i < lit ? (i >= 3 ? "bg-red-500" : i >= 1 ? "bg-amber-400" : "bg-yellow-300") : "bg-white/10")}
          />
        ))}
      </span>
    </span>
  );
}

function RaceCard({ race: r, to, badges }: { race: Race; to: string; badges: ("chaos" | "close")[] }) {
  return (
    <Link
      to={to}
      className={cn(
        "group relative flex min-h-40 flex-col overflow-hidden rounded-2xl bg-white/[0.03] p-4 transition hover:-translate-y-0.5 hover:bg-white/[0.06]",
        cardHighlight,
      )}
    >
      <WeatherBackdrop codes={r.weather} />
      <TrackLayout
        track={r.track}
        className="pointer-events-none absolute bottom-2 right-2 size-24 text-white/[0.08] transition group-hover:text-red-500/25 [&>svg]:size-full"
      />
      <div className="relative flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <TrackFlag track={r.track} size="small" className="rounded-[2px]" />
            <span className="truncate font-semibold text-zinc-50">{getTrackDisplayName(r.track)}</span>
          </div>
          <div className="mt-0.5 text-xs text-zinc-500">
            {dayLabel(r.started)} · {r.started.slice(11, 16)} · {r.session}
          </div>
          <WeatherChip codes={r.weather} className="mt-1.5 w-fit" />
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-500/90 text-white opacity-0 shadow-lg transition group-hover:opacity-100">
          <Play className="ml-0.5 size-3.5 fill-current" />
        </span>
      </div>

      {badges.length > 0 && (
        <div className="relative mt-2 flex flex-wrap gap-1.5">
          {badges.includes("chaos") && (
            <span className="flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
              <Flame className="size-3" /> Most chaotic
            </span>
          )}
          {badges.includes("close") && (
            <span className="flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] font-medium text-sky-300">
              <Swords className="size-3" /> Closest finish
            </span>
          )}
        </div>
      )}

      <div className="relative mt-auto space-y-1.5 pt-3 text-xs">
        {r.winner && (
          <div className="flex items-center gap-1.5 text-zinc-200">
            <Trophy className="size-3.5 text-yellow-400" />
            <span className="truncate">{r.winner}</span>
            {r.gap !== undefined && <span className="text-zinc-500">by {r.gap.toFixed(1)}s</span>}
          </div>
        )}
        {r.fastest && (
          <div className="flex items-center gap-1.5 text-zinc-400">
            <Timer className="size-3.5 text-fuchsia-400" />
            <span className="tabular-nums">{msToLapTime(r.fastest.ms)}</span>
            <span className="truncate text-zinc-500">{r.fastest.name}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 pt-1 text-zinc-500">
          <span>
            {r.laps} laps · {r.cars} cars
            {r.incidents !== undefined && ` · ${r.incidents} ${r.incidents === 1 ? "incident" : "incidents"}`}
          </span>
          {r.chaos !== undefined && <ChaosMeter value={r.chaos} />}
        </div>
      </div>
    </Link>
  );
}
