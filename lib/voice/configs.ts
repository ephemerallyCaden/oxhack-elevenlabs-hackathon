import type { VoiceSettings } from "@elevenlabs/elevenlabs-js/api";
import type { Speaker } from "@/types";

export type VoiceRole = Exclude<Speaker, "user">;

// similarityBoost 1.0 keeps the presenter's real accent (accent test: eleven_v4 + stability 0.6 + similarity 1.0
// was the closest match). Roles differ by stability + audio tags + stereo pan only: on eleven_v4 `speed` has no
// effect (tested: 0.75 vs 1.2 gave the same length) and `style` is unavailable. Tune in the voice lab (/dev/voices).
export const VOICE_SETTINGS: Record<VoiceRole, VoiceSettings> = {
  prosecution: { stability: 0.4, similarityBoost: 1.0, useSpeakerBoost: true },
  defense: { stability: 0.6, similarityBoost: 1.0, useSpeakerBoost: true },
  judge: { stability: 0.8, similarityBoost: 1.0, useSpeakerBoost: true },
};

// Audio tags each role may use — all verified acted (not read aloud) on eleven_v4 by transcribing the output.
// research/14's [SHOUT]/[BEAT]/[SCOFF] are structure markers: use [shouting] / "..." / [scoffs] instead.
// D3's script prompt should only use these.
export const TAG_PALETTE: Record<VoiceRole, string[]> = {
  prosecution: ["confident", "excited", "passionate", "shouting", "laughs"],
  defense: ["concerned", "thoughtful", "hesitant", "scoffs", "sighs"],
  judge: ["calm", "authoritative", "measured", "sighs", "gasps"],
};
