import {
  CircleCheck,
  FlaskConical,
  Gauge,
  Lock,
  LogIn,
  LogOut,
  SlidersHorizontal,
  Timer,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { cardClass } from "../components/Card";
import { TrackFlag } from "../components/TrackFlag";
import { CopyButton } from "../components/ui/CopyButton";
import { Eyebrow } from "../components/ui/Eyebrow";
import { InsightTile } from "../components/ui/InsightTile";
import { SectionHeader } from "../components/ui/SectionHeader";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import {
  forgetKey,
  loadSetupData,
  loginUrl,
  readKey,
  SetupDataMissing,
  takeLoginResult,
  type SetupAdvice,
  type SetupData,
  type SetupKind,
  type SetupSetting,
} from "../league/setupManager";
import { cn } from "../utils/cn";
import { getTrackDisplayName, sortTracksByCalendar } from "../utils/tracks";

const KIND_LABEL: Record<SetupKind, string> = { quali: "Qualifying", race: "Race", wet: "Wet" };
const KIND_TEXT: Record<SetupKind, string> = {
  quali: "text-violet-300",
  race: "text-red-300",
  wet: "text-sky-300",
};
const KINDS: SetupKind[] = ["quali", "race", "wet"];
const WEATHER = ["Clear", "Light cloud", "Overcast", "Light rain", "Heavy rain", "Storm"];

const LABEL: Record<string, string> = {
  front_wing: "Front Wing",
  rear_wing: "Rear Wing",
  diff_on_throttle: "On Throttle",
  diff_off_throttle: "Off Throttle",
  engine_braking: "Engine Braking",
  brake_pressure: "Pressure",
  brake_bias: "Bias",
  front_suspension: "Spring F",
  rear_suspension: "Spring R",
  front_arb: "ARB F",
  rear_arb: "ARB R",
  front_ride_height: "Height F",
  rear_ride_height: "Height R",
  front_camber: "Camber F",
  rear_camber: "Camber R",
  front_toe: "Toe F",
  rear_toe: "Toe R",
  fl_psi: "Front Left",
  fr_psi: "Front Right",
  rl_psi: "Rear Left",
  rr_psi: "Rear Right",
  ballast: "Ballast",
  fuel_load: "Fuel",
};

const RANGE: Record<string, [number, number]> = {
  front_wing: [0, 50],
  rear_wing: [0, 50],
  diff_on_throttle: [0, 100],
  diff_off_throttle: [0, 100],
  engine_braking: [0, 100],
  brake_pressure: [80, 100],
  brake_bias: [50, 70],
  front_suspension: [1, 41],
  rear_suspension: [1, 41],
  front_arb: [1, 21],
  rear_arb: [1, 21],
  front_ride_height: [1, 50],
  rear_ride_height: [1, 75],
  front_camber: [-3.5, -2.5],
  rear_camber: [-2, -1],
  front_toe: [0, 0.5],
  rear_toe: [0.1, 0.5],
  fl_psi: [22.5, 29.5],
  fr_psi: [22.5, 29.5],
  rl_psi: [20.5, 26.5],
  rr_psi: [20.5, 26.5],
  ballast: [0, 20],
  fuel_load: [0, 20],
};

/** Same columns as the Car Setup card on a race page. */
const COLUMNS: [string, string[]][][] = [
  [
    ["Aerodynamics", ["front_wing", "rear_wing"]],
    ["Transmission", ["diff_on_throttle", "diff_off_throttle", "engine_braking"]],
    ["Brakes", ["brake_pressure", "brake_bias"]],
  ],
  [
    ["Suspension", ["front_suspension", "rear_suspension", "front_arb", "rear_arb", "front_ride_height", "rear_ride_height"]],
    ["Geometry", ["front_camber", "rear_camber", "front_toe", "rear_toe"]],
  ],
  [
    ["Tyre Pressures (psi)", ["fl_psi", "fr_psi", "rl_psi", "rr_psi"]],
    ["Other", ["ballast", "fuel_load"]],
  ],
];

const PERCENT = new Set(["diff_on_throttle", "diff_off_throttle", "engine_braking", "brake_pressure", "brake_bias"]);

function formatValue(key: string, v: number): string {
  if (key.includes("psi")) return v.toFixed(1);
  if (key.includes("camber")) return `${v.toFixed(1)}°`;
  if (key.includes("toe")) return `${v.toFixed(2)}°`;
  if (PERCENT.has(key)) return `${v}%`;
  if (key === "fuel_load") return `${v.toFixed(1)} kg`;
  return String(v);
}

function pct(key: string, v: number): number {
  const [lo, hi] = RANGE[key] ?? [0, 100];
  return Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
}

function formatLap(ms: number | null): string {
  if (ms == null) return "—";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(3).padStart(6, "0")}`;
}

function formatDay(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  return Number.isNaN(d.getTime())
    ? date
    : d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

const changeCount = (a?: SetupAdvice) => (a ? a.settings.filter((s) => s.changed).length : 0);

type State =
  | { status: "locked"; denied?: boolean }
  | { status: "loading" }
  | { status: "missing" }
  | { status: "badkey" }
  | { status: "ready"; data: SetupData };

const TRACK_STORAGE = "setup-manager-view";

export function SetupManagerPage() {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    const result = takeLoginResult();
    const key = readKey();
    if (!key) {
      setState({ status: "locked", denied: result === "denied" });
      return;
    }
    loadSetupData(key)
      .then((data) => setState({ status: "ready", data }))
      .catch((e) => setState({ status: e instanceof SetupDataMissing ? "missing" : "badkey" }));
  }, []);

  const logOut = () => {
    forgetKey();
    setState({ status: "locked" });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="mb-1 flex items-center gap-2 text-xl font-bold">
            <Wrench className="h-5 w-5 text-red-400" />
            Setup manager
          </h2>
          <p className="text-sm text-zinc-500">
            Your setup per track, with a recommended value and the reason for every setting · from your own race telemetry
          </p>
        </div>
        {state.status === "ready" && (
          <button
            type="button"
            onClick={logOut}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900/70 hover:text-zinc-200"
          >
            <LogOut className="h-3.5 w-3.5" />
            Log out
          </button>
        )}
      </div>
      {state.status === "loading" && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-zinc-700 border-t-red-500" />
        </div>
      )}
      {state.status === "locked" && <LockedCard denied={state.denied} />}
      {state.status === "badkey" && <LockedCard expired />}
      {state.status === "missing" && (
        <section className={cn(cardClass, "text-sm text-zinc-400")}>
          The setup advice isn't built yet. It appears here after the next site update.
        </section>
      )}
      {state.status === "ready" && <SetupManager data={state.data} />}
    </div>
  );
}

function LockedCard({ denied, expired }: { denied?: boolean; expired?: boolean }) {
  return (
    <section className={cn(cardClass, "flex flex-col items-center gap-4 py-12 text-center")}>
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-800 text-zinc-400">
        <Lock className="h-5 w-5" />
      </span>
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-zinc-100">Only GreMi can open the Setup manager</h3>
        <p className="text-sm text-zinc-500">
          {denied
            ? "That Discord account doesn't have access."
            : expired
              ? "Your login has expired. Log in again to see your setups."
              : "Log in with Discord to see your setups."}
        </p>
      </div>
      <a
        href={loginUrl()}
        className="flex items-center gap-1.5 rounded-xl bg-red-700/95 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-red-950/40 transition-colors hover:bg-red-600"
      >
        <LogIn className="h-4 w-4" />
        Log in with Discord
      </a>
    </section>
  );
}

function SetupManager({ data }: { data: SetupData }) {
  const tracks = useMemo(() => {
    const order = sortTracksByCalendar(data.tracks.map((t) => t.track));
    return order.map((name) => data.tracks.find((t) => t.track === name)!);
  }, [data]);
  const [view, setView] = useState<{ track: string; kind: SetupKind }>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(TRACK_STORAGE) ?? "null");
      if (saved && tracks.some((t) => t.track === saved.track)) return saved;
    } catch {
      // nothing saved
    }
    return { track: tracks[0]?.track ?? "", kind: "race" };
  });
  const track = tracks.find((t) => t.track === view.track) ?? tracks[0];
  const kinds = KINDS.filter((k) => track?.kinds[k]);
  const kind = track?.kinds[view.kind] ? view.kind : (kinds.includes("race") ? "race" : kinds[0]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TRACK_STORAGE, JSON.stringify(view));
    } catch {
      // private window
    }
  }, [view]);

  if (!track || !kind) {
    return <section className={cn(cardClass, "text-sm text-zinc-400")}>No setups recorded yet.</section>;
  }
  const advice = track.kinds[kind]!;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Tracks" className={cn(cardClass, "h-fit min-w-0 p-2")}>
        <div className="px-2.5 pb-2 pt-1.5">
          <Eyebrow>Tracks</Eyebrow>
        </div>
        <div className="flex gap-0.5 overflow-x-auto lg:flex-col">
          {tracks.map((t) => {
            const active = t.track === track.track;
            return (
              <button
                key={t.track}
                type="button"
                onClick={() => setView({ track: t.track, kind })}
                aria-current={active}
                className={cn(
                  "flex shrink-0 flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors",
                  active ? "bg-red-500/10" : "hover:bg-zinc-900/70",
                )}
              >
                <span
                  className={cn(
                    "flex items-center gap-2 text-sm font-medium",
                    active ? "text-red-300" : "text-zinc-200",
                  )}
                >
                  <TrackFlag track={t.track} size="smaller" />
                  {getTrackDisplayName(t.track)}
                </span>
                <span className="flex gap-2.5 font-mono text-3xs font-semibold uppercase tracking-wider">
                  {KINDS.filter((k) => t.kinds[k]).map((k) => (
                    <span key={k} className={KIND_TEXT[k]}>
                      {k === "quali" ? "Quali" : KIND_LABEL[k]}
                      {changeCount(t.kinds[k]) > 0 && <span className="ml-1 text-zinc-400">{changeCount(t.kinds[k])}</span>}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-2xl font-bold text-zinc-100">
            <TrackFlag track={track.track} size="medium" />
            {getTrackDisplayName(track.track)}
          </h3>
          <SegmentedControl
            ariaLabel="Setup"
            options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k], meta: changeCount(track.kinds[k]) || undefined }))}
            value={kind}
            onChange={(k) => setView({ track: track.track, kind: k })}
          />
        </div>
        <AdviceView advice={advice} kind={kind} trackName={getTrackDisplayName(track.track)} />
      </div>
    </div>
  );
}

function AdviceView({ advice, kind, trackName }: { advice: SetupAdvice; kind: SetupKind; trackName: string }) {
  const changes = advice.settings.filter((s) => s.changed);
  const byKey = new Map(advice.settings.map((s) => [s.key, s]));
  const quali = advice.source === "quali";
  const hint = advice.derived
    ? "From your race advice"
    : [
        formatDay(advice.date),
        `${WEATHER[advice.weather ?? 0] ?? "Clear"}, track ${advice.trackTemp}°C`,
        quali ? "One-shot qualifying" : "Race · 5 laps",
      ].join(" · ");

  return (
    <>
      <div>
        <SectionHeader title="Key Insights" hint={hint} />
        {!advice.derived && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <InsightTile title={quali ? "Quali lap" : "Average lap"} icon={Timer} accent="purple">
              <p className="font-mono text-xl font-medium text-purple-300">
                {formatLap(quali ? advice.best : advice.mean)}
              </p>
              <p className="mt-1 font-mono text-xs text-zinc-400">
                {quali
                  ? advice.laps[0]?.[2] ? "valid lap" : "invalid lap"
                  : `best ${formatLap(advice.best)}`}
              </p>
            </InsightTile>
            <InsightTile title="Consistency" icon={Gauge} accent="cyan">
              <p className="font-mono text-xl font-medium text-cyan-300">
                {advice.spread != null && advice.clean.length > 1 ? `${(advice.spread / 1000).toFixed(2)} s` : "—"}
              </p>
              <p className="mt-1 font-mono text-xs text-zinc-400">
                spread over {advice.clean.length} {advice.clean.length === 1 ? "lap" : "laps"}
              </p>
            </InsightTile>
            <InsightTile title="Changes" icon={SlidersHorizontal} accent="orange">
              <p className="font-mono text-xl font-medium text-orange-300">{changes.length}</p>
              <p className="mt-1 font-mono text-xs text-zinc-400">of {advice.settings.length} settings</p>
            </InsightTile>
            <InsightTile title="Status" icon={advice.tested ? FlaskConical : CircleCheck} accent="emerald">
              <p className="font-mono text-xl font-medium text-emerald-300">{advice.tested ? "Tested" : "Advice"}</p>
              <p className="mt-1 font-mono text-xs text-zinc-400">
                {advice.tested ? "confirmed in practice" : `from your ${quali ? "qualifying" : "race"} data`}
              </p>
            </InsightTile>
          </div>
        )}
      </div>

      <section className={cardClass}>
        <SectionHeader size="sm" title="What the data shows" className="mb-4" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-4">
            {advice.findings.length > 0 ? (
              <ul className="space-y-2">
                {advice.findings.map((f) => (
                  <li key={f} className="flex gap-2 text-sm text-zinc-300">
                    <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-orange-400" />
                    {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">
                {advice.derived ? "Based on what your race showed." : "Nothing stood out."}
              </p>
            )}
            {advice.laps.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
                {advice.laps.map(([lap, ms, valid]) => (
                  <span
                    key={lap}
                    className={advice.clean.includes(lap) ? "text-zinc-300" : valid ? "text-zinc-600" : "text-behind"}
                  >
                    L{lap} {formatLap(ms)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {advice.tested && (
              <p className="rounded-xl bg-emerald-500/[0.08] px-3 py-2.5 text-xs text-emerald-200">{advice.tested}</p>
            )}
            {advice.notes.map((n) => (
              <p key={n} className="rounded-xl bg-zinc-800/40 px-3 py-2.5 text-xs text-zinc-400">
                {n}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className={cardClass}>
        <SectionHeader
          size="sm"
          title="Car Setup"
          hint="now → recommended"
          className="mb-4"
          action={
            changes.length > 0 ? (
              <CopyButton
                label={`Copy ${changes.length} changes`}
                className="-my-1.5"
                getText={() =>
                  `${trackName} ${KIND_LABEL[kind]}: ` +
                  changes
                    .map((s) => `${LABEL[s.key] ?? s.key} ${formatValue(s.key, s.now)} → ${formatValue(s.key, s.rec)}`)
                    .join(", ")
                }
              />
            ) : undefined
          }
        />
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 lg:grid-cols-3">
          {COLUMNS.map((col, i) => (
            <div key={i} className="space-y-5">
              {col.map(([title, keys]) => (
                <div key={title}>
                  <div className="mb-2">
                    <Eyebrow className="text-zinc-400">{title}</Eyebrow>
                  </div>
                  <div className="space-y-3">
                    {keys
                      .map((k) => byKey.get(k))
                      .filter((s): s is SetupSetting => !!s)
                      .map((s) => (
                        <AdviceRow key={s.key} setting={s} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-5 rounded-full bg-blue-500/50" />
            now
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[3px] rounded-full bg-orange-400" />
            recommended
          </span>
        </div>
      </section>
    </>
  );
}

function AdviceRow({ setting: s }: { setting: SetupSetting }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("w-20 shrink-0 truncate", s.changed ? "text-zinc-200" : "text-zinc-500")}>
          {LABEL[s.key] ?? s.key}
        </span>
        <div className="relative h-1.5 min-w-[48px] flex-1 rounded-full bg-zinc-800">
          <div className="h-full rounded-full bg-blue-500/50" style={{ width: `${pct(s.key, s.now)}%` }} />
          {s.changed && (
            <span
              className="absolute -top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full bg-orange-400"
              style={{ left: `${pct(s.key, s.rec)}%` }}
            />
          )}
        </div>
        <span className="w-24 shrink-0 whitespace-nowrap text-right font-mono tabular-nums text-zinc-300">
          {s.changed ? (
            <>
              {formatValue(s.key, s.now)} → <span className="font-semibold text-orange-300">{formatValue(s.key, s.rec)}</span>
            </>
          ) : (
            formatValue(s.key, s.now)
          )}
        </span>
      </div>
      <p className={cn("text-2xs leading-snug", s.changed ? "text-zinc-400" : "text-zinc-600")}>{s.why}</p>
    </div>
  );
}
