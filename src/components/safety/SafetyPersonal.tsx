import {
  ChevronDown,
  ChevronRight,
  Flag,
  Search,
  ShieldAlert,
  Sparkles,
  Swords,
  TriangleAlert,
  Trophy,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cardClass, cardHighlight } from "../Card";
import { SectionHeader } from "../ui/SectionHeader";
import { SegmentedControl } from "../ui/SegmentedControl";
import { useTelemetry } from "../../context/TelemetryContext";
import {
  rankOf,
  SAFETY_CATEGORIES,
  SR_RANKS,
  SR_START,
  signedHalf,
  type SafetyCategory,
  type SafetyData,
  type SafetyDriver,
  type SafetySession,
} from "../../league/safety";
import { cn } from "../../utils/cn";
import { toSlug } from "../../utils/parseFilename";
import { sessionPath } from "../../utils/routes";
import { RankTile } from "./RankTile";

const half = (n: number) => Math.floor(n * 2 + 0.5) / 2;

export const changeClass = (n: number) =>
  n > 0 ? "text-emerald-300" : n < 0 ? "text-red-300" : "text-zinc-500";

/** Pulls track, kind and time out of a race file name. */
export function parseSessionFile(file: string) {
  const m = file.match(/(\d{4})_(\d{2})_(\d{2})_(\d{2})_(\d{2})/);
  const base = file.replace(/_Just_in_case/, "").replace(/_\d{4}_\d{2}_\d{2}_.*$/, "");
  const quali = /Qualifying/.test(base);
  const track = base.replace(/^(One_Shot_)?Qualifying_|^Race_/, "").replace(/_/g, " ");
  return { quali, track, time: m ? `${m[4]}:${m[5]}` : "" };
}

const fmtDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

const CAT_COLOR: Record<SafetyCategory, string> = {
  contact: "#f87171",
  penalty: "#fb923c",
  retirement: "#a1a1aa",
  clean: "#4ade80",
  quali: "#38bdf8",
  overtakes: "#c084fc",
  close: "#2dd4bf",
  stream: "#facc15",
  staff: "#e4e4e7",
};

type ItemFilter = "all" | "lost" | "gained";

export function SafetyPersonal({
  driver,
  data,
  position,
  of,
}: {
  driver: SafetyDriver;
  data: SafetyData;
  position: number;
  of: number;
}) {
  return (
    <div className="space-y-6">
      <Hero driver={driver} position={position} of={of} />
      {driver.flags.length > 0 && (
        <div className="space-y-1 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
          {driver.flags.map((f) => (
            <p key={f} className="flex items-center gap-2">
              <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
              {f}
            </p>
          ))}
        </div>
      )}
      <Stats driver={driver} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <section className={cn(cardClass, "lg:col-span-3")}>
          <SectionHeader title="SR over time" hint="After every stream" />
          <SrChart driver={driver} />
        </section>
        <section className={cn(cardClass, "lg:col-span-2")}>
          <SectionHeader title="Where it comes from" hint="Counted points, by kind" />
          <Breakdown driver={driver} />
        </section>
      </div>
      <Sessions driver={driver} data={data} />
    </div>
  );
}

