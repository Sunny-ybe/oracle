// Loudness of a short voice note (Telegram / Discord), so chat users can "measure" noise
// without opening anything. Needs ffmpeg (brew install ffmpeg). Only a number is kept.
import { spawn } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

export async function loudnessDb(buffer) {
  const file = join(tmpdir(), `oracle-${randomBytes(6).toString("hex")}.audio`);
  await writeFile(file, buffer);
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-af", "volumedetect", "-f", "null", "-"]);
      let err = "";
      p.stderr.on("data", (d) => (err += d));
      p.on("error", () => reject(new Error("ffmpeg is not installed")));
      p.on("close", () => resolve(err));
    });
    const m = out.match(/mean_volume:\s*(-?[\d.]+) dB/);
    if (!m) throw new Error("Couldn't read the audio");
    // Rough phone calibration, same as the app's live meter: full scale is about 95 dB SPL.
    return Math.round(Math.min(120, Math.max(20, Number(m[1]) + 95)));
  } finally {
    unlink(file).catch(() => {});
  }
}
