import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { keyFor, perKey, usingOwnKey } from "@/lib/keys";

// Server-only. Never import this from a "use client" file — it reads the API key.
export const TTS_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_v4";
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";

const clients = new Map<string, ElevenLabsClient>(); // per key (lib/keys.ts perKey)

/**
 * The ElevenLabs client for this request's key (a visitor's own, else the house key: lib/keys.ts),
 * or null when there's none → callers return mock data (mock-first rule in CLAUDE.md).
 */
export function elevenlabs(): ElevenLabsClient | null {
  const key = keyFor("elevenlabs");
  return key ? perKey(clients, key, () => new ElevenLabsClient({ apiKey: key, timeoutInSeconds: 60, maxRetries: 1 })) : null;
}

const GEORGE = "JBFqnCBsd6RMkjVDRZzb"; // library voice: in every ElevenLabs account, last-resort fallback

export function voiceIdFor(override?: string) {
  if (override) return override;
  // A visitor's own ElevenLabs account doesn't have our presenter voice: use a public library voice.
  if (usingOwnKey("elevenlabs")) return process.env.ELEVENLABS_PUBLIC_VOICE_ID ?? GEORGE;
  return process.env.ELEVENLABS_VOICE_ID ?? process.env.ELEVENLABS_BACKUP_VOICE_ID ?? GEORGE;
}