function Hero({ driver, position, of }: { driver: SafetyDriver; position: number; of: number }) {
  const rank = rankOf(driver.sr);
  const idx = SR_RANKS.indexOf(rank);
  const next = idx > 0 ? SR_RANKS[idx - 1] : null;
  const floor = Number.isFinite(rank.min) ? rank.min : 0;
  const progress = next ? Math.max(0, Math.min(1, (driver.sr - floor) / (next.min - floor))) : 1;
  return (
    <section
      className={cn("relative overflow-hidden rounded-2xl p-5 sm:p-6", cardHighlight)}
      style={{
        background: `linear-gradient(135deg, rgba(${rank.rgb},.16) 0%, rgba(24,24,27,.85) 45%, rgba(24,24,27,.6) 100%)`,
      }}
    >
      <div className="flex flex-wrap items-center gap-5">
        <RankTile rank={rank} size={64} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-xl font-bold text-zinc-100">{driver.name}</h3>
            {driver.provisional && (
              <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400">
                provisional until 3 races
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-zinc-400">
            <Trophy className="mr-1 inline h-3.5 w-3.5 -translate-y-px text-zinc-500" />#{position} of {of}{" "}
            · rank {rank.rank} · {driver.races} {driver.races === 1 ? "race" : "races"} counted
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-5xl font-bold leading-none tabular-nums text-zinc-100">
            {driver.sr.toFixed(1)}
          </div>
          <div className={cn("mt-1 text-sm", changeClass(driver.change))}>
            {signedHalf(driver.change)} last stream
          </div>
        </div>
      </div>
      <div className="mt-5">
        <div className="mb-1.5 flex justify-between text-[11px] text-zinc-500">
          <span>Rank {rank.rank}</span>
          <span>
            {next
              ? `${half(next.min - driver.sr).toFixed(1)} to rank ${next.rank}`
              : "Top rank, keep it clean to stay here"}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full"
            style={{
              width: `${progress * 100}%`,
              background: `linear-gradient(90deg, rgba(${rank.rgb},.5), ${(next ?? rank).color})`,
            }}
          />
        </div>
      </div>
    </section>
  );
}

function Stats({ driver }: { driver: SafetyDriver }) {
  let gained = 0;
  let lost = 0;
  let incidents = 0;
  let clean = 0;
  for (const s of driver.sessions) {
    for (const it of s.items) {
      if (it.pts > 0) gained += it.pts * s.weight;
      else lost -= it.pts * s.weight;
      if (it.pts < 0 && (it.cat === "contact" || it.cat === "penalty")) incidents++;
    }
    if (s.race && s.items.some((it) => it.cat === "clean")) clean++;
  }
  const tiles = [
    { label: "Gained", value: `+${half(gained).toFixed(1)}`, tone: "text-emerald-300", icon: Sparkles },
    { label: "Lost", value: `−${half(lost).toFixed(1)}`, tone: "text-red-300", icon: ShieldAlert },
    {
      label: "Clean races",
      value: `${clean}/${driver.races}`,
      tone: "text-zinc-100",
      icon: Flag,
    },
    { label: "Incidents", value: String(incidents), tone: "text-zinc-100", icon: Swords },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className={cn("rounded-2xl bg-zinc-900/70 px-4 py-3", cardHighlight)}>
          <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-zinc-500">
            <t.icon className="h-3 w-3" />
            {t.label}
          </div>
          <div className={cn("mt-1 font-mono text-2xl font-bold tabular-nums", t.tone)}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}

/** SR after each stream, over rank-coloured bands with rank letters on the side. */
function SrChart({ driver }: { driver: SafetyDriver }) {
  const pts = [{ sr: SR_START, date: "" }, ...driver.history];
  const W = 640;
  const H = 200;
  const L = 28;
  const B = 20;
  const lo = Math.max(0, Math.min(...pts.map((p) => p.sr)) - 10);
  const hi = Math.min(100, Math.max(...pts.map((p) => p.sr)) + 10);
  const y = (v: number) => 6 + (H - B - 6) * (1 - (v - lo) / (hi - lo));
  const x = (i: number) => L + 8 + (i / Math.max(1, pts.length - 1)) * (W - L - 16);
  const bands = SR_RANKS.map((r, i) => ({
    r,
    top: Math.min(hi, i === 0 ? 100 : SR_RANKS[i - 1].min),
    bottom: Math.max(lo, Number.isFinite(r.min) ? r.min : lo),
  })).filter((b) => b.top > b.bottom);
  const labelEvery = Math.max(1, Math.ceil(pts.length / 6));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {bands.map((b) => (
        <g key={b.r.rank}>
          <rect
            x={L}
            width={W - L}
            y={y(b.top)}
            height={y(b.bottom) - y(b.top)}
            fill={`rgba(${b.r.rgb},.07)`}
          />
          <line x1={L} x2={W} y1={y(b.bottom)} y2={y(b.bottom)} stroke="rgba(255,255,255,.05)" />
          <text
            x={L - 6}
            y={(y(b.top) + y(b.bottom)) / 2 + 4}
            textAnchor="end"
            fontSize={11}
            fontWeight={700}
            fill={b.r.color}
          >
            {b.r.rank}
          </text>
        </g>
      ))}
      <polyline
        points={pts.map((p, i) => `${x(i)},${y(p.sr)}`).join(" ")}
        fill="none"
        stroke="#e4e4e7"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.sr)} r={i === pts.length - 1 ? 4.5 : 3} fill={rankOf(p.sr).color}>
            <title>{`${p.date ? fmtDate(p.date) : "Start"}: ${p.sr.toFixed(1)}`}</title>
          </circle>
          {(i % labelEvery === 0 || i === pts.length - 1) && (
            <text x={x(i)} y={H - 4} textAnchor="middle" fontSize={10} fill="#71717a">
              {p.date ? p.date.slice(5).replace("-", "/") : "start"}
            </text>
          )}
        </g>
      ))}
      <text
        x={x(pts.length - 1) - 8}
        y={y(pts[pts.length - 1].sr) - 9}
        textAnchor="end"
        fontSize={12}
        fontWeight={700}
        fill="#f4f4f5"
      >
        {pts[pts.length - 1].sr.toFixed(1)}
      </text>
    </svg>
  );
}

