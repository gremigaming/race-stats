import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useLocation, useNavigationType } from "react-router-dom";
import { readStoredString, writeStoredString } from "../utils/storage";

/*
 * Remember how a page looked (open cards, filters, scroll spot) for one visit in the browser
 * history. A new visit starts fresh; pressing Back (or the browser back button) to that visit
 * brings the same cards back open and the page back to the same spot. Kept in sessionStorage,
 * keyed by the history entry, so it never leaks between tabs or visits.
 */
const PREFIX = "page-memory:";

function load(key: string): Record<string, unknown> {
  try {
    return JSON.parse(readStoredString(PREFIX + key, "session") ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

function save(key: string, id: string, value: unknown) {
  const all = load(key);
  all[id] = value;
  writeStoredString(PREFIX + key, JSON.stringify(all), "session");
}

/** useState that survives leaving the page and coming back with Back. */
export function useRememberedState<T>(id: string, initial: T | (() => T)) {
  const { key } = useLocation();
  const [value, setValue] = useState<T>(() => {
    const all = load(key);
    if (id in all) return all[id] as T;
    return typeof initial === "function" ? (initial as () => T)() : initial;
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        save(key, id, v);
        return v;
      }),
    [key, id],
  );
  return [value, set] as const;
}

/** Was this value restored from an earlier visit (so a "reset on mount" effect should leave it)? */
export function useWasRemembered(id: string) {
  const { key } = useLocation();
  return useRef(id in load(key)).current;
}

/**
 * Keep the scroll spot of a scrolling box per history entry, and put it back when the user
 * returns with Back. Pages load their data after they mount, so it keeps trying until the
 * page is tall enough (or the user scrolls themselves).
 */
export function useScrollMemory(ref: RefObject<HTMLElement | null>) {
  const location = useLocation();
  const navType = useNavigationType();
  const key = location.key;
  const storeKey = PREFIX + "scroll:" + key;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // a fresh visit (or a filter swap that replaced the entry) starts from where the page is now
    if (navType !== "POP") writeStoredString(storeKey, String(Math.round(el.scrollTop)), "session");
    let t = 0;
    const onScroll = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => writeStoredString(storeKey, String(Math.round(el.scrollTop)), "session"), 80);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(t);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, storeKey, navType]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || navType !== "POP") return;
    const saved = Number(readStoredString(storeKey, "session") ?? "");
    if (!Number.isFinite(saved) || saved <= 0) return;
    let stop = false;
    let frame = 0;
    const started = performance.now();
    const giveUp = () => {
      stop = true;
    };
    const tryRestore = () => {
      if (stop) return;
      if (el.scrollHeight - el.clientHeight >= saved - 2) {
        el.scrollTop = saved;
        return;
      }
      if (performance.now() - started < 5000) frame = requestAnimationFrame(tryRestore);
    };
    tryRestore();
    el.addEventListener("wheel", giveUp, { passive: true, once: true });
    el.addEventListener("touchstart", giveUp, { passive: true, once: true });
    return () => {
      stop = true;
      cancelAnimationFrame(frame);
      el.removeEventListener("wheel", giveUp);
      el.removeEventListener("touchstart", giveUp);
    };
  }, [ref, storeKey, navType]);
}
