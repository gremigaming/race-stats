import type { LeagueIndex } from "./league";

const LIVE_BASE = "https://replays.gremigaming.com/league/";
const PAGES_BASE = `${import.meta.env.BASE_URL}league/`;

export interface LeagueSource {
  index: LeagueIndex;
  live: boolean;
}

function encodedPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

async function readIndex(base: string): Promise<LeagueIndex> {
  const response = await fetchWithTimeout(
    `${base}index.json?t=${Date.now()}`,
    { cache: "no-store" },
    5_000,
  );
  if (!response.ok) throw new Error("League index unavailable");
  const value = (await response.json()) as LeagueIndex;
  if (!Array.isArray(value.files)) throw new Error("Invalid league index");
  return value;
}

/** Read the live R2 index first; GitHub Pages remains the recovery source. */
export async function loadLeagueSource(): Promise<LeagueSource> {
  try {
    const index = await readIndex(LIVE_BASE);
    if (index.files.length || index.generation) return { index, live: true };
  } catch {
    // Use the last site build when the live publisher is unavailable.
  }
  return { index: await readIndex(PAGES_BASE), live: false };
}

function assetUrl(path: string, source: LeagueSource): string {
  const mapped = source.live ? source.index.assetPaths?.[path] : undefined;
  if (mapped) {
    return /^https?:\/\//i.test(mapped)
      ? mapped
      : `${LIVE_BASE}${encodedPath(mapped.replace(/^\//, ""))}`;
  }
  return `${PAGES_BASE}${encodedPath(path)}?t=${Date.now()}`;
}

/** Load a current league artifact, retrying Pages if the corresponding live object is missing. */
export async function loadLeagueJson<T>(
  path: string,
  source?: LeagueSource,
): Promise<T> {
  const selected = source ?? (await loadLeagueSource());
  const url = assetUrl(path, selected);
  try {
    const response = await fetchWithTimeout(
      url,
      {
        cache:
          selected.live && selected.index.assetPaths?.[path]
            ? "force-cache"
            : "no-store",
      },
      12_000,
    );
    if (!response.ok) throw new Error(`Failed to load ${path}`);
    return (await response.json()) as T;
  } catch (error) {
    if (!selected.live || !selected.index.assetPaths?.[path]) throw error;
    const fallback = await fetchWithTimeout(
      `${PAGES_BASE}${encodedPath(path)}?t=${Date.now()}`,
      { cache: "no-store" },
      12_000,
    );
    if (!fallback.ok) throw error;
    return (await fallback.json()) as T;
  }
}

export function leagueRevision(source: LeagueSource, file: string): string {
  return (
    source.index.revisions?.[`sessions/${file}`] ??
    source.index.revisions?.[file] ??
    ""
  );
}
