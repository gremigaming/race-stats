import { useEffect, useState } from "react";

/**
 * Steward scene on stream (GreMi, 11 Nov 2026): while GreMi has the incident viewer open on the
 * streaming PC, Streamer.bot switches OBS to the steward scene, and back when he leaves.
 *
 * Only in a browser that opted in: open the page once with ?steward=on (?steward=off undoes it).
 * Optional, remembered the same way: ?sbport=8080 (Streamer.bot WebSocket server port) and
 * ?sbpass=... when the server has authentication on. Visitors never connect to anything.
 *
 * The page sends DoAction "Steward On" while it is open and visible, "Steward Off" when it is
 * hidden, left or closed. Streamer.bot owns the scene logic (switch, remember the scene before).
 */
export const STEWARD_ON = "Steward On";
export const STEWARD_OFF = "Steward Off";
const KEY = "gremi.steward";

export type StewardStatus = "off" | "connecting" | "linked" | "unreachable";

type Opts = { port: string; pass: string };

function readOpts(): Opts | null {
  try {
    const q = new URLSearchParams(location.search);
    const flag = q.get("steward");
    if (flag === "off") localStorage.removeItem(KEY);
    else if (flag === "on" || q.get("sbport") || q.get("sbpass")) {
      const old = JSON.parse(localStorage.getItem(KEY) || "{}") as Partial<Opts>;
      localStorage.setItem(KEY, JSON.stringify({ port: q.get("sbport") || old.port || "8080", pass: q.get("sbpass") ?? old.pass ?? "" }));
    }
    const raw = localStorage.getItem(KEY);
    return raw ? { port: "8080", pass: "", ...(JSON.parse(raw) as Partial<Opts>) } : null;
  } catch {
    return null;
  }
}

async function sha256b64(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function useStewardSignal(): StewardStatus {
  const [status, setStatus] = useState<StewardStatus>("off");

  useEffect(() => {
    const opts = readOpts();
    if (!opts) return;
    let ws: WebSocket | null = null;
    let ready = false;
    let alive = true;
    let retry = 0;
    let want: string | null = null; // last action to send once the socket is ready
    let sent: string | null = null;

    const send = (name: string) => {
      want = name;
      if (!ws || !ready || sent === name) return;
      ws.send(JSON.stringify({ request: "DoAction", id: `steward-${Date.now()}`, action: { name }, args: { source: "race-stats incidents" } }));
      sent = name;
    };
    const markReady = () => {
      if (ready) return;
      ready = true;
      setStatus("linked");
      if (want) send(want);
    };

    const connect = () => {
      if (!alive || document.visibilityState !== "visible") return;
      setStatus((s) => (s === "linked" ? s : "connecting"));
      ready = false;
      sent = null;
      let sock: WebSocket;
      try {
        sock = new WebSocket(`ws://127.0.0.1:${opts.port}/`);
      } catch {
        setStatus("unreachable");
        return;
      }
      ws = sock;
      let helloWait = 0;
      sock.onopen = () => {
        // Streamer.bot greets with "Hello" (with a challenge when authentication is on); older
        // versions say nothing, so go ahead after a short wait.
        helloWait = window.setTimeout(markReady, 600);
      };
      sock.onmessage = async (e) => {
        let msg: { request?: string; id?: string; status?: string; authentication?: { salt: string; challenge: string } };
        try {
          msg = JSON.parse(String(e.data));
        } catch {
          return;
        }
        if (msg.request === "Hello") {
          clearTimeout(helloWait);
          if (msg.authentication && opts.pass) {
            const secret = await sha256b64(opts.pass + msg.authentication.salt);
            sock.send(JSON.stringify({ request: "Authenticate", id: "steward-auth", authentication: await sha256b64(secret + msg.authentication.challenge) }));
          } else markReady();
        } else if (msg.id === "steward-auth") {
          if (msg.status === "ok") markReady();
          else setStatus("unreachable");
        }
      };
      sock.onclose = () => {
        clearTimeout(helloWait);
        if (ws === sock) {
          ws = null;
          ready = false;
          if (alive) {
            setStatus("unreachable");
            clearTimeout(retry);
            retry = window.setTimeout(connect, 10000);
          }
        }
      };
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        send(STEWARD_ON);
        if (!ws) connect();
      } else send(STEWARD_OFF);
    };
    const onLeave = () => send(STEWARD_OFF);

    want = document.visibilityState === "visible" ? STEWARD_ON : null;
    connect();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onLeave);
    return () => {
      alive = false;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onLeave);
      send(STEWARD_OFF);
      const sock = ws;
      ws = null;
      // Give the "off" message a moment to leave before closing.
      if (sock) window.setTimeout(() => sock.close(), 300);
    };
  }, []);

  return status;
}
