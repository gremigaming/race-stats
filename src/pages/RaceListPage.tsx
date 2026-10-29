import { Clapperboard } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { cardClass } from "../components/Card";
import { SectionHeader } from "../components/ui/SectionHeader";
import { loadRaceIndex, type RaceIndexEntry } from "../viewer/format";

/** Every race the Live Race Viewer can play: published by the live server, or built from recordings. */
export function RaceListPage() {
  const { formulaKey } = useParams<{ formulaKey: string }>();
  const [races, setRaces] = useState<RaceIndexEntry[] | null>(null);

  useEffect(() => {
    let alive = true;
    loadRaceIndex().then((r) => alive && setRaces(r));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className={cardClass}>
        <SectionHeader title="Race viewer" hint={races ? `${races.length} races, newest first` : undefined} />
        <p className="mb-3 text-sm text-zinc-400">
          Watch a whole race from above: every car, every lap, with throttle, brake and steering for the drivers you pick and
          every incident on the timeline.
        </p>
        {races === null ? (
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-700 border-t-red-500" />
        ) : races.length === 0 ? (
          <p className="text-sm text-zinc-500">No races yet.</p>
        ) : (
          <ul className="divide-y divide-white/5">
            {races.map((r) => (
              <li key={r.uid}>
                <Link
                  to={`/${formulaKey}/race/${encodeURIComponent(r.uid)}`}
                  className="flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-white/5"
                >
                  <Clapperboard className="h-4 w-4 shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-zinc-100">
                      {r.track} · {r.session}
                    </span>
                    <span className="block text-xs text-zinc-500">
                      {r.started.slice(0, 10)} {r.started.slice(11, 16)} · {r.laps} laps · {r.cars} cars
                    </span>
                  </span>
                  {r.incidents !== undefined && (
                    <span className="text-xs text-zinc-400">
                      {r.incidents} {r.incidents === 1 ? "incident" : "incidents"}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
