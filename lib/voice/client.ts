import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

// Server-only. Never import this from a "use client" file — it reads the API key.
export const TTS_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_v4_turbo";
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";

// null when there's no key → callers return mock data (mock-first rule in CLAUDE.md).
export const elevenlabs = process.env.ELEVENLABS_API_KEY
  ? new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 60, maxRetries: 1 })
  : null;

const GEORGE = "JBFqnCBsd6RMkjVDRZzb"; // library voice, last-resort fallback

export function voiceIdFor(override?: string) {
  return override ?? process.env.ELEVENLABS_VOICE_ID ?? process.env.ELEVENLABS_BACKUP_VOICE_ID ?? GEORGE;
}
