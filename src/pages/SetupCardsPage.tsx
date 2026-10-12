import { useQuery } from "@tanstack/react-query";
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

function SetupPicture({ track, card }: { track: SetupTrack; card: SetupCardData }) {
  const title = `${track.post} · ${card.label} setup`;
  return (
    <section
      id={setupCardId(track.post, card.kind)}
      data-post={track.post}
      data-kind={card.kind}
      className={cn(cardClass, "relative w-[860px] overflow-hidden p-7")}
    >
      {card.placeholder || !card.setup ? (
        <>
          <div className="pointer-events-none select-none opacity-[0.18] grayscale" aria-hidden>
            <CarSetupCard setup={PLACEHOLDER_SETUP} title={title} hideCopy />
          </div>
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <span className="rounded-full border border-zinc-600/70 bg-zinc-900/80 px-4 py-1 font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">
              No setup yet
            </span>
            <span className="text-2xl font-semibold text-zinc-200">{track.post}</span>
            <span className="text-sm text-zinc-500">
              GreMi's setup shows up here after the next race on this track
            </span>
          </div>
        </>
      ) : (
        <>
          <CarSetupCard setup={card.setup} title={title} hideCopy />
          <div className="mt-5 flex justify-between text-xs text-zinc-500">
            <span>{savedOn(card)} · GreMi_Gaming</span>
            <span>gremigaming.github.io/race-stats</span>
          </div>
        </>
      )}
    </section>
  );
}

export function SetupCardsPage() {
  const { data } = useQuery({
    queryKey: ["league-setups"],
    queryFn: async () => {
      const res = await fetch(`${import.meta.env.BASE_URL}league/setups.json`);
      if (!res.ok) throw new Error(`setups.json: ${res.status}`);
      return (await res.json()) as { tracks: SetupTrack[] };
    },
  });
  return (
    <div id="setup-cards" className="flex flex-col items-start gap-6 p-8">
      {data?.tracks.flatMap((track) =>
        track.cards.map((card) => <SetupPicture key={`${track.post}-${card.kind}`} track={track} card={card} />),
      )}
    </div>
  );
}
