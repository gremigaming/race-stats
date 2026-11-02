import { ChevronDown, Flag, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTelemetry } from "../../context/TelemetryContext";
import { driverKey } from "../../league/league";
import { signedHalf, STAFF_URL, type SafetyData, type SafetyItem } from "../../league/safety";
import { cn } from "../../utils/cn";
import { IncidentReplay, replayStats, type CarStats, type ReplayData } from "./IncidentReplay";

/**
 * The incidents of one driver in one race: every collision they were part of (also the ones
 * that cost nobody points), both sides with the verdict, the points and the overhead replay.
 * Shown on the driver's safety rating page (per race) and in their race history on the
 * dashboard. Replaces the old standalone Incidents tab (removed 2 Nov 2026).
 */

/** One side of a contact: a driver and what the safety rating made of it. */
interface Side {
  name: string;
  item?: SafetyItem;
}

export interface RaceIncident {
  key: string;
  file: string;
  lap: number | null;
  where: string;
  sides: Side[];
  replay?: string;
  /** Game severity: LOW, MEDIUM or HIGH. */
  sev?: string;
}

/** league/incidents.json (scripts/safety_rating.py): every collision, also the ones that cost nobody points. */
interface AllIncidents {
  incidents: {
    file: string;
    lap: number | null;
    where: string;
    sev: string;
    names: [string, string];
    lines: Record<string, [number, string]>;
    replay?: string;
  }[];
}

let allPromise: Promise<AllIncidents | null> | null = null;

