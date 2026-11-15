// Privacy masking: blur faces, name badges, screens and plates before any photo is stored or shown.
// The original photo is never saved. Re-encoding also strips EXIF data (including GPS).
import sharp from "sharp";

// boxes: [[ymin, xmin, ymax, xmax], ...] normalized 0-1000 (Gemini's box format)
export async function maskPII(buffer, boxes = []) {
  const base = await sharp(buffer).rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true }).jpeg().toBuffer();
  const { width: W, height: H } = await sharp(base).metadata();
  const composites = [];
  for (const b of boxes) {
    if (!Array.isArray(b) || b.length !== 4) continue;
    let [y0, x0, y1, x1] = b.map(Number);
    if (![y0, x0, y1, x1].every(Number.isFinite)) continue;
    // Pad each box by 20% so hair, ears and badge edges are covered too.
    const padY = (y1 - y0) * 0.2, padX = (x1 - x0) * 0.2;
    const left = Math.max(0, Math.floor(((x0 - padX) / 1000) * W));
    const top = Math.max(0, Math.floor(((y0 - padY) / 1000) * H));
    const right = Math.min(W, Math.ceil(((x1 + padX) / 1000) * W));
    const bottom = Math.min(H, Math.ceil(((y1 + padY) / 1000) * H));
    const w = right - left, h = bottom - top;
    if (w < 4 || h < 4) continue;
    const sigma = Math.max(6, Math.round(Math.max(w, h) / 6));
    const patch = await sharp(base).extract({ left, top, width: w, height: h }).blur(sigma).toBuffer();
    composites.push({ input: patch, left, top });
  }
  const out = await sharp(base).composite(composites).jpeg({ quality: 78 }).toBuffer();
  return { buffer: out, masked: composites.length };
}
