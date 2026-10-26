import type { VoiceSettings } from "@elevenlabs/elevenlabs-js/api";
import type { TtsResponse } from "@/types";
import { accentFor, withAccent } from "./accent";
import { elevenlabs, TTS_MODEL, voiceIdFor } from "./client";
import { VOICE_SETTINGS, type VoiceRole } from "./configs";

// TtsResponse (types.ts) + per-character timings of the input text (includes [tags]),
// so the typewriter can follow the voice exactly.
export type TtsResult = TtsResponse & {
  alignment?: { characters: string[]; startSeconds: number[]; endSeconds: number[] };
  /** Set when the requested voice failed and the presenter voice was used instead: why. */
  voiceFallback?: string;
};

// Server-only: generates one line of speech for a courtroom role. audioUrl is a data: URL, playable as-is.
// `settings` overrides the role's voice settings (voice lab only).
// A user's own clone that fails (e.g. ElevenLabs flags it "requires verification", or it was deleted)
// falls back to the presenter voice instead of failing the line.
export async function synthesize(text: string, role: VoiceRole, voiceId?: string, settings?: VoiceSettings): Promise<TtsResult> {
  const el = elevenlabs(); // this request's key (lib/keys.ts)
  if (!el) return mockSpeech(text);

  let res;
  try {
    res = await el.textToSpeech.convertWithTimestamps(voiceIdFor(voiceId), {
      text: withAccent(text, accentFor(voiceId)),
      modelId: TTS_MODEL,
      voiceSettings: settings ?? VOICE_SETTINGS[role],
      outputFormat: "mp3_44100_128",
    });
  } catch (e) {
    if (!voiceId) throw e;
    const detail = (e as { body?: { detail?: { message?: string } } }).body?.detail?.message ?? (e as Error).message;
    console.error(`[voice/tts] voice ${voiceId} failed, using the presenter voice for this line: ${detail}`);
    return { ...(await synthesize(text, role, undefined, settings)), voiceFallback: detail };
  }
  const a = res.alignment;
  return {
    audioUrl: `data:audio/mpeg;base64,${res.audioBase64}`,
    durationMs: Math.round((a?.characterEndTimesSeconds.at(-1) ?? estimateSeconds(text)) * 1000),
    alignment: a && { characters: a.characters, startSeconds: a.characterStartTimesSeconds, endSeconds: a.characterEndTimesSeconds },
    fallback: false,
  };
}

// ~14 spoken characters per second, ignoring [audio tags].
function estimateSeconds(text: string) {
  return Math.max(1, text.replace(/\[[^\]]*\]/g, "").trim().length / 14);
}

// Silent WAV of the estimated length, so timing-dependent UI still works without a key.
export function mockSpeech(text: string): TtsResult {
  const seconds = estimateSeconds(text);
  const sampleRate = 8000;
  const dataBytes = Math.round(seconds * sampleRate) * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); // PCM
  wav.writeUInt16LE(1, 22); // mono
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataBytes, 40);
  return { audioUrl: `data:audio/wav;base64,${wav.toString("base64")}`, durationMs: Math.round(seconds * 1000), fallback: true };
}
