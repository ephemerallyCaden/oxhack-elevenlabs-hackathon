// Sound effects + music, all generated with ElevenLabs (scripts/generate-audio.mjs, B9).
// Moments from docs/design-core-loop.md: cut-scene, user interrupt, Judge scoring, verdict.
export const SFX = {
  objection: "/audio/sfx/objection.mp3", // user interrupts (cut to witness view)
  gavel: "/audio/sfx/gavel.mp3", // Judge scores a topic; play 3x ~300ms apart for the verdict
  scene_cut: "/audio/sfx/scene_cut.mp3", // cut between close-ups
  needle_up: "/audio/sfx/needle_up.mp3", // spectrum moves toward YES
  needle_down: "/audio/sfx/needle_down.mp3", // spectrum moves toward NO
  gasp: "/audio/sfx/gasp.mp3", // big moment / surprising fact
  murmur: "/audio/sfx/murmur.mp3", // loopable crowd ambience
  blip: "/audio/sfx/blip.mp3", // typewriter text blip
  buzzer: "/audio/sfx/buzzer.mp3", // irrelevant interrupt / penalty
} as const;

export const BGM = {
  cutscene: "/audio/bgm/cutscene.mp3", // "the court prepares" (agenda + research)
  trial: "/audio/bgm/trial.mp3", // main loop, loop it
  pursuit: "/audio/bgm/pursuit.mp3", // when one side is clearly winning a topic
  verdict: "/audio/bgm/verdict.mp3", // verdict reveal
} as const;

export type SfxName = keyof typeof SFX;
export type BgmName = keyof typeof BGM;
