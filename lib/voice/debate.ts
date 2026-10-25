import type { Line } from "@/types";
import { synthesizeCached } from "./cache";
import type { VoiceRole } from "./configs";

const CONCURRENCY = 4; // Creator plan allows a handful of parallel TTS requests
const RETRIES = 2;

// B5: voice many lines at once (e.g. pre-voicing the next lines, or caching the demo run).
// Fills audioUrl + durationMs on every line spoken by prosecution/defense/judge. A line that still
// fails after retries is left without audio and the response is marked fallback.
export async function voiceLines(lines: Line[], voiceId?: string): Promise<{ lines: Line[]; fallback: boolean; characters: number }> {
  const todo = lines.filter((l) => l.speaker !== "user" && (l.tts || l.text));
  let fallback = false;
  let characters = 0;

  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const line = todo[next++];
      const text = line.tts || line.text;
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await synthesizeCached(text, line.speaker as VoiceRole, voiceId);
          line.audioUrl = out.audioUrl;
          line.durationMs = out.durationMs;
          if (out.fallback) fallback = true;
          if (!out.cached && !out.fallback) characters += text.length;
          break;
        } catch (err) {
          if (attempt >= RETRIES) {
            fallback = true;
            break; // no audio: the player falls back to durationMs as a timer
          }
          const status = (err as { statusCode?: number }).statusCode;
          await new Promise((r) => setTimeout(r, status === 429 ? 2000 * (attempt + 1) : 500));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  return { lines, fallback, characters };
}
