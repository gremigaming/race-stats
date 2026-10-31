/**
 * True live viewing: the live race server (gremigaming/race-control-stats live/server.py,
 * https://live.gremigaming.com) pushes every new frame over a WebSocket about 5 times a second,
 * so the viewer plays LIVE_DELAY behind the game. When the socket can't connect it polls
 * (/s/<uid>/tail every second). Finished 10 s chunks come over HTTPS like any race.
 *
 * About 10 s after the flag the server has bundled the race (incidents, verdicts) on R2; the
 * viewer then swaps in those incidents without reloading.
 */
import { useEffect, useRef, useState } from "react";
import { decodeChunk, LIVE_SERVER, loadManifest, type RaceManifest } from "./format";
import type { ChunkStore } from "./store";

const LIVE_WS = "wss://live.gremigaming.com/watch";
/** How far behind the newest frame the live clock plays (s): smooth, and still ~1-2 s behind the game. */
export const LIVE_DELAY = 1.2;
/** Closer than this to the live edge (s) at normal speed: the clock follows the edge. */
const EDGE_ZONE = 5;

export interface LiveSession {
  uid: string;
  started: string;
  track: string;
  session: string;
  laps: number;
  cars: number;
}

type Msg = { type: "sessions"; sessions: LiveSession[] } | { type: "manifest"; manifest: RaceManifest };

/**
 * One socket to the live server. Reconnects with a growing pause; after 3 failed tries in a row
 * it reports `polling` so the caller falls back to HTTP (some networks block WebSockets).
 */
class Socket {
  private ws: WebSocket | null = null;
  private tries = 0;
  private timer = 0;
  private closed = false;
  polling = false;
  private onText: (m: Msg) => void;
  private onBinary: (buf: ArrayBuffer) => void;
  private onOpen: (ws: WebSocket) => void;
  private onPolling: () => void;

  constructor(
    onText: (m: Msg) => void,
    onBinary: (buf: ArrayBuffer) => void,
    onOpen: (ws: WebSocket) => void,
    onPolling: () => void,
  ) {
    this.onText = onText;
    this.onBinary = onBinary;
    this.onOpen = onOpen;
    this.onPolling = onPolling;
    this.open();
  }

  private open() {
    if (this.closed) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(LIVE_WS);
    } catch {
      this.retry();
      return;
    }
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      this.tries = 0;
      this.polling = false;
      this.onOpen(ws);
    };
    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        try {
          this.onText(JSON.parse(e.data) as Msg);
        } catch {
          // not ours
        }
      } else this.onBinary(e.data as ArrayBuffer);
    };
    ws.onclose = () => {
      if (this.ws === ws) this.retry();
    };
    this.ws = ws;
  }

  private retry() {
    this.ws = null;
    if (this.closed) return;
    this.tries++;
    if (this.tries >= 3 && !this.polling) {
      this.polling = true;
      this.onPolling();
    }
    this.timer = window.setTimeout(() => this.open(), Math.min(30000, 1000 * 2 ** this.tries));
  }

  close() {
    this.closed = true;
    window.clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
  }
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ who is live (site tab, picker)

const listeners = new Set<(s: LiveSession[]) => void>();
let current: LiveSession[] = [];
let listSocket: Socket | null = null;
let listPoll = 0;
let listClose = 0;

function publishList(s: LiveSession[]) {
  if (JSON.stringify(s) === JSON.stringify(current)) return;
  current = s;
  for (const l of listeners) l(s);
}

async function pollList() {
  const r = await getJson<{ sessions: LiveSession[] }>(`${LIVE_SERVER}/live.json`);
  if (r) publishList(r.sessions);
}

function startList() {
  window.clearTimeout(listClose);
  if (listSocket) return;
  listSocket = new Socket(
    (m) => m.type === "sessions" && publishList(m.sessions),
    () => {},
    () => {
      window.clearInterval(listPoll);
      listPoll = 0;
    },
    () => {
      if (!listPoll) listPoll = window.setInterval(pollList, 5000);
      void pollList();
    },
  );
}

function stopList() {
  // a short grace period, so moving between pages keeps the one socket
  listClose = window.setTimeout(() => {
    listSocket?.close();
    listSocket = null;
    window.clearInterval(listPoll);
    listPoll = 0;
  }, 3000);
}

/** The sessions streaming right now (empty when none): drives the Live tab and badges. */
export function useLiveSessions(): LiveSession[] {
  const [s, setS] = useState(current);
  useEffect(() => {
    listeners.add(setS);
    startList();
    setS(current);
    return () => {
      listeners.delete(setS);
      if (!listeners.size) stopList();
    };
  }, []);
  return s;
}

// ------------------------------------------------------------------ one live race in the viewer

