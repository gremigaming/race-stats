import { useQuery } from "@tanstack/react-query";
import { CloudRain, Sun, Timer } from "lucide-react";
import { cardClass } from "../components/Card";
import { CarSetupCard } from "../components/CarSetupCard";
import type { CarSetup } from "../types/telemetry";
import { cn } from "../utils/cn";

/**
 * GreMi's setups per track, drawn as the pictures Race Control posts in the
 * F1-SETUPS forum (scripts/discord-card.mjs). Not linked from the site.
 * Built from league/setups.json (scripts/build-league-data.mjs).
 */
interface SetupCardData {
  kind: "race" | "quali" | "wet" | "dry";
  label: string;
  setup?: CarSetup;
  file?: string;
  session?: string;
  placeholder?: boolean;
}

interface SetupTrack {
  post: string;
  cards: SetupCardData[];
}

// Middle of every slider, drawn faded behind "No setup yet"
const PLACEHOLDER_SETUP = {
  "front-wing": 25, "rear-wing": 25, "on-throttle": 50, "off-throttle": 50,
  "front-camber": -3.0, "rear-camber": -1.5, "front-toe": 0.25, "rear-toe": 0.3,
  "front-suspension": 21, "rear-suspension": 21, "front-anti-roll-bar": 11,
  "rear-anti-roll-bar": 11, "front-suspension-height": 25, "rear-suspension-height": 38,
  "brake-pressure": 90, "brake-bias": 60, "front-left-tyre-pressure": 26,
  "front-right-tyre-pressure": 26, "rear-left-tyre-pressure": 23.5,
  "rear-right-tyre-pressure": 23.5, "is-valid": true,
} as unknown as CarSetup;

export const setupCardId = (post: string, kind: string) =>
  `setup-${post.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${kind}`;

function savedOn(card: SetupCardData): string {
  const m = card.file?.match(/(\d{4})_(\d{2})_(\d{2})_\d{2}_\d{2}_\d{2}\.json$/);
  if (!m) return "";
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const session = /qualifying/i.test(card.session ?? "") ? "qualifying" : "race";
  return `Used in the ${session} on ${day}`;
}

// Each kind gets its own colour and icon, on the pictures and in Discord
const KIND_STYLE = {
  race: {
    tag: "Dry race", Icon: Sun, band: "bg-red-500", glow: "from-red-500/[0.14]",
    chip: "bg-red-500/15 text-red-300", icon: "text-red-400", bar: "bg-red-500/70",
  },
  dry: {
    tag: "Dry", Icon: Sun, band: "bg-red-500", glow: "from-red-500/[0.14]",
    chip: "bg-red-500/15 text-red-300", icon: "text-red-400", bar: "bg-red-500/70",
  },
  quali: {
    tag: "Dry quali", Icon: Timer, band: "bg-violet-500", glow: "from-violet-500/[0.16]",
    chip: "bg-violet-500/15 text-violet-300", icon: "text-violet-400", bar: "bg-violet-500/70",
  },
  wet: {
    tag: "Wet", Icon: CloudRain, band: "bg-sky-500", glow: "from-sky-500/[0.16]",
    chip: "bg-sky-500/15 text-sky-300", icon: "text-sky-400", bar: "bg-sky-500/70",
  },
} as const;