function Breakdown({ driver }: { driver: SafetyDriver }) {
  const sums = new Map<SafetyCategory, number>();
  for (const s of driver.sessions)
    for (const it of s.items) sums.set(it.cat, (sums.get(it.cat) ?? 0) + it.pts * s.weight);
  const rows = SAFETY_CATEGORIES.map((c) => ({ ...c, v: half(sums.get(c.cat) ?? 0) })).filter(
    (r) => r.v !== 0,
  );
  if (driver.aging) rows.push({ cat: "stream", label: "Top rule (older streams)", v: -driver.aging });
  rows.sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  if (rows.length === 0) return <p className="text-sm text-zinc-500">No points yet.</p>;
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2 text-xs">
          <span className="truncate text-zinc-400">{r.label}</span>
          <div className="relative h-2.5">
            <div className="absolute inset-y-0 left-1/2 w-px bg-zinc-700" />
            <div
              className="absolute inset-y-0 rounded-sm"
              style={{
                left: r.v >= 0 ? "50%" : `${50 - (Math.abs(r.v) / max) * 50}%`,
                width: `${(Math.abs(r.v) / max) * 50}%`,
                background: r.label.startsWith("Top rule") ? "#71717a" : CAT_COLOR[r.cat],
                opacity: 0.8,
              }}
            />
          </div>
          <span className={cn("text-right font-mono", changeClass(r.v))}>{signedHalf(r.v)}</span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-zinc-500">
        Older races count for less, so these are what's left of each kind today.
      </p>
    </div>
  );
}

function Sessions({ driver, data }: { driver: SafetyDriver; data: SafetyData }) {
  const [filter, setFilter] = useState<ItemFilter>("all");
  const [query, setQuery] = useState("");
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byStream = new Map<number, SafetySession[]>();
    for (const s of driver.sessions) {
      if (q && !parseSessionFile(s.file).track.toLowerCase().includes(q)) continue;
      const items = s.items.filter((it) =>
        filter === "all" ? true : filter === "lost" ? it.pts < 0 : it.pts > 0,
      );
      if (filter !== "all" && items.length === 0) continue;
      const list = byStream.get(s.stream) ?? [];
      list.push({ ...s, items });
      byStream.set(s.stream, list);
    }
    return [...byStream.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([stream, sessions]) => ({ stream, sessions: sessions.reverse() }));
  }, [driver, filter, query]);

  const histIdx = new Map(driver.history.map((h, i) => [h.stream, i]));
  return (
    <section className={cardClass}>
      <SectionHeader title="Races" hint={`${driver.sessions.length} sessions, newest first`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={setFilter}
          ariaLabel="Show points"
          options={[
            { value: "all", label: "All" },
            { value: "lost", label: "Lost points" },
            { value: "gained", label: "Gained points" },
          ]}
        />
        <label className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a track"
            className="h-8 w-full rounded-lg bg-zinc-900/60 pl-8 pr-2 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-zinc-600"
          />
        </label>
      </div>
      {groups.length === 0 && <p className="text-sm text-zinc-500">Nothing matches.</p>}
      <div className="space-y-3">
        {groups.map((g, gi) => {
          const hi = histIdx.get(g.stream);
          const h = hi != null ? driver.history[hi] : undefined;
          const before = hi != null && hi > 0 ? driver.history[hi - 1].sr : SR_START;
          return (
            <StreamGroup
              key={g.stream}
              date={data.streams[g.stream]?.date ?? ""}
              sr={h?.sr}
              change={h ? h.sr - before : undefined}
              sessions={g.sessions}
              defaultOpen={gi === 0 || query.trim() !== ""}
            />
          );
        })}
      </div>
    </section>
  );
}

