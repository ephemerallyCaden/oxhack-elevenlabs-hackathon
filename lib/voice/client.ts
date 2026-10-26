import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createHash } from "node:crypto";
import { keyFor, usingOwnKey } from "@/lib/keys";

// Server-only. Never import this from a "use client" file — it reads the API key.
export const TTS_MODEL = process.env.ELEVENLABS_MODEL ?? "eleven_v4";
export const STT_MODEL = process.env.ELEVENLABS_STT_MODEL ?? "scribe_v2";

// One client per key, reused; a few visitors' keys at most, so the oldest is dropped past the cap.
const clients = new Map<string, ElevenLabsClient>();
const MAX_CLIENTS = 32;

/**
 * The ElevenLabs client for this request's key (a visitor's own, else the house key: lib/keys.ts),
 * or null when there's none → callers return mock data (mock-first rule in CLAUDE.md).
 */
export function elevenlabs(): ElevenLabsClient | null {
  const key = keyFor("elevenlabs");
  if (!key) return null;
  const id = createHash("sha256").update(key).digest("hex");
  let c = clients.get(id);
  if (!c) {
    c = new ElevenLabsClient({ apiKey: key, timeoutInSeconds: 60, maxRetries: 1 });
    clients.set(id, c);
    if (clients.size > MAX_CLIENTS) clients.delete(clients.keys().next().value!);
  }
  return c;
}

const GEORGE = "JBFqnCBsd6RMkjVDRZzb"; // library voice: in every ElevenLabs account, last-resort fallback

export function voiceIdFor(override?: string) {
  if (override) return override;
  // A visitor's own ElevenLabs account doesn't have our presenter voice: use a public library voice.
  if (usingOwnKey("elevenlabs")) return process.env.ELEVENLABS_PUBLIC_VOICE_ID ?? GEORGE;
  return process.env.ELEVENLABS_VOICE_ID ?? process.env.ELEVENLABS_BACKUP_VOICE_ID ?? GEORGE;
}