/** league/incidents.json, fetched once per page load and shared by every list. */
function useAllIncidents(): AllIncidents | null {
  const [all, setAll] = useState<AllIncidents | null>(null);
  useEffect(() => {
    allPromise ??= fetch(`${import.meta.env.BASE_URL}league/incidents.json?t=${Date.now()}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AllIncidents>) : null))
      .catch(() => null);
    let live = true;
    allPromise.then((d) => live && setAll(d));
    return () => {
      live = false;
    };
  }, []);
  return all;
}

const base = (file: string) => file.split("/").pop() ?? file;

/** Track name from a race file name (as SafetyPersonal.parseSessionFile), for the replay's map. */
const trackOf = (file: string) =>
  base(file)
    .replace(/_Just_in_case/, "")
    .replace(/_\d{4}_\d{2}_\d{2}_.*$/, "")
    .replace(/^(One_Shot_)?Qualifying_|^Race_/, "")
    .replace(/_/g, " ");

const SEV: Record<string, { label: string; cls: string }> = {
  LOW: { label: "Light", cls: "bg-zinc-500/15 text-zinc-300" },
  MEDIUM: { label: "Medium", cls: "bg-amber-500/15 text-amber-300" },
  HIGH: { label: "Heavy", cls: "bg-red-500/15 text-red-300" },
};

/** "Turn 3, with Bob: heavy contact, to blame (...) 4; ..." -> where, other driver, reasons. */
function splitText(text: string) {
  const m = text.match(/^(.*?), with (.*?): (.*)$/);
  return m ? { where: m[1], vs: m[2], why: m[3] } : { where: "", vs: "", why: text };
}

function verdict(item?: SafetyItem): { label: string; cls: string } {
  const t = item?.text.toLowerCase() ?? "";
  if (!item || t.includes("not to blame")) return { label: "Not to blame", cls: "bg-emerald-500/15 text-emerald-300" };
  if (t.includes("shared blame")) return { label: "Shared blame", cls: "bg-amber-500/15 text-amber-300" };
  if (t.includes("to blame")) return { label: "To blame", cls: "bg-red-500/15 text-red-300" };
  return { label: "Points lost", cls: "bg-zinc-500/15 text-zinc-300" };
}

const COLORS = ["#ff8a1f", "#4fb6ff"];

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Every collision in these race files that involves this driver (by driverKey), in race order. */
export function raceIncidents(
  data: SafetyData | null,
  all: AllIncidents | null,
  files: string[],
  key: string,
): RaceIncident[] {
  const want = new Set(files.map(base));
  const byKey = new Map<string, RaceIncident>();
  for (const d of data?.drivers ?? []) {
    for (const s of d.sessions) {
      if (!want.has(base(s.file))) continue;
      for (const it of s.items) {
        if (it.cat !== "contact") continue;
        const { where, vs } = splitText(it.text);
        const k = it.replay ?? `${s.file}|${it.lap}|${[d.name, vs].sort().join("|")}|${where}`;
        let inc = byKey.get(k);
        if (!inc) {
          inc = { key: k, file: s.file, lap: it.lap, where, sides: [], replay: it.replay };
          byKey.set(k, inc);
        }
        const me = inc.sides.find((x) => x.name === d.name);
        if (me) me.item = it;
        else inc.sides.push({ name: d.name, item: it });
        if (vs && !inc.sides.some((x) => x.name === vs)) inc.sides.push({ name: vs });
      }
    }
  }
  // every other collision (no points for anyone, or AI and hidden-name cars)
  for (const c of all?.incidents ?? []) {
    if (!want.has(base(c.file))) continue;
    const k = c.replay ?? `${c.file}|${c.lap}|${[...c.names].sort().join("|")}|${c.where}`;
    const known = byKey.get(k);
    if (known) {
      known.sev = c.sev;
      continue;
    }
    byKey.set(k, {
      key: k,
      file: c.file,
      lap: c.lap,
      where: c.where,
      sev: c.sev,
      replay: c.replay,
      sides: c.names.map((name, i) => {
        const line = c.lines[name];
        return {
          name,
          item: line && {
            pts: line[0],
            text: `${c.where}, with ${c.names[1 - i]}: ${line[1]}`,
            lap: c.lap,
            cat: "contact" as const,
          },
        };
      }),
    });
  }
  return [...byKey.values()]
    .filter((i) => i.sides.some((s) => driverKey(s.name) === key))
    .sort((a, b) => a.file.localeCompare(b.file) || (a.lap ?? 0) - (b.lap ?? 0));
}

/** The incidents of one driver in a race (or a few saves of it); the hook keeps the data shared. */
export function useRaceIncidents(files: string[], key: string): RaceIncident[] | null {
  const { league } = useTelemetry();
  const data = league?.safetyData ?? null;
  const all = useAllIncidents();
  const filesKey = files.join("|");
  return useMemo(
    () => (data || all ? raceIncidents(data, all, filesKey.split("|"), key) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, all, filesKey, key],
  );
}

/** The list itself, the driver's own side first in every incident. */
export function RaceIncidentList({
  incidents,
  driver,
}: {
  incidents: RaceIncident[] | null;
  /** driverKey of the driver whose race this is. */
  driver: string;
}) {
  if (!incidents) return <p className="text-xs text-zinc-500">Loading incidents…</p>;
  if (incidents.length === 0) return <p className="text-xs text-zinc-500">No incidents in this race.</p>;
  return (
    <div className="space-y-1.5">
      {incidents.map((inc) => (
        <IncidentCard
          key={inc.key}
          inc={{ ...inc, sides: [...inc.sides].sort((a, b) => +(driverKey(b.name) === driver) - +(driverKey(a.name) === driver)) }}
          driver={driver}
        />
      ))}
    </div>
  );
}

function IncidentCard({ inc, driver }: { inc: RaceIncident; driver: string }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<{ d: ReplayData; s: CarStats[] } | null>(null);
  // the replay's own order decides the colours: first car orange, second blue
  const colorOf = (name: string) => {
    if (!stats) return undefined;
    const i = stats.s.findIndex((c) => stats.d.names[String(c.car)] === name);
    return i >= 0 ? COLORS[i] : undefined;
  };
  const statOf = (name: string) => stats?.s.find((c) => stats.d.names[String(c.car)] === name);
  const mine = inc.sides.find((s) => driverKey(s.name) === driver)?.item?.pts ?? 0;
  const others = inc.sides.filter((s) => driverKey(s.name) !== driver).map((s) => s.name);

  return (
    <div className="rounded-lg bg-black/25">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs"
      >
        <span className="w-12 shrink-0 font-mono text-zinc-500">{inc.lap != null ? `Lap ${inc.lap}` : ""}</span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-zinc-200">with {others.join(", ") || "another car"}</span>
          {inc.where && <span className="text-zinc-500"> · {cap(inc.where)}</span>}
        </span>
        {inc.sev && SEV[inc.sev] && (
          <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", SEV[inc.sev].cls)}>
            {SEV[inc.sev].label}
          </span>
        )}
        {inc.replay && <Play className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Has a replay" />}
        <span className={cn("w-10 text-right font-mono", mine < 0 ? "text-red-300" : "text-zinc-500")}>{signedHalf(mine)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-white/[0.04] px-3 py-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-2">
            {inc.sides.map((s) => {
              const v = verdict(s.item);
              const st = statOf(s.name);
              const why = s.item ? splitText(s.item.text).why : "No points lost";
              const col = colorOf(s.name);
              return (
                <div key={s.name} className="rounded-lg bg-black/25 p-2.5">
                  <div className="mb-1.5 flex items-center gap-2">
                    {col && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: col }} />}
                    <span className="min-w-0 truncate font-semibold text-zinc-100">{s.name}</span>
                    <span className={cn("ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold", v.cls)}>
                      {v.label}
                    </span>
                    <span className="w-9 shrink-0 text-right font-mono text-zinc-300">
                      {signedHalf(s.item?.pts ?? 0)}
                    </span>
                  </div>
                  <p className="text-zinc-400">{cap(why)}</p>
                  {s.item?.staff != null && (
                    <p className="mt-1 text-sky-300/90">
                      {s.item.orig != null ? `Changed by staff (was ${signedHalf(s.item.orig)})` : "Added by staff"}
                      {s.item.staff ? `: ${s.item.staff}` : ""}
                    </p>
                  )}
                  {st && <StatLine st={st} />}
                  {s.item && s.item.pts < 0 && s.item.id && s.item.staff == null && (
                    <a
                      href={`${STAFF_URL}/protest?item=${encodeURIComponent(s.item.id)}`}
                      target="_blank"
                      rel="noopener"
                      className="mt-1.5 inline-flex items-center gap-1 text-zinc-500 hover:text-red-300"
                    >
                      <Flag className="h-3 w-3" /> Protest
                    </a>
                  )}
                </div>
              );
            })}
          </div>
          {inc.replay ? (
            <IncidentReplay id={inc.replay} track={trackOf(inc.file)} onData={(d) => setStats({ d, s: replayStats(d) })} />
          ) : (
            <p className="text-zinc-500">No replay for this contact (the race was recorded before every car's position was kept).</p>
          )}
        </div>
      )}
    </div>
  );
}

function StatLine({ st }: { st: CarStats }) {
  const parts: string[] = [];
  if (st.speed != null) {
    let p = `${Math.round(st.speed)} km/h at contact`;
    if (st.speedBefore != null) {
      const dv = st.speed - st.speedBefore;
      p += Math.abs(dv) < 3 ? " (steady)" : dv < 0 ? ` (braked ${Math.round(-dv)} km/h in the last second)` : ` (+${Math.round(dv)} km/h in the last second)`;
    }
    parts.push(p);
  }
  if (st.ahead != null)
    parts.push(Math.abs(st.ahead) < 1 ? "side by side" : st.ahead > 0 ? `${st.ahead.toFixed(1)} m ahead` : `${(-st.ahead).toFixed(1)} m behind`);
  if (st.moved != null && Math.abs(st.moved) >= 0.5)
    parts.push(`moved ${Math.abs(st.moved).toFixed(1)} m to the ${st.moved > 0 ? "left" : "right"} in the last second`);
  return parts.length ? <p className="mt-1.5 font-mono text-[11px] text-zinc-300">{parts.join(" · ")}</p> : null;
}
