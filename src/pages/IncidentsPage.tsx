import { Clapperboard, Flame, Pause, Play, RotateCcw, ShieldCheck, Swords, TriangleAlert, Trophy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { chronological, biggestFirst, chunkStart, raceTime, rowsOf, streamOf, streamsOf, useManifests, useRaceIndex, type RaceRef, type Row } from "../components/incidents/data";
import { IncidentCharts } from "../components/incidents/IncidentCharts";
import { CAR_COLORS, IncidentMap, type Clock, type IncidentSeries } from "../components/incidents/IncidentMap";
import { KIND_META, KIND_ORDER, type IncidentKind } from "../viewer/incidentKinds";
import { clock } from "../viewer/panels";
import type { MapPin } from "../viewer/scene";
import { driverKey } from "../league/league";

/**
 * The incident viewer (GreMi, 5 Nov 2026): every incident, easy to find. A race's full track with
 * its biggest incidents as coloured markers (by type), a list biggest-first or in race order,
 * filters for drivers (also driver vs driver), types and a time range, a few fun "awards" over
 * that range, and each incident replayed on the map with the cars' lines and inputs.
 */

type Range = "stream" | "week" | "month" | "all";
const RANGES: { key: Range; label: string }[] = [
  { key: "stream", label: "This stream" },
  { key: "week", label: "7 days" },
  { key: "month", label: "30 days" },
  { key: "all", label: "All" },
];
const TOP_PINS = 5;
const SPEEDS = [0.25, 0.5, 1];

const dateLabel = (r: RaceRef) =>
  new Date(raceTime(r)).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const short = (r: RaceRef) => `${r.track} · ${new Date(raceTime(r)).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;

function SevBadge({ sev, big }: { sev: number; big?: boolean }) {
  const cls = sev >= 8 ? "bg-red-500 text-white" : sev >= 6 ? "bg-orange-500 text-black" : sev >= 3 ? "bg-amber-400/80 text-black" : "bg-zinc-600 text-zinc-100";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-md font-mono font-bold tabular-nums ${cls} ${big ? "h-9 w-9 text-base" : "h-6 w-6 text-xs"}`} title={`Severity ${sev}/10`}>
      {sev}
    </span>
  );
}

function KindPill({ kind }: { kind: IncidentKind }) {
  const m = KIND_META[kind];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: m.color }} title={m.hint}>
      <span className="h-2 w-2 rounded-full" style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

