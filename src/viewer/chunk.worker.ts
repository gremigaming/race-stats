/** Fetches and decodes race chunks off the main thread (see format.ts). */
import { decodeChunk, type Chunk } from "./format";

const ctx = self as unknown as Worker;

async function load(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status}`);
  let buf = await r.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  // R2 serves chunks with Content-Encoding gzip (the browser unpacks them); this site serves the raw .gz bytes
  if (head[0] === 0x1f && head[1] === 0x8b) {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    buf = await new Response(stream).arrayBuffer();
  }
  return buf;
}

ctx.onmessage = async (e: MessageEvent<{ id: number; url: string }>) => {
  const { id, url } = e.data;
  try {
    const chunk: Chunk = decodeChunk(await load(url));
    ctx.postMessage({ id, chunk }, [chunk.t.buffer as ArrayBuffer]);
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