function SetupPicture({ track, card }: { track: SetupTrack; card: SetupCardData }) {
  const style = KIND_STYLE[card.kind] ?? KIND_STYLE.race;
  const empty = card.placeholder || !card.setup;
  const { Icon } = style;
  return (
    <section
      id={setupCardId(track.post, card.kind)}
      data-post={track.post}
      data-kind={card.kind}
      data-label={card.label}
      data-date={empty ? "" : savedOn(card)}
      data-placeholder={empty ? "1" : ""}
      className={cn(cardClass, "relative w-[860px] overflow-hidden p-7")}
    >
      {/* the kind's colour: a band on top and a soft glow from the corner */}
      <div className={cn("absolute inset-x-0 top-0 h-1", empty ? "bg-zinc-700" : style.band)} />
      <div
        className={cn(
          "pointer-events-none absolute inset-0 bg-gradient-to-br via-transparent to-transparent",
          empty ? "from-zinc-500/[0.06]" : style.glow,
        )}
      />
      <div className="relative">
        <div className="mb-6 flex items-center gap-4">
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-xl", empty ? "bg-zinc-800" : style.chip)}>
            <Icon className={cn("h-6 w-6", empty ? "text-zinc-600" : style.icon)} strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <div className="font-mono text-2xs uppercase tracking-[0.25em] text-zinc-500">
              {CIRCUITS[track.post] ?? track.post}
            </div>
            <div className="text-2xl font-semibold tracking-tight text-zinc-100">{track.post}</div>
          </div>
          <span
            className={cn(
              "rounded-full px-4 py-1.5 font-mono text-xs font-semibold uppercase tracking-[0.2em]",
              empty ? "bg-zinc-800 text-zinc-500" : style.chip,
            )}
          >
            {style.tag} setup
          </span>
        </div>
        {empty ? (
          <div className="relative">
            <div className="pointer-events-none select-none opacity-[0.14] grayscale" aria-hidden>
              <CarSetupCard setup={PLACEHOLDER_SETUP} title="" hideCopy />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-4 py-1 font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">
                No setup yet
              </span>
              <span className="text-sm text-zinc-500">
                {card.kind === "wet"
                  ? "GreMi's wet setup shows up here after the next wet race on this track"
                  : "GreMi's setup shows up here after the next race on this track"}
              </span>
            </div>
          </div>
        ) : (
          <>
            <CarSetupCard setup={card.setup!} title="" hideCopy bar={style.bar} />
            <div className="mt-6 flex justify-between border-t border-zinc-800 pt-4 text-xs text-zinc-500">
              <span>{savedOn(card)} · GreMi_Gaming</span>
              <span>gremigaming.github.io/race-stats</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// The circuit under each forum post's name, for the overview picture
const CIRCUITS: Record<string, string> = {
  Australia: "Albert Park", China: "Shanghai", Japan: "Suzuka", Bahrain: "Sakhir",
  "Saudi Arabia": "Jeddah", Miami: "Miami", "Emilia-Romagna": "Imola", Canada: "Montreal",
  Monaco: "Monte Carlo", Barcelona: "Catalunya", Austria: "Red Bull Ring",
  "Great Britain": "Silverstone", Belgium: "Spa-Francorchamps", Hungary: "Hungaroring",
  Netherlands: "Zandvoort", Monza: "Monza", Madrid: "Madring", Azerbaijan: "Baku",
  Singapore: "Marina Bay", Austin: "COTA", Mexico: "Mexico City", Brazil: "Interlagos",
  "Las Vegas": "Las Vegas", Qatar: "Lusail", "Abu Dhabi": "Yas Marina",
};

const fmt = (v: number, digits = 0) => (Number.isInteger(v) && !digits ? String(v) : v.toFixed(digits || 1));

const OVERVIEW_ROWS: { label: string; value: (s: CarSetup) => string }[] = [
  { label: "Wings", value: (s) => `${s["front-wing"]} / ${s["rear-wing"]}` },
  { label: "Diff", value: (s) => `${s["on-throttle"]} / ${s["off-throttle"]}` },
  { label: "Camber", value: (s) => `${fmt(s["front-camber"], 1)} / ${fmt(s["rear-camber"], 1)}` },
  { label: "Toe", value: (s) => `${fmt(s["front-toe"], 2)} / ${fmt(s["rear-toe"], 2)}` },
  { label: "Springs", value: (s) => `${s["front-suspension"]} / ${s["rear-suspension"]}` },
  { label: "Anti-roll", value: (s) => `${s["front-anti-roll-bar"]} / ${s["rear-anti-roll-bar"]}` },
  { label: "Height", value: (s) => `${s["front-suspension-height"]} / ${s["rear-suspension-height"]}` },
  { label: "Brakes", value: (s) => `${s["brake-pressure"]}% · ${s["brake-bias"]}%` },
  {
    label: "Tyres",
    value: (s) => `${fmt(s["front-left-tyre-pressure"], 1)} / ${fmt(s["rear-left-tyre-pressure"], 1)}`,
  },
];

const COLUMN_STYLE = {
  race: { title: "Dry race", Icon: Sun, text: "text-red-300", band: "bg-red-500" },
  quali: { title: "Dry quali", Icon: Timer, text: "text-violet-300", band: "bg-violet-500" },
  wet: { title: "Wet", Icon: CloudRain, text: "text-sky-300", band: "bg-sky-500" },
} as const;

function OverviewColumn({
  kind,
  setup,
  note,
}: {
  kind: keyof typeof COLUMN_STYLE;
  setup?: CarSetup;
  note?: string;
}) {
  const style = COLUMN_STYLE[kind];
  const { Icon } = style;
  return (
    <div className="relative flex flex-1 flex-col overflow-hidden rounded-xl bg-zinc-800/40 px-4 py-3.5">
      <div className={cn("absolute inset-x-0 top-0 h-[3px]", setup ? style.band : "bg-zinc-700")} />
      <div className="mb-3 flex items-center gap-2">
        <Icon className={cn("h-4 w-4", setup ? style.text : "text-zinc-600")} strokeWidth={2.4} />
        <span className={cn("font-mono text-2xs uppercase tracking-[0.18em]", setup ? style.text : "text-zinc-500")}>
          {style.title}
        </span>
      </div>
      <div className={cn("flex flex-1 flex-col justify-between", !setup && "opacity-[0.12] grayscale")} aria-hidden={!setup}>
        {OVERVIEW_ROWS.map((row) => (
          <div key={row.label} className="flex justify-between gap-2 text-sm">
            <span className="text-zinc-500">{row.label}</span>
            <span className="font-mono text-zinc-200">{row.value(setup ?? PLACEHOLDER_SETUP)}</span>
          </div>
        ))}
      </div>
      {!setup && (
        <div className="absolute inset-x-0 bottom-0 top-9 flex items-center justify-center px-3 text-center">
          <span className="rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 text-xs text-zinc-400">
            {note}
          </span>
        </div>
      )}
    </div>
  );
}

/** The forum post's thumbnail: all three setups side by side, compact. */
function SetupOverview({ track }: { track: SetupTrack }) {
  const real = track.cards.filter((c) => !c.placeholder && c.setup);
  const race = real.find((c) => c.kind === "race") ?? real.find((c) => c.kind === "quali");
  const quali = real.find((c) => c.kind === "quali" && c !== race);
  const wet = real.find((c) => c.kind === "wet");
  return (
    <section
      id={setupCardId(track.post, "overview")}
      data-post={track.post}
      data-kind="overview"
      data-circuit={CIRCUITS[track.post] ?? ""}
      className={cn(cardClass, "flex h-[450px] w-[680px] flex-col p-6")}
    >
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="font-mono text-2xs uppercase tracking-[0.25em] text-zinc-500">
            {CIRCUITS[track.post] ?? track.post}
          </div>
          <div className="text-3xl font-semibold tracking-tight text-zinc-100">{track.post}</div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          GreMi_Gaming's setups
          <div className="text-zinc-600">gremigaming.github.io/race-stats</div>
        </div>
      </div>
      <div className="flex flex-1 gap-3">
        <OverviewColumn kind="race" setup={race?.setup} note="No setup yet" />
        <OverviewColumn
          kind="quali"
          setup={quali?.setup}
          note={race ? "Same as dry race" : "No setup yet"}
        />
        <OverviewColumn kind="wet" setup={wet?.setup} note="No wet setup yet" />
      </div>
    </section>
  );
}

export function SetupCardsPage() {
  const { data } = useQuery({
    queryKey: ["league-setups"],
    queryFn: async () => {
      // ?src= draws another list, for test pictures (public/setup-test.json)
      const src = new URLSearchParams(location.search).get("src") ?? "league/setups.json";
      const res = await fetch(`${import.meta.env.BASE_URL}${src}`);
      if (!res.ok) throw new Error(`setups.json: ${res.status}`);
      return (await res.json()) as { tracks: SetupTrack[] };
    },
  });
  return (
    <div id="setup-cards" className="flex flex-col items-start gap-6 p-8">
      {data?.tracks.flatMap((track) => [
        <SetupOverview key={`${track.post}-overview`} track={track} />,
        ...track.cards.map((card) => <SetupPicture key={`${track.post}-${card.kind}`} track={track} card={card} />),
      ])}
    </div>
  );
}