export function IncidentsPage() {
  const { formulaKey } = useParams<{ formulaKey: string }>();
  const [params, setParams] = useSearchParams();
  const index = useRaceIndex();
  const races = useMemo(() => (index.data ?? []).filter((r) => /race/i.test(r.session)), [index.data]);

  // ---- filters (in the URL, so a view can be shared)
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (cur) => {
        const next = new URLSearchParams(cur);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null || v === "") next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );
  const range = (params.get("range") as Range) || "stream";
  const raceUid = params.get("race") && races.some((r) => r.uid === params.get("race")) ? params.get("race")! : (races[0]?.uid ?? "");
  const race = races.find((r) => r.uid === raceUid) ?? null;
  const drivers = (params.get("d") ?? "").split(",").filter(Boolean);
  const sort = params.get("sort") === "time" ? "time" : "big";
  const scope = params.get("scope") === "range" ? "range" : "race";
  const hidden = new Set((params.get("hide") ?? "").split(",").filter(Boolean) as IncidentKind[]);
  const allPins = params.get("pins") === "all";
  const openId = params.get("inc");
  const track = params.get("track") ?? "";

  // ---- the races in the time range (and the race on the map)
  const inRange = useMemo(() => {
    if (!race) return [];
    const now = Date.now();
    let list: RaceRef[];
    if (range === "stream") list = streamOf(races, race.uid);
    else if (range === "all") list = races;
    else list = races.filter((r) => now - raceTime(r) <= (range === "week" ? 7 : 30) * 86400_000);
    if (track) list = list.filter((r) => r.track === track);
    return list;
  }, [races, race, range, track]);
  /** Every race of the selected race's stream (one evening, all tracks). */
  // (the newest stream by default, stepped with the arrows; never tied to the race or track picked below)
  const streams = useMemo(() => streamsOf(races), [races]);
  const streamParam = params.get("stream");
  const streamIdx = Math.max(0, streams.findIndex((g) => g.some((r) => r.uid === streamParam)));
  const streamRaces = useMemo(() => streams[streamIdx] ?? [], [streams, streamIdx]);
  const uids = useMemo(
    () => [...new Set([raceUid, ...inRange.map((r) => r.uid), ...streamRaces.map((r) => r.uid)].filter(Boolean))],
    [raceUid, inRange, streamRaces],
  );
  const { map: manifests, loading } = useManifests(uids);

  const rowsByRace = useMemo(() => {
    const out = new Map<string, Row[]>();
    for (const r of [...inRange, ...streamRaces, ...(race ? [race] : [])]) {
      const m = manifests.get(r.uid);
      if (m && !out.has(r.uid)) out.set(r.uid, rowsOf(r, m.manifest));
    }
    return out;
  }, [inRange, streamRaces, race, manifests]);
  const rangeRows = useMemo(() => inRange.flatMap((r) => rowsByRace.get(r.uid) ?? []), [inRange, rowsByRace]);
  const raceRows = rowsByRace.get(raceUid) ?? [];

  // ---- who's in there (for the driver filter)
  const driverOptions = useMemo(() => {
    const count = new Map<string, { name: string; n: number }>();
    for (const r of [...rangeRows, ...raceRows])
      r.keys.forEach((k, i) => {
        if (r.tap) return;
        const c = count.get(k) ?? { name: r.names[i], n: 0 };
        c.n++;
        count.set(k, c);
      });
    return [...count.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  }, [rangeRows, raceRows]);
  const nameOf = (key: string) => driverOptions.find((d) => d.key === key)?.name ?? key;

  /** The filter: one driver = their incidents; two or more = incidents between them. Taps only between exactly the picked drivers. */
  const match = (r: Row) => {
    if (r.tap) return drivers.length >= 2 && r.keys.every((k) => drivers.includes(k));
    if (hidden.has(r.kind)) return false;
    if (!drivers.length) return true;
    const hit = r.keys.filter((k) => drivers.includes(k)).length;
    return drivers.length === 1 ? hit >= 1 : hit >= 2;
  };
  const order = sort === "time" ? chronological : biggestFirst;
  const listRows = useMemo(() => (scope === "range" ? rangeRows : raceRows).filter(match).sort(order), [scope, rangeRows, raceRows, params]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- markers: this race's incidents numbered biggest first; the top 5, or all that match a driver filter
  const raceRanked = useMemo(() => raceRows.filter(match).sort(biggestFirst), [raceRows, params]); // eslint-disable-line react-hooks/exhaustive-deps
  const rank = new Map(raceRanked.map((r, i) => [r.id, i + 1]));
  const open = [...rangeRows, ...raceRows].find((r) => r.id === openId) ?? null;
  const pinRows = drivers.length || allPins ? raceRanked : raceRanked.filter((r) => !r.tap).slice(0, TOP_PINS);
  if (open && open.uid === raceUid && !pinRows.includes(open)) pinRows.push(open);
  const pins: MapPin[] = pinRows.map((r) => ({
    id: r.id,
    x: r.inc.x,
    z: r.inc.z,
    color: KIND_META[r.kind].color,
    r: 10 + Math.round(r.sev * 0.6),
    label: String(rank.get(r.id) ?? ""),
    title: `#${rank.get(r.id)} ${r.names.slice(0, 3).join(" & ")} · ${KIND_META[r.kind].label} · ${r.sev}/10${r.inc.lap ? ` · lap ${r.inc.lap}` : ""}`,
    active: r.id === openId,
    dim: !!openId && r.id !== openId,
  }));

  /** First click: show it (data + where on the track). Clicking the same one again plays it. */
  const openRow = (r: Row) => {
    if (r.id === openId) {
      clockRef.current.run++;
      return;
    }
    set({ inc: r.id, race: r.uid !== raceUid ? r.uid : raceUid });
  };

  // ---- playback of the open incident
  const clockRef = useRef<Clock>({ t: 0, playing: false, rate: 0.5, run: 0 });
  const [tick, setTick] = useState<{ t: number; playing: boolean; phase: string }>({ t: 0, playing: false, phase: "done" });
  const [series, setSeries] = useState<IncidentSeries | null>(null);
  const [rate, setRate] = useState(0.5);
  useEffect(() => setSeries(null), [openId]);
  const mapRace = manifests.get(raceUid);
  const openHere = open && open.uid === raceUid ? open : null;
  const carOrder = openHere ? openHere.cars.slice(0, CAR_COLORS.length) : [];

  // ---- the fun bit: awards over the time range
  const filteredRange = rangeRows.filter(match);
  // the stream's biggest, over every track raced that evening
  const streamTop = streamRaces
    .flatMap((r) => rowsByRace.get(r.uid) ?? [])
    .filter((r) => !r.tap)
    .sort(biggestFirst)
    .slice(0, 10);
  const top = (rows: Row[]) => rows.filter((r) => !r.tap).sort(biggestFirst)[0] ?? null;
  const biggest = top(filteredRange);
  const wanted = useMemo(() => {
    const m = new Map<string, { n: number; sev: number }>();
    for (const r of filteredRange) for (const k of r.fault) m.set(k, { n: (m.get(k)?.n ?? 0) + 1, sev: (m.get(k)?.sev ?? 0) + r.sev });
    return [...m.entries()].sort((a, b) => b[1].sev - a[1].sev)[0] ?? null;
  }, [filteredRange]);
  const grudge = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of filteredRange) {
      if (r.tap || r.sev < 2) continue;
      const ks = [...new Set(r.keys)].sort();
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) m.set(`${ks[i]}|${ks[j]}`, (m.get(`${ks[i]}|${ks[j]}`) ?? 0) + 1);
    }
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    return best && best[1] >= 2 ? { pair: best[0].split("|"), n: best[1] } : null;
  }, [filteredRange]);
  const clean = useMemo(() => {
    // most races in range without being at fault once
    const racesOf = new Map<string, Set<string>>();
    for (const r of inRange)
      for (const d of r.drivers ?? []) {
        const k = driverKey(d);
        (racesOf.get(k) ?? racesOf.set(k, new Set()).get(k)!).add(r.uid);
      }
    const guilty = new Set(rangeRows.flatMap((r) => r.fault));
    const best = [...racesOf.entries()].filter(([k]) => !guilty.has(k)).sort((a, b) => b[1].size - a[1].size)[0];
    return best && best[1].size >= 2 ? { key: best[0], n: best[1].size } : null;
  }, [inRange, rangeRows]);
  const rangeLabel = RANGES.find((r) => r.key === range)?.label ?? "";

  // ---- driver vs driver: the open incident's first two drivers over the range
  const versus = useMemo(() => {
    if (!open || open.keys.length < 2) return null;
    const [a, b] = open.keys;
    const between = rangeRows.filter((r) => !r.tap && r.keys.includes(a) && r.keys.includes(b));
    return {
      a,
      b,
      n: between.length,
      fa: between.filter((r) => r.fault.includes(a)).length,
      fb: between.filter((r) => r.fault.includes(b)).length,
    };
  }, [open, rangeRows]);

  // ---- a link from a safety rating incident (?file=Race_<track>_<date>.json&lap=&with=a|b): find the race, then the incident
  const fileParam = params.get("file");
  const withParam = params.get("with");
  useEffect(() => {
    if (!fileParam || !races.length) return;
    const m = /^Race_(.+)_(\d{4})_(\d\d)_(\d\d)_(\d\d)_(\d\d)_(\d\d)\.json$/.exec(fileParam);
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    let best: RaceRef | null = null;
    let bestD = Infinity;
    if (m) {
      const ft = Date.UTC(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]);
      for (const r of races) {
        if (!norm(m[1]).startsWith(norm(r.track))) continue;
        const d = ft - raceTime(r);
        if (d < -10 * 60_000 || d > 4 * 3600_000 || Math.abs(d) >= bestD) continue;
        best = r;
        bestD = Math.abs(d);
      }
    }
    if (best) set({ race: best.uid, file: null, inc: null });
    else set({ file: null, with: null, lap: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileParam, races]);
  useEffect(() => {
    if (fileParam || !withParam || !rowsByRace.has(raceUid)) return;
    const want = withParam.split("|").map(driverKey);
    const lap = Number(params.get("lap"));
    let best: Row | null = null;
    let bestScore = 0;
    for (const r of raceRows) {
      const overlap = r.keys.filter((k) => want.includes(k)).length;
      if (!overlap) continue;
      const score = overlap * 10 - (Number.isFinite(lap) && r.inc.lap ? Math.abs(r.inc.lap - lap) * 3 : 0) + r.sev * 0.1;
      if (score > bestScore) {
        best = r;
        bestScore = score;
      }
    }
    clockRef.current.run++;
    set({ with: null, lap: null, inc: best?.id ?? null, scope: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileParam, withParam, rowsByRace, raceUid]);

  const tracks = useMemo(() => [...new Set(races.map((r) => r.track))].sort(), [races]);
  const kindsHere = KIND_ORDER.filter((k) => k !== "tap" && (rangeRows.some((r) => r.kind === k) || raceRows.some((r) => r.kind === k)));

  if (index.isLoading) return <Centered>Loading races…</Centered>;
  if (!races.length) return <Centered>No races yet.</Centered>;

  const viewerLink = open
    ? (() => {
        const m = manifests.get(open.uid)?.manifest;
        const at = m ? Math.round((open.inc.t0 - chunkStart(m)) * 10) / 10 : 0;
        return `/${formulaKey}/race/${encodeURIComponent(open.uid)}?inc=${at}${open.cars.length ? `&car=${open.cars.slice(0, 4).join(",")}` : ""}`;
      })()
    : "";

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 md:p-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <TriangleAlert className="h-5 w-5 text-amber-400" />
          Incident viewer
        </h2>
        <p className="text-sm text-zinc-500">Find any incident: pick a race, filter by driver or type, click a marker or a row to watch it.</p>
      </div>

      {/* ---- filters */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-zinc-900/40 p-2">
        <Seg value={range} options={RANGES} onChange={(v) => set({ range: v === "stream" ? null : v })} />
        <select
          value={track}
          onChange={(e) => set({ track: e.target.value || null })}
          className="h-8 rounded-md border border-white/10 bg-zinc-900 px-2 text-sm text-zinc-200"
          aria-label="Track"
        >
          <option value="">All tracks</option>
          {tracks.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={raceUid}
          onChange={(e) => set({ race: e.target.value, inc: null })}
          className="h-8 min-w-0 max-w-full rounded-md border border-white/10 bg-zinc-900 px-2 text-sm text-zinc-200"
          aria-label="Race on the map"
        >
          {(track ? races.filter((r) => r.track === track || r.uid === raceUid) : races).map((r) => (
            <option key={r.uid} value={r.uid}>
              {r.track} · {dateLabel(r)}
              {r.incidents ? ` · ${r.incidents} incidents` : ""}
            </option>
          ))}
        </select>
        <select
          value=""
          onChange={(e) => e.target.value && set({ d: [...drivers, e.target.value].join(","), inc: null })}
          className="h-8 rounded-md border border-white/10 bg-zinc-900 px-2 text-sm text-zinc-200"
          aria-label="Add a driver"
        >
          <option value="">{drivers.length ? "Add a driver…" : "Filter by driver…"}</option>
          {driverOptions
            .filter((d) => !drivers.includes(d.key))
            .map((d) => (
              <option key={d.key} value={d.key}>
                {d.name} ({d.n})
              </option>
            ))}
        </select>
        {drivers.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => set({ d: drivers.filter((x) => x !== k).join(",") || null })}
            className="flex h-8 items-center gap-1 rounded-full bg-white/90 px-3 text-sm font-medium text-black hover:bg-white"
            title="Remove this driver"
          >
            {nameOf(k)} <X className="h-3.5 w-3.5" />
          </button>
        ))}
        {drivers.length === 1 && <span className="text-xs text-zinc-500">Add a second driver to see only incidents between them.</span>}
        <div className="ml-auto">
          <Seg
            value={sort}
            options={[
              { key: "big", label: "Biggest first" },
              { key: "time", label: "In race order" },
            ]}
            onChange={(v) => set({ sort: v === "big" ? null : v })}
          />
        </div>
      </div>

      {/* ---- the stream's biggest incidents, every track of that evening */}
      <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Flame className="h-4 w-4 text-red-400" /> Biggest incidents of the stream
          </span>
          <span className="flex items-center gap-1">
            <button
              type="button"
              disabled={streamIdx >= streams.length - 1}
              onClick={() => set({ stream: streams[streamIdx + 1]?.[0]?.uid ?? null })}
              className="rounded px-1.5 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
              aria-label="Previous stream"
            >
              ‹
            </button>
            <button
              type="button"
              disabled={streamIdx <= 0}
              onClick={() => set({ stream: streamIdx - 1 <= 0 ? null : streams[streamIdx - 1][0].uid })}
              className="rounded px-1.5 text-zinc-400 hover:bg-white/10 hover:text-white disabled:opacity-30"
              aria-label="Next stream"
            >
              ›
            </button>
          </span>
          {streamRaces.length > 0 && (
            <span className="text-xs text-zinc-500">
              {new Date(raceTime(streamRaces[0])).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} ·{" "}
              {[...new Set(streamRaces.map((r) => r.track))].join(", ")}
            </span>
          )}
        </div>
        {streamTop.length ? (
          <ol className="flex snap-x gap-2 overflow-x-auto pb-1">
            {streamTop.map((r, i) => (
              <li key={r.id} className="snap-start">
                <button
                  type="button"
                  onClick={() => openRow(r)}
                  className={`flex w-56 items-start gap-2 rounded-lg border p-2 text-left hover:bg-white/5 ${r.id === openId ? "border-white/40 bg-white/10" : "border-white/10"}`}
                >
                  <span className="mt-0.5 w-5 shrink-0 text-center font-mono text-xs text-zinc-500">{i + 1}</span>
                  <SevBadge sev={r.sev} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{r.names.slice(0, 2).join(" & ")}</span>
                    <span className="block truncate text-[11px] text-zinc-500">
                      <span style={{ color: KIND_META[r.kind].color }}>{KIND_META[r.kind].label}</span> · {r.race.track}
                      {r.inc.lap ? ` · lap ${r.inc.lap}` : ""}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-zinc-500">{loading ? "Loading the stream's races…" : "No incidents in this stream match the filters."}</p>
        )}
      </div>

      {/* ---- awards */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Award icon={<Trophy className="h-4 w-4 text-amber-300" />} title={`Biggest · ${rangeLabel}`} empty={!biggest} onClick={biggest ? () => openRow(biggest) : undefined}>
          {biggest && (
            <>
              <b>{biggest.names.slice(0, 2).join(" & ")}</b>
              <span>
                {KIND_META[biggest.kind].label} · {biggest.sev}/10 · {short(biggest.race)}
              </span>
            </>
          )}
        </Award>
        <Award icon={<TriangleAlert className="h-4 w-4 text-orange-400" />} title="Most wanted" empty={!wanted} onClick={wanted ? () => set({ d: wanted[0], inc: null, scope: "range" }) : undefined}>
          {wanted && (
            <>
              <b>{nameOf(wanted[0])}</b>
              <span>
                At fault {wanted[1].n}× · total severity {wanted[1].sev}
              </span>
            </>
          )}
        </Award>
        <Award icon={<Swords className="h-4 w-4 text-sky-300" />} title="Grudge match" empty={!grudge} onClick={grudge ? () => set({ d: grudge.pair.join(","), inc: null, scope: "range" }) : undefined}>
          {grudge && (
            <>
              <b>{grudge.pair.map(nameOf).join(" vs ")}</b>
              <span>{grudge.n} incidents together</span>
            </>
          )}
        </Award>
        <Award icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Clean sheet" empty={!clean} onClick={clean ? () => set({ d: clean.key, inc: null, scope: "range" }) : undefined}>
          {clean && (
            <>
              <b>{nameOf(clean.key)}</b>
              <span>{clean.n} races, never at fault</span>
            </>
          )}
        </Award>
      </div>
      {loading > 0 && <p className="text-xs text-zinc-500">Loading {loading} more race{loading > 1 ? "s" : ""}…</p>}

      {/* ---- map + list */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-semibold text-zinc-200">{race ? `${race.track} · ${dateLabel(race)}` : ""}</span>
            <span className="text-zinc-500">
              {drivers.length || allPins ? `${pinRows.length} incident${pinRows.length === 1 ? "" : "s"} on the map` : `The ${Math.min(TOP_PINS, pinRows.length)} biggest on the map`}
            </span>
            {!drivers.length && raceRanked.filter((r) => !r.tap).length > TOP_PINS && (
              <button type="button" onClick={() => set({ pins: allPins ? null : "all" })} className="rounded bg-white/10 px-2 py-0.5 text-zinc-200 hover:bg-white/15">
                {allPins ? `Top ${TOP_PINS} only` : `Show all ${raceRanked.filter((r) => !r.tap).length}`}
              </button>
            )}
          </div>
          <div className="relative h-[52vh] min-h-[300px]">
            {mapRace ? (
              <IncidentMap
                key={raceUid}
                manifest={mapRace.manifest}
                base={mapRace.base}
                pins={pins}
                open={openHere?.inc ?? null}
                cars={carOrder}
                clock={clockRef}
                onPin={(id) => {
                  const r = raceRows.find((x) => x.id === id);
                  if (r) openRow(r);
                }}
                onTick={(t, playing, phase) => setTick({ t, playing, phase })}
                onSeries={setSeries}
              />
            ) : (
              <div className="flex h-full items-center justify-center rounded-xl border border-white/10 text-sm text-zinc-500">Loading the race…</div>
            )}
          </div>
          {/* legend: click a type to hide or show it */}
          <div className="flex flex-wrap gap-1.5">
            {kindsHere.map((k) => {
              const off = hidden.has(k);
              return (
                <button
                  key={k}
                  type="button"
                  title={`${KIND_META[k].hint} (click to ${off ? "show" : "hide"})`}
                  onClick={() => {
                    const next = new Set(hidden);
                    if (off) next.delete(k);
                    else next.add(k);
                    set({ hide: [...next].join(",") || null });
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] ${off ? "border-white/10 text-zinc-600 line-through" : "border-white/15 text-zinc-300 hover:bg-white/5"}`}
                >
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: off ? "#3f3f46" : KIND_META[k].color }} />
                  {KIND_META[k].label}
                </button>
              );
            })}
            {drivers.length >= 2 && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-zinc-500">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: KIND_META.tap.color }} />
                Taps between these drivers included
              </span>
            )}
          </div>

          {/* ---- the open incident */}
          {open && (
            <div className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
              <div className="flex flex-wrap items-start gap-3">
                <SevBadge sev={open.sev} big />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2">
                    <KindPill kind={open.kind} />
                    <span className="text-[11px] text-zinc-500">
                      {short(open.race)}
                      {open.inc.lap ? ` · lap ${open.inc.lap}` : ""} · {clock(open.inc.t0 - open.start)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-base font-semibold">
                    {open.cars.slice(0, CAR_COLORS.length).map((c, i) => (
                      <span key={c} className="inline-flex items-center gap-1.5">
                        {i > 0 && <span className="text-sm font-normal text-zinc-500">&</span>}
                        <span className="h-3 w-3 rounded-full" style={{ background: CAR_COLORS[i] }} />
                        {open.names[i]}
                      </span>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={() => set({ inc: null })} className="rounded-md p-1.5 text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {open.inc.verdict?.verdict && (
                <div className="mt-2 rounded-lg bg-black/25 px-3 py-2 text-sm">
                  <span className="font-semibold">{open.inc.verdict.verdict}</span>
                  {open.inc.verdict.why && <span className="text-zinc-400">: {open.inc.verdict.why}</span>}
                  <div className="mt-0.5 text-[10px] text-zinc-600">The fault engine's call. Staff decisions and grades can change it on the safety rating page.</div>
                </div>
              )}
              {open.uid === raceUid ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <CtlButton
                      onClick={() => {
                        const c = clockRef.current;
                        // shown but not played yet (or played out): play it from the start
                        if (tick.phase === "preview" || tick.phase === "done") {
                          c.run++;
                          return;
                        }
                        c.playing = !c.playing;
                        setTick((x) => ({ ...x, playing: c.playing }));
                      }}
                    >
                      {tick.playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                      {tick.playing ? "Pause" : "Play"}
                    </CtlButton>
                    <CtlButton onClick={() => clockRef.current.run++}>
                      <RotateCcw className="h-4 w-4" /> Replay
                    </CtlButton>
                    <div className="flex items-center gap-0.5">
                      {SPEEDS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            clockRef.current.rate = s;
                            setRate(s);
                          }}
                          className={`rounded px-1.5 py-0.5 font-mono text-xs ${s === rate ? "bg-white/90 text-black" : "text-zinc-400 hover:bg-white/10"}`}
                        >
                          {s}x
                        </button>
                      ))}
                    </div>
                    <span className="font-mono text-xs tabular-nums text-zinc-400">
                      {tick.phase === "loading"
                        ? "Loading the cars…"
                        : tick.phase === "preview"
                          ? "Click the marker again (or Play) to watch it"
                          : `${(tick.t - open.inc.t0).toFixed(1)} s`}
                    </span>
                    <Link to={viewerLink} className="ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-zinc-300 hover:bg-white/10 hover:text-white">
                      <Clapperboard className="h-4 w-4" /> Open in the race viewer
                    </Link>
                  </div>
                  <div className="mt-3">
                    {series ? (
                      <IncidentCharts
                        series={series}
                        names={(car) => mapRace?.manifest.cars[String(car)]?.name ?? `Car ${car}`}
                        t={tick.t}
                        contact={open.inc.t0}
                        onSeek={(t) => {
                          clockRef.current.t = t;
                          clockRef.current.playing = false;
                          setTick((x) => ({ ...x, t, playing: false }));
                        }}
                      />
                    ) : (
                      <p className="text-xs text-zinc-500">Loading the cars around this incident…</p>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-xs text-zinc-500">Loading this race on the map…</p>
              )}
              {versus && versus.n > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-white/10 px-3 py-2 text-xs">
                  <Swords className="h-4 w-4 text-sky-300" />
                  <span className="font-semibold">
                    {nameOf(versus.a)} vs {nameOf(versus.b)}
                  </span>
                  <span className="text-zinc-400">
                    {versus.n} incident{versus.n > 1 ? "s" : ""} together ({rangeLabel.toLowerCase()})
                  </span>
                  <span className="text-zinc-400">
                    {nameOf(versus.a)} at fault {versus.fa}× · {nameOf(versus.b)} at fault {versus.fb}×
                  </span>
                  <button type="button" onClick={() => set({ d: `${versus.a},${versus.b}`, scope: "range" })} className="ml-auto rounded bg-white/10 px-2 py-0.5 text-zinc-200 hover:bg-white/15">
                    Show them all
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---- the list */}
        <div className="flex min-h-0 flex-col rounded-xl border border-white/10 bg-zinc-900/40 lg:max-h-[calc(52vh+2rem)] lg:min-h-[300px]">
          <div className="flex items-center gap-2 border-b border-white/10 p-2">
            <Seg
              value={scope}
              options={[
                { key: "race", label: "This race" },
                { key: "range", label: rangeLabel },
              ]}
              onChange={(v) => set({ scope: v === "race" ? null : v })}
            />
            <span className="ml-auto text-xs text-zinc-500">{listRows.length}</span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto">
            {listRows.map((r) => {
              const here = r.uid === raceUid;
              const on = r.id === openId;
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRow(r)}
                    className={`flex w-full items-start gap-2.5 border-b border-white/5 px-3 py-2 text-left hover:bg-white/5 ${on ? "bg-white/10" : ""}`}
                    style={on ? { boxShadow: `inset 3px 0 0 ${KIND_META[r.kind].color}` } : undefined}
                  >
                    <SevBadge sev={r.sev} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.names.slice(0, 3).join(" & ")}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-[11px] text-zinc-500">
                        <KindPill kind={r.kind} />
                        <span>
                          {scope === "range" ? `${short(r.race)} · ` : ""}
                          {r.inc.lap ? `Lap ${r.inc.lap}` : clock(r.inc.t0 - r.start)}
                        </span>
                        {r.inc.verdict?.verdict && <span className="truncate">{r.inc.verdict.verdict}</span>}
                      </span>
                    </span>
                    {here && rank.has(r.id) && <span className="mt-0.5 font-mono text-[11px] text-zinc-500">#{rank.get(r.id)}</span>}
                  </button>
                </li>
              );
            })}
            {!listRows.length && (
              <li className="px-3 py-8 text-center text-sm text-zinc-500">
                {loading ? "Loading…" : drivers.length >= 2 ? "No incidents between these drivers here." : "No incidents match."}
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex h-full min-h-[50vh] items-center justify-center text-zinc-500">{children}</div>;
}

function Seg<T extends string>(props: { value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex rounded-md border border-white/10 p-0.5">
      {props.options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => props.onChange(o.key)}
          className={`whitespace-nowrap rounded px-2 py-1 text-xs font-medium ${o.key === props.value ? "bg-white/90 text-black" : "text-zinc-400 hover:text-zinc-100"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Award(props: { icon: ReactNode; title: string; empty: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={!props.onClick}
      onClick={props.onClick}
      className="flex min-w-0 flex-col items-start gap-0.5 rounded-xl border border-white/10 bg-zinc-900/40 p-3 text-left enabled:hover:border-white/25 enabled:hover:bg-zinc-900/70"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
        {props.icon}
        {props.title}
      </span>
      {props.empty ? <span className="text-sm text-zinc-600">Nothing yet</span> : <span className="flex min-w-0 max-w-full flex-col text-sm [&>b]:truncate [&>span]:truncate [&>span]:text-xs [&>span]:text-zinc-400">{props.children}</span>}
    </button>
  );
}

function CtlButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex h-8 items-center gap-1.5 rounded-md bg-white/10 px-3 text-sm font-medium text-zinc-100 hover:bg-white/15">
      {children}
    </button>
  );
}
