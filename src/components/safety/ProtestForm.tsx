import { useState, type FormEvent } from "react";
import { STAFF_URL, type SafetyItem } from "../../league/safety";

const NAME_KEY = "gremi-protest-name";
const CLIP_MAX_MB = 100;

const KINDS = [
  "Contact",
  "Divebomb or late lunge",
  "Pushed off track",
  "Unsafe rejoin",
  "Blocking or moving under braking",
  "Track limits or corner cutting",
  "Lag or netcode",
  "Game penalty was wrong",
  "Other",
];

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/** The other driver in a contact, from "..., with NAME: ...". */
function otherDriver(text: string): string | null {
  const m = text.match(/\bwith (.+?):/);
  return m ? m[1] : null;
}

function uploadClip(id: string, token: string, file: File, onProgress: (p: number) => void) {
  return new Promise<{ ok: boolean; message?: string }>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${STAFF_URL}/api/protest-clip?id=${id}&token=${token}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve({ ok: false });
      }
    };
    xhr.onerror = () => resolve({ ok: false });
    xhr.send(file);
  });
}

/**
 * A driver who doesn't agree with an incident tells the stewards what happened.
 * It goes to the staff page (Protests), where a moderator answers it.
 */
export function ProtestForm({ item, onClose }: { item: SafetyItem; onClose: () => void }) {
  const other = otherDriver(item.text);
  const [fault, setFault] = useState("");
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(savedName);
  const [progress, setProgress] = useState<number | null>(null);
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({});

  if (state.ok) {
    return (
      <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-300">
        {state.message} A steward will look at it.
      </p>
    );
  }

  function pick(f: File | null) {
    if (f && f.size > CLIP_MAX_MB * 1024 * 1024) {
      setState({ message: `That clip is over ${CLIP_MAX_MB} MB. Trim it, or put a link in the description.` });
      return;
    }
    setState({});
    setFile(f);
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // private window: fine
    }
    let data: { ok: boolean; message: string; id?: string; token?: string };
    try {
      const res = await fetch(`${STAFF_URL}/api/protest`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ item: item.id, fault, kind, text, name }),
      });
      data = await res.json();
    } catch {
      setState({ message: "Couldn't reach the stewards. Try again later, or tell a mod on Discord." });
      return;
    }
    if (!data.ok || !file || !data.id || !data.token) {
      setState({ ok: data.ok, message: data.message });
      return;
    }
    setProgress(0);
    const up = await uploadClip(data.id, data.token, file, setProgress);
    setProgress(null);
    setState({
      ok: true,
      message: up.ok
        ? "Sent to the stewards, with your clip."
        : `Sent to the stewards, but the clip didn't upload${up.message ? ` (${up.message})` : ""}. Share it with a mod on Discord.`,
    });
  }

  const input =
    "w-full rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-zinc-200 placeholder:text-zinc-600";
  const label = "mb-1 block text-zinc-400";
  return (
    <form onSubmit={send} className="space-y-2.5 rounded-md bg-zinc-950/60 p-3">
      <p className="text-zinc-300">Don't agree? Tell the stewards what happened.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className={label}>Who was at fault?</span>
          <select required value={fault} onChange={(e) => setFault(e.target.value)} className={input}>
            <option value="" disabled>
              Choose
            </option>
            <option value="Me">Me</option>
            {other && <option value={other}>{other}</option>}
            <option value="No one, racing incident">No one, racing incident</option>
            <option value="Someone else">Someone else</option>
          </select>
        </label>
        <label>
          <span className={label}>What kind of incident?</span>
          <select required value={kind} onChange={(e) => setKind(e.target.value)} className={input}>
            <option value="" disabled>
              Choose
            </option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className={label}>What happened?</span>
        <textarea
          required
          minLength={10}
          maxLength={1500}
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What happened from your side, and why you don't agree"
          className={input}
        />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label>
          <span className={label}>Your Discord name</span>
          <input
            required
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={input}
          />
        </label>
        <label>
          <span className={label}>Video clip (optional, up to {CLIP_MAX_MB} MB)</span>
          <input
            type="file"
            accept="video/mp4,video/webm,video/quicktime,video/x-matroska"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
            className="w-full text-zinc-400 file:mr-2 file:rounded-md file:border-0 file:bg-zinc-800 file:px-2.5 file:py-1.5 file:text-zinc-200"
          />
        </label>
      </div>
      {state.message && <p className="text-red-300">{state.message}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.busy}
          className="rounded-md bg-red-500/80 px-3 py-1.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {progress != null ? `Uploading clip ${Math.round(progress * 100)}%` : state.busy ? "Sending…" : "Send protest"}
        </button>
        <button type="button" onClick={onClose} disabled={state.busy} className="text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </form>
  );
}
