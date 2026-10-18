import { STAFF_URL } from "./safety";

/**
 * Setup manager: GreMi's setup advice per track, built from his own telemetry
 * by scripts/telemetry/setup_manager.py and published encrypted as
 * league/setups.enc (scripts/encrypt-setups.mjs). The key comes from the staff
 * server after a Discord login that only GreMi passes; it is kept in this
 * browser so the page opens straight away next time.
 */

export const SETUP_MANAGER_ON = import.meta.env.VITE_SETUP_MANAGER === "true";

export type SetupKind = "quali" | "race" | "wet";

export interface SetupSetting {
  key: string;
  now: number;
  rec: number;
  changed: boolean;
  why: string;
}

export interface SetupAdvice {
  source: "race" | "quali";
  /** yyyy-mm-dd of the session the advice comes from */
  date: string;
  weather: number | null;
  trackTemp: number | null;
  /** [lap, time ms, valid] */
  laps: [number, number, boolean][];
  /** laps that count (lap 1, slow laps and invalid laps left out) */
  clean: number[];
  best: number | null;
  mean: number | null;
  spread: number | null;
  findings: string[];
  notes: string[];
  settings: SetupSetting[];
  /** set when this is the race advice reused for qualifying */
  derived?: boolean;
  /** set when the changes were confirmed on track */
  tested?: string;
}

export interface SetupTrack {
  track: string;
  kinds: Partial<Record<SetupKind, SetupAdvice>>;
}

export interface SetupData {
  generated: string | null;
  tracks: SetupTrack[];
}

const KEY_STORAGE = "setup-manager-key";

export function readKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    // private window: nothing was kept
  }
}

/** Picks up what the staff server sends back after the login (in the URL
 *  hash, so it never reaches a server log) and clears it from the address. */
export function takeLoginResult(): "ok" | "denied" | null {
  const hash = window.location.hash;
  let result: "ok" | "denied" | null = null;
  const m = hash.match(/setup-key=([^&]+)/);
  if (m) {
    try {
      localStorage.setItem(KEY_STORAGE, decodeURIComponent(m[1]));
    } catch {
      // still usable for this visit through the return value below
    }
    result = "ok";
  } else if (hash.includes("setup-denied")) {
    result = "denied";
  }
  if (result) {
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }
  return result;
}

export function loginUrl(): string {
  const back = window.location.origin + window.location.pathname;
  return `${STAFF_URL}/setup-login?back=${encodeURIComponent(back)}`;
}

const fromB64 = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export class SetupDataMissing extends Error {}

/** Fetches and decrypts the advice. Throws SetupDataMissing when the site was
 *  built without it, and any other error when the key doesn't fit. */
export async function loadSetupData(key: string): Promise<SetupData> {
  const res = await fetch(`${import.meta.env.BASE_URL}league/setups.enc`, { cache: "no-store" });
  if (!res.ok) throw new SetupDataMissing("no setup data");
  const box = (await res.json()) as { iv: string; data: string };
  const cryptoKey = await crypto.subtle.importKey("raw", fromB64(key), "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(box.iv) }, cryptoKey, fromB64(box.data));
  return JSON.parse(new TextDecoder().decode(plain)) as SetupData;
}