function StreamGroup({
  date,
  sr,
  change,
  sessions,
  defaultOpen,
}: {
  date: string;
  sr?: number;
  change?: number;
  sessions: SafetySession[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const weight = sessions[0]?.weight ?? 1;
  return (
    <div className="overflow-hidden rounded-xl bg-zinc-950/50">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-white/[0.02]"
      >
        <ChevronRight
          className={cn("h-4 w-4 shrink-0 text-zinc-500 transition-transform", open && "rotate-90")}
        />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-zinc-200">
            {date ? `Stream of ${fmtDate(date)}` : "Stream"}
          </div>
          <div className="text-[11px] text-zinc-500">
            {sessions.length} {sessions.length === 1 ? "session" : "sessions"}
            {weight < 1 && ` · counts ${Math.round(weight * 100)}%`}
          </div>
        </div>
        {sr != null && (
          <div className="flex items-center gap-2">
            <span className={cn("font-mono text-sm", changeClass(change ?? 0))}>
              {signedHalf(half(change ?? 0))}
            </span>
            <RankTile sr={sr} size={24} />
            <span className="w-10 text-right font-mono text-sm font-semibold text-zinc-200">
              {sr.toFixed(1)}
            </span>
          </div>
        )}
      </button>
      {open && (
        <div className="space-y-1 px-2 pb-2">
          {sessions.map((s) => (
            <SessionRow key={s.file} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session }: { session: SafetySession }) {
  const { scopeKey } = useTelemetry();
  const [open, setOpen] = useState(false);
  const { quali, track, time } = parseSessionFile(session.file);
  const lost = session.items.filter((i) => i.pts < 0).length;
  return (
    <div className="rounded-lg bg-zinc-900/60">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm"
      >
        <span
          className={cn(
            "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
            quali ? "bg-sky-500/15 text-sky-300" : "bg-red-500/15 text-red-300",
          )}
        >
          {quali ? "Q" : "R"}
        </span>
        <span className="min-w-0 truncate text-zinc-200">{track}</span>
        <span className="font-mono text-[11px] text-zinc-600">{time}</span>
        <span className="ml-auto flex items-center gap-1">
          {session.items.slice(0, 8).map((it, i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: CAT_COLOR[it.cat], opacity: it.pts === 0 ? 0.3 : 0.9 }}
            />
          ))}
        </span>
        {lost > 0 && (
          <span className="hidden text-[11px] text-red-300/80 sm:inline">
            {lost} {lost === 1 ? "incident" : "incidents"}
          </span>
        )}
        <span className={cn("w-12 text-right font-mono", changeClass(session.total))}>
          {signedHalf(session.total)}
        </span>
        <ChevronDown
          className={cn("h-3.5 w-3.5 shrink-0 text-zinc-600 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-white/[0.04] px-3 py-2.5 text-xs">
          {session.items.length === 0 && <p className="text-zinc-500">No points in this session.</p>}
          {session.items.map((it, i) => (
            <p key={i} className="flex items-start gap-2.5">
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: CAT_COLOR[it.cat] }}
              />
              <span className={cn("w-10 shrink-0 text-right font-mono", changeClass(it.pts))}>
                {signedHalf(it.pts)}
              </span>
              <span className="text-zinc-400">
                {it.lap != null && <span className="text-zinc-300">Lap {it.lap} · </span>}
                {it.text}
                {it.staff != null && (
                  <span className="mt-0.5 block text-sky-300/90">
                    {it.orig != null ? `Changed by staff (was ${signedHalf(it.orig)})` : "Added by staff"}
                    {it.staff ? `: ${it.staff}` : ""}
                  </span>
                )}
              </span>
            </p>
          ))}
          <div className="flex items-center justify-between pt-1">
            <Link
              to={sessionPath(scopeKey ?? "all", toSlug(session.file))}
              className="text-red-300 hover:text-red-200"
            >
              Open this session
            </Link>
            {session.weight < 1 && (
              <span className="text-zinc-500">counts {Math.round(session.weight * 100)}% now</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
