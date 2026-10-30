import { Check, Link2, Share2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { clock, IconButton } from "./panels";

/**
 * Share links: the race page URL plus
 *   t=<s>     a moment, seconds from the start of the recording (as on the player bar)
 *   inc=<s>   an incident, by its first contact (s from the start), so it survives live regrouping
 *   car=<n,n> the drivers being followed
 */
export interface Shared {
  t: number | null;
  inc: number | null;
  cars: number[];
}

export function readShared(search: string): Shared {
  const q = new URLSearchParams(search);
  const num = (k: string) => {
    const v = q.get(k);
    const n = v === null || v === "" ? NaN : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const cars = (q.get("car") ?? "")
    .split(",")
    .filter((c) => c !== "")
    .map(Number)
    .filter((c) => Number.isInteger(c) && c >= 0);
  return { t: num("t"), inc: num("inc"), cars };
}

export function shareUrl(s: Partial<Shared>) {
  const q = new URLSearchParams();
  if (s.inc != null) q.set("inc", s.inc.toFixed(1));
  else if (s.t != null) q.set("t", s.t.toFixed(1));
  if (s.cars?.length) q.set("car", s.cars.join(","));
  const qs = q.toString().replace(/%2C/g, ",");
  return `${window.location.origin}${window.location.pathname}${qs ? `?${qs}` : ""}`;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    window.prompt("Copy this link", text);
    return false;
  }
}

/** The share button: copies a link to the whole race, this moment or the open incident, with the followed drivers. */
export function ShareMenu(props: { t: number; incident: number | null; cars: number[]; names: (car: number) => string }) {
  const [open, setOpen] = useState(false);
  const [withCars, setWithCars] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const cars = withCars ? props.cars : [];
  const pick = async (key: string, link: Partial<Shared>) => {
    await copy(shareUrl({ ...link, cars }));
    setDone(key);
    window.setTimeout(() => setDone((d) => (d === key ? null : d)), 2000);
  };
  const row = (key: string, label: string, link: Partial<Shared>) => (
    <button
      key={key}
      type="button"
      onClick={() => void pick(key, link)}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-white/10"
    >
      {done === key ? <Check className="h-4 w-4 text-emerald-400" /> : <Link2 className="h-4 w-4 text-zinc-500" />}
      <span className="flex-1">{done === key ? "Link copied" : label}</span>
    </button>
  );

  return (
    <div ref={box} className="relative">
      <IconButton label="Share a link" active={open} onClick={() => setOpen((o) => !o)}>
        <Share2 className="h-4 w-4" />
      </IconButton>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-60 rounded-lg border border-white/10 bg-[#0c0e11]/95 p-1 shadow-xl backdrop-blur">
          {row("race", "Full race", {})}
          {row("moment", `This moment (${clock(props.t)})`, { t: props.t })}
          {props.incident !== null && row("incident", "This incident", { inc: props.incident })}
          {props.cars.length > 0 && (
            <label className="mt-1 flex cursor-pointer items-center gap-2 border-t border-white/10 px-2 pb-1 pt-2 text-xs text-zinc-400">
              <input type="checkbox" checked={withCars} onChange={(e) => setWithCars(e.target.checked)} className="accent-red-500" />
              <span className="truncate">Follow {props.cars.map(props.names).join(", ")}</span>
            </label>
          )}
        </div>
      )}
    </div>
  );
}
