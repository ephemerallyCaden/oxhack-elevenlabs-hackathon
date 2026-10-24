import type { DebateEvent, VoiceDebateRequest, VoiceDebateResponse } from "@/types";
import { synthesizeCached } from "./cache";
import type { VoiceRole } from "./configs";

const CONCURRENCY = 4; // Creator plan allows a handful of parallel TTS requests
const RETRIES = 2;

const isSpoken = (e: DebateEvent) =>
  (e.type === "speech" || e.type === "interrupt" || e.type === "verdict") &&
  !!e.speaker && e.speaker !== "user" && !!(e.tts ?? e.text);

// B5: voice a whole script (+ HOLD IT elaborations) in parallel during the loading screen.
// Fills audioUrl + durationMs on every spoken event. A line that still fails after retries gets
// silent mock audio and the response is marked fallback, so the debate always plays.
export async function voiceDebate(req: VoiceDebateRequest): Promise<VoiceDebateResponse & { characters: number }> {
  const all = [...req.events, ...Object.values(req.elaborations ?? {}).flat()];
  const todo = all.filter(isSpoken);
  let fallback = false;
  let characters = 0;

  let next = 0;
  async function worker() {
    while (next < todo.length) {
      const e = todo[next++];
      const text = (e.tts ?? e.text)!;
      for (let attempt = 0; ; attempt++) {
        try {
          const out = await synthesizeCached(text, e.speaker as VoiceRole, req.voiceId);
          e.audioUrl = out.audioUrl;
          e.durationMs = out.durationMs;
          if (out.fallback) fallback = true;
          if (!out.cached && !out.fallback) characters += text.length;
          break;
        } catch (err) {
          if (attempt >= RETRIES) {
            fallback = true;
            break; // leave audioUrl empty: C4 estimates duration from text and plays silently
          }
          const status = (err as { statusCode?: number }).statusCode;
          await new Promise((r) => setTimeout(r, status === 429 ? 2000 * (attempt + 1) : 500));
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

  return { events: req.events, elaborations: req.elaborations ?? {}, fallback, characters };
}
