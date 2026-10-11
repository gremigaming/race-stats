import { useState, type FormEvent } from "react";
import { STAFF_URL } from "../../league/safety";

const NAME_KEY = "gremi-protest-name";

function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * A driver who doesn't agree with a penalty tells the stewards what happened.
 * It goes to the staff page (Protests), where a moderator answers it.
 */
export function ProtestForm({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const [text, setText] = useState("");
  const [clip, setClip] = useState("");
  const [name, setName] = useState(savedName);
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; message?: string }>({});

  if (state.ok) {
    return <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-emerald-300">{state.message} A steward will look at it.</p>;
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      // private window: fine
    }
    try {
      const res = await fetch(`${STAFF_URL}/api/protest`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({ item: itemId, text, clip, name }),
      });
      const data = (await res.json()) as { ok: boolean; message: string };
      setState({ ok: data.ok, message: data.message });
    } catch {
      setState({ message: "Couldn't reach the stewards. Try again later, or tell a mod on Discord." });
    }
  }

  const input = "w-full rounded-md border border-white/10 bg-zinc-950 px-2.5 py-1.5 text-zinc-200 placeholder:text-zinc-600";
  return (
    <form onSubmit={send} className="space-y-2 rounded-md bg-zinc-950/60 p-3">
      <p className="text-zinc-300">Don't agree? Tell the stewards what happened.</p>
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
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          required
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Your Discord name"
          className={input}
        />
        <input
          type="url"
          maxLength={300}
          value={clip}
          onChange={(e) => setClip(e.target.value)}
          placeholder="Video clip link (optional)"
          className={input}
        />
      </div>
      {state.message && <p className="text-red-300">{state.message}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={state.busy}
          className="rounded-md bg-red-500/80 px-3 py-1.5 font-medium text-white hover:bg-red-500 disabled:opacity-50"
        >
          {state.busy ? "Sending…" : "Send protest"}
        </button>
        <button type="button" onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
          Cancel
        </button>
      </div>
    </form>
  );
}
