// Accent hint for the presenter's clone. Accent test on eleven_v4: "[slight British accent]" before every
// sentence kept the presenter's British accent best (a single hint at the start fades on longer lines).
// .env.local: ELEVENLABS_ACCENT_TAG="" turns it off, or e.g. "soft English accent";
// ELEVENLABS_ACCENT_MODE=start puts it only at the beginning of each line.
export const ACCENT_TAG = process.env.ELEVENLABS_ACCENT_TAG ?? "slight British accent";
const EVERY_SENTENCE = process.env.ELEVENLABS_ACCENT_MODE !== "start";

/** Only the presenter voice gets the hint (no voiceId override) — never a judge's own clone. */
export function accentFor(voiceId?: string) {
  return voiceId ? "" : ACCENT_TAG;
}

/** Adds `[tag]` after any leading audio tags of each sentence: "[confident] Hi." → "[confident][tag] Hi." */
export function withAccent(text: string, tag: string, everySentence = EVERY_SENTENCE): string {
  if (!tag) return text;
  const hint = `[${tag}]`;
  const add = (s: string) => (s.includes(hint) ? s : s.replace(/^((?:\[[^\]]*\]\s*)*)/, (lead) => `${lead.trimEnd()}${hint} `));
  const sentences = text.trim().split(/(?<=[.!?…])\s+/);
  return sentences.map((s, i) => (everySentence || i === 0 ? add(s) : s)).join(" ");
}
