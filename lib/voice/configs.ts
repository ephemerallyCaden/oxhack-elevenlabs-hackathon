import type { VoiceSettings } from "@elevenlabs/elevenlabs-js/api";

export type VoiceRole = "prosecution" | "defense" | "judge";

// similarityBoost 1.0 keeps the presenter's real accent (accent test: eleven_v4 + stability 0.6 + similarity 1.0
// was the closest match). Roles differ by stability + audio tags + stereo pan; v4 docs say style/speed are
// unavailable, so speed is kept only for B4 to verify. B4 (voice lab) tunes these.
export const VOICE_SETTINGS: Record<VoiceRole, VoiceSettings> = {
  prosecution: { stability: 0.4, similarityBoost: 1.0, style: 0, speed: 1.1, useSpeakerBoost: true },
  defense: { stability: 0.6, similarityBoost: 1.0, style: 0, speed: 0.9, useSpeakerBoost: true },
  judge: { stability: 0.8, similarityBoost: 1.0, style: 0, speed: 1.0, useSpeakerBoost: true },
};

// Audio tags each role may use (verified not read aloud on eleven_v4 / v4_turbo). D3's script prompt should stick to these.
export const TAG_PALETTE: Record<VoiceRole, string[]> = {
  prosecution: ["confident", "excited", "passionate", "laughs"],
  defense: ["concerned", "thoughtful", "hesitant", "sighs"],
  judge: ["calm", "authoritative", "measured"],
};
