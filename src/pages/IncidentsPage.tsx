import { ChevronDown, Flag, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { cardClass } from "../components/Card";
import {
  IncidentReplay,
  replayStats,
  type CarStats,
  type ReplayData,
} from "../components/safety/IncidentReplay";
import { parseSessionFile } from "../components/safety/SafetyPersonal";
import { SectionHeader } from "../components/ui/SectionHeader";
import { useTelemetry } from "../context/TelemetryContext";
import { raceDate } from "../league/league";
import { signedHalf, STAFF_URL, type SafetyItem } from "../league/safety";
import { cn } from "../utils/cn";

/** One side of a contact: a driver and what the safety rating made of it. */
interface Side {
  name: string;
  item?: SafetyItem;
}

interface Incident {
  key: string;
  file: string;
  track: string;
  quali: boolean;
  time: string;
  date: Date | null;
  lap: number | null;
  where: string;
  sides: Side[];
  replay?: string;
}

/** "Turn 3, with Bob: heavy contact, to blame (...) 4; ..." -> where, other driver, reasons. */
function splitText(text: string) {
  const m = text.match(/^(.*?), with (.*?): (.*)$/);
  return m ? { where: m[1], vs: m[2], why: m[3] } : { where: "", vs: "", why: text };
}

function verdict(item?: SafetyItem): { label: string; cls: string } {
  const t = item?.text.toLowerCase() ?? "";
  if (!item || item.pts === 0 || t.includes("not to blame")) return { label: "Not to blame", cls: "bg-emerald-500/15 text-emerald-300" };
  if (t.includes("shared blame")) return { label: "Shared blame", cls: "bg-amber-500/15 text-amber-300" };
  if (t.includes("to blame")) return { label: "To blame", cls: "bg-red-500/15 text-red-300" };
  return { label: "Points lost", cls: "bg-zinc-500/15 text-zinc-300" };
}

const COLORS = ["#ff8a1f", "#4fb6ff"];

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "";

export function IncidentsPage() {
  const { league } = useTelemetry();
  const data = league?.safetyData ?? null;
  const [track, setTrack] = useState<string>("all");

  const incidents = useMemo(() => {
    const byKey = new Map<string, Incident>();
    for (const d of data?.drivers ?? []) {
      for (const s of d.sessions) {
        for (const it of s.items) {
          if (it.cat !== "contact") continue;
          const { where, vs } = splitText(it.text);
          const key = it.replay ?? `${s.file}|${it.lap}|${[d.name, vs].sort().join("|")}|${where}`;
          let inc = byKey.get(key);
          if (!inc) {
            const { quali, track, time } = parseSessionFile(s.file);
            inc = {
              key,
              file: s.file,
              track,
              quali,
              time,
              date: raceDate(s.file),
              lap: it.lap,
              where,
              sides: [],
              replay: it.replay,
            };
            byKey.set(key, inc);
          }
          const me = inc.sides.find((x) => x.name === d.name);
          if (me) me.item = it;
          else inc.sides.push({ name: d.name, item: it });
          if (vs && !inc.sides.some((x) => x.name === vs)) inc.sides.push({ name: vs });
        }
      }
    }
    return [...byKey.values()].sort(
      (a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0) || b.file.localeCompare(a.file) || (b.lap ?? 0) - (a.lap ?? 0),
    );
  }, [data]);

  const tracks = useMemo(() => {
    const n = new Map<string, number>();
    for (const i of incidents) n.set(i.track, (n.get(i.track) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [incidents]);

  const shown = track === "all" ? incidents : incidents.filter((i) => i.track === track);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className={cardClass}>
        <SectionHeader
          title="Incidents"
          hint={`${incidents.length} contacts that cost safety rating points, newest first`}
        />
        <p className="mb-3 text-sm text-zinc-400">
          Every contact the safety rating counted, with both drivers, the verdict and why. Open one to watch
          it from above with every car's real position, and see speeds, who was ahead and who moved across.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {[["all", incidents.length] as const, ...tracks].map(([t, n]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTrack(t)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs",
                track === t ? "bg-red-500/20 text-red-200" : "bg-zinc-800/80 text-zinc-400 hover:text-zinc-200",
              )}
            >
              {t === "all" ? "All tracks" : t} <span className="text-zinc-500">{n}</span>
            </button>
          ))}
        </div>
      </section>

      {!data && <p className="text-sm text-zinc-500">Loading incidents…</p>}
      {data && shown.length === 0 && <p className="text-sm text-zinc-500">No incidents here.</p>}
      <div className="space-y-2">
        {shown.map((inc) => (
          <IncidentCard key={inc.key} inc={inc} />
        ))}
      </div>
    </div>
  );
}

function IncidentCard({ inc }: { inc: Incident }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<{ d: ReplayData; s: CarStats[] } | null>(null);
  // the replay's own order decides the colours: first car orange, second blue
  const colorOf = (name: string) => {
    if (!stats) return undefined;
    const i = stats.s.findIndex((c) => stats.d.names[String(c.car)] === name);
    return i >= 0 ? COLORS[i] : undefined;
  };
  const statOf = (name: string) => stats?.s.find((c) => stats.d.names[String(c.car)] === name);
  const lost = inc.sides.reduce((s, x) => s + Math.min(0, x.item?.pts ?? 0), 0);

  return (
    <div className="rounded-xl bg-zinc-900/70">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm"
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
            inc.quali ? "bg-sky-500/15 text-sky-300" : "bg-red-500/15 text-red-300",
          )}
        >
          {inc.quali ? "Q" : "R"}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-zinc-200">
            {inc.sides.map((s) => s.name).join(" vs ")}
          </span>
          <span className="block truncate text-[11px] text-zinc-500">
            {inc.track} · {fmtDate(inc.date)} {inc.time}
            {inc.lap != null && ` · lap ${inc.lap}`}
            {inc.where && ` · ${cap(inc.where)}`}
          </span>
        </span>
        {inc.replay && <Play className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-label="Has a replay" />}
        <span className="w-10 text-right font-mono text-red-300">{signedHalf(lost)}</span>
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
            <IncidentReplay id={inc.replay} onData={(d) => setStats({ d, s: replayStats(d) })} />
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
