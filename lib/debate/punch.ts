// Surprise punches: the emphasised ending of an argument line, played as its own shot + clip.
// Rules (owned by code, like cut-ins): YES/NO only, max one per topic (whichever side lands it
// first), never on a line that gets cut off.
import type { Line, Side } from '@/types';
import { TAG_PALETTE } from '@/lib/voice/configs';

const MAX_WORDS = 10;

/** Which sides already landed a punch on this topic (earlier calls: interrupt answers etc.). */
export function punchedSides(history: Line[], topicId: string): Set<Side> {
  const used = new Set<Side>();
  for (const l of history) {
    if (l.topic_id !== topicId || !l.punch) continue;
    if (l.speaker === 'prosecution') used.add('yes');
    if (l.speaker === 'defense') used.add('no');
  }
  return used;
}

const words = (s: string) => s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Does `text` already end with `tail` (case, punctuation and audio tags ignored)? */
function endsWithWords(text: string, tail: string): boolean {
  const a = words(text);
  const b = words(tail);
  return b.length > 0 && a.length >= b.length && b.every((w, i) => a[a.length - b.length + i] === w);
}
/** The tail as it follows `setup`: after a full stop it starts a new sentence (capitalised). */
const tailAfter = (setup: string, tail: string) => (/[.!?]$/.test(setup.trim()) ? tail.charAt(0).toUpperCase() + tail.slice(1) : tail);
const joinSentence = (setup: string, tail: string) => `${setup.trim()} ${tailAfter(setup, tail)}`;
/** `text` without its last `n` words (tokens with letters/digits; audio tags and dashes don't count). */
function dropWords(text: string, n: number): string {
  const tokens = text.trim().split(/\s+/);
  while (n > 0 && tokens.length) if (/[\p{L}\p{N}]/u.test(tokens.pop()!.replace(/\[[^\]]*\]/g, ''))) n--;
  return tokens.join(' ');
}

/** The setup half of a punch line (everything before the punch). */
export function setupText(line: Line): string {
  if (!line.punch) return line.text;
  const cut = line.text.length - line.punch.text.length;
  return line.text.slice(0, Math.max(0, cut)).trimEnd();
}

/** Intense, deliberate delivery: make sure the punch opens with one of the speaker's verified tags. */
const PUNCH_TAG = { prosecution: 'passionate', defense: 'concerned' } as const;
function punchTts(speaker: 'prosecution' | 'defense', tts: string, text: string): string {
  const spoken = tts.trim() || text;
  return /^\s*\[[^\]]+\]/.test(spoken) && TAG_PALETTE[speaker].some((t) => spoken.includes(`[${t}]`))
    ? spoken
    : `[${PUNCH_TAG[speaker]}] ${spoken.replace(/^\s*\[[^\]]+\]\s*/, '')}`;
}

/**
 * Attach the model's punch draft to `line` if the rules allow it; mutates `line` and `used`.
 * `line.text`/`line.tts` come in as the setup; on success `text` becomes setup + punch. A refused
 * punch is still the end of the sentence (the model wrote the setup to stop short of it), so it is
 * put back on the line as ordinary words.
 */
export function attachPunch(line: Line, draft: { text: string; tts: string } | undefined, used: Set<Side>): boolean {
  const punch = draft?.text.trim();
  if (!punch || line.text.trim().endsWith('—') || !line.text.trim()) return false;
  // Models sometimes leave the punch in the line's text too: never say it twice.
  const already = endsWithWords(line.text, punch);
  const refuse = () => {
    if (already) return false;
    line.text = joinSentence(line.text, punch);
    const spoken = draft!.tts.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || punch;
    if (line.tts?.trim() && !endsWithWords(line.tts, spoken)) line.tts = joinSentence(line.tts, spoken);
    return false;
  };
  if (line.speaker !== 'prosecution' && line.speaker !== 'defense') return refuse();
  const side: Side = line.speaker === 'prosecution' ? 'yes' : 'no';
  const count = punch.split(/\s+/).length;
  if (used.size > 0 || count > MAX_WORDS) return refuse();
  used.add(side);
  // The punch must be exactly the end of `text` (setupText() cuts it off by length).
  const setup = already ? dropWords(line.text, words(punch).length) : line.text.trim();
  const tail = tailAfter(setup, punch);
  line.text = setup ? `${setup} ${tail}` : tail;
  line.punch = { text: tail, tts: punchTts(line.speaker, draft!.tts, punch) };
  return true;
}