/** The clock the viewer's frame loop owns (RaceViewerPage play ref). */
interface Clock {
  t: number;
  playing: boolean;
  rate: number;
}

export interface LiveFeed {
  /** Move the clock for one frame. True when it did (a live race), false: the normal clock runs. */
  advance(p: Clock, dtMs: number): boolean;
  /** Jump to the live edge (the LIVE button). */
  goLive(p: Clock): void;
  /** Whether the clock is at the live edge now. */
  atEdge(p: Clock): boolean;
}

/**
 * For a race that hasn't finished: frames pushed into the store as they come, manifest updates,
 * the clock held LIVE_DELAY behind the newest frame, and the bundled incidents once it's over.
 * Returns null for finished races.
 */
export function useLiveFeed(
  initial: RaceManifest,
  store: ChunkStore,
  setManifest: (m: RaceManifest) => void,
  onFirstFrames: (t: number) => void,
) {
  const feed = useRef<LiveFeed | null>(null);
  const first = useRef(onFirstFrames);
  first.current = onFirstFrames;

  useEffect(() => {
    if (initial.finished) return;
    let alive = true;
    let started = false;
    let poll = 0;
    let finishedAt = 0;
    const uid = initial.uid;

    const take = (m: RaceManifest) => {
      store.addNames(m.chunks);
      if (m.ghosts) store.ghosts = m.ghosts;
      if (m.track_length) store.lapLength = m.track_length;
      setManifest(m);
      if (m.finished && !finishedAt) {
        finishedAt = Date.now();
        void bundled();
      }
    };
    const frames = (buf: ArrayBuffer) => {
      if (!buf.byteLength) return;
      try {
        store.appendLive(decodeChunk(buf));
      } catch {
        return;
      }
      if (!started && store.newest !== null) {
        started = true;
        first.current(Math.max(store.span()[0], store.newest - LIVE_DELAY));
      }
    };
    // the race is over: the server bundles it (incidents, verdicts) and puts it on R2 within seconds
    const bundled = async () => {
      for (let i = 0; i < 12 && alive; i++) {
        await new Promise((r) => window.setTimeout(r, 5000));
        const r = await loadManifest(uid);
        if (r?.manifest.incidents && r.manifest.finished && !r.base.startsWith(LIVE_SERVER)) {
          if (!alive) return;
          store.setBase(r.base); // the live server forgets the session ~10 min after the flag
          take(r.manifest);
          return;
        }
      }
    };
    const pollTail = async () => {
      const after = store.newest ?? -1e9;
      try {
        const r = await fetch(`${LIVE_SERVER}/s/${uid}/tail?after=${after}`, { cache: "no-store" });
        if (r.ok && alive) frames(await r.arrayBuffer());
      } catch {
        // offline for a moment
      }
    };
    let ticks = 0;
    const socket = new Socket(
      (m) => m.type === "manifest" && m.manifest.uid === uid && take(m.manifest),
      frames,
      (ws) => {
        window.clearInterval(poll);
        poll = 0;
        ws.send(JSON.stringify({ watch: uid }));
      },
      () => {
        if (poll) return;
        poll = window.setInterval(async () => {
          await pollTail();
          if (++ticks % 3 === 0) {
            const m = await getJson<RaceManifest>(`${LIVE_SERVER}/s/${uid}/manifest.json`);
            if (m && alive) take(m);
          }
        }, 1000);
      },
    );

    const newestOr = (t: number) => store.newest ?? t;
    feed.current = {
      atEdge: (p) => store.newest !== null && p.rate === 1 && p.t > store.newest - LIVE_DELAY - EDGE_ZONE,
      goLive: (p) => {
        if (store.newest === null) return;
        p.t = store.newest - LIVE_DELAY;
        p.rate = 1;
        p.playing = true;
      },
      advance: (p, dtMs) => {
        if (store.newest === null || finishedAt) return false;
        if (!p.playing) return true;
        const newest = newestOr(p.t);
        const target = newest - LIVE_DELAY;
        const dt = dtMs / 1000;
        if (p.rate === 1 && p.t > target - EDGE_ZONE) {
          // at the live edge: ease the rate a little (never more than ±25%) so the clock sits
          // LIVE_DELAY behind without ever stopping or jumping
          const ease = Math.max(-0.25, Math.min(0.25, (target - p.t) * 0.3));
          p.t += dt * (1 + ease);
        } else p.t += dt * p.rate;
        p.t = Math.min(p.t, newest - 0.1);
        return true;
      },
    };

    return () => {
      alive = false;
      socket.close();
      window.clearInterval(poll);
      feed.current = null;
    };
  }, [initial, store, setManifest]);

  return feed;
}
