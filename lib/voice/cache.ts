import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TTS_MODEL, voiceIdFor } from "./client";
import { VOICE_SETTINGS, type VoiceRole } from "./configs";
import { synthesize, type TtsResult } from "./tts";

// Disk cache for generated lines, so replaying the same debate costs 0 credits.
// Vercel's filesystem is read-only except /tmp (cache lasts while the instance is warm).
const DIR = process.env.VERCEL ? "/tmp/roulette-tts" : join(process.cwd(), ".cache", "tts");

export async function synthesizeCached(text: string, role: VoiceRole, voiceId?: string): Promise<TtsResult & { cached: boolean }> {
  const key = createHash("sha256")
    .update(JSON.stringify([TTS_MODEL, voiceIdFor(voiceId), VOICE_SETTINGS[role], text]))
    .digest("hex")
    .slice(0, 32);
  const file = join(DIR, `${key}.json`);
  try {
    return { ...(JSON.parse(await readFile(file, "utf8")) as TtsResult), cached: true };
  } catch {
    // not cached yet
  }
  const out = await synthesize(text, role, voiceId);
  if (!out.fallback) {
    await mkdir(DIR, { recursive: true });
    await writeFile(file, JSON.stringify(out));
  }
  return { ...out, cached: false };
}
