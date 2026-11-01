/** Decodes map tiles (WebP / PNG blobs) off the main thread into ImageBitmaps (see tiles.ts). */
const ctx = self as unknown as Worker;

ctx.onmessage = async (e: MessageEvent<{ id: number; blob: Blob; size: number }>) => {
  const { id, blob, size } = e.data;
  try {
    const bmp = await createImageBitmap(
      blob,
      size ? { resizeWidth: size, resizeHeight: size, resizeQuality: "high", premultiplyAlpha: "premultiply" } : { premultiplyAlpha: "premultiply" },
    );
    ctx.postMessage({ id, bmp }, [bmp]);
  } catch (err) {
    ctx.postMessage({ id, error: String(err) });
  }
};
