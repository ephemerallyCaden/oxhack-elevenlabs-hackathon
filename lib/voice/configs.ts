import type { VoiceSettings } from "@elevenlabs/elevenlabs-js/api";

export type VoiceRole = "prosecution" | "defense" | "judge";

// Starting values from DESIGN.md "The Three Selves". B4 (voice lab) tunes these on the real clone.
export const VOICE_SETTINGS: Record<VoiceRole, VoiceSettings> = {
  prosecution: { stability: 0.3, similarityBoost: 0.75, style: 0.55, speed: 1.1, useSpeakerBoost: false },
  defense: { stability: 0.55, similarityBoost: 0.75, style: 0.4, speed: 0.88, useSpeakerBoost: true },
  judge: { stability: 0.8, similarityBoost: 0.8, style: 0.15, speed: 0.97, useSpeakerBoost: true },
};

// Audio tags each role may use (verified working on eleven_v4_turbo). D3's script prompt should stick to these.
export const TAG_PALETTE: Record<VoiceRole, string[]> = {
  prosecution: ["confident", "excited", "passionate", "laughs"],
  defense: ["concerned", "thoughtful", "hesitant", "sighs"],
  judge: ["calm", "authoritative", "measured"],
};
