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

// Text is compared word by word: whitespace tokens with audio tags and punctuation removed ("£12,000."
// → "12000", "can't" → "cant"), a multi-word tag like [laughs softly] kept as one token.
const JOIN = '\u2060'; // word joiner: not whitespace, so a tag's inner spaces don't split it
const tokensOf = (s: string) => s.trim().replace(/\[[^\]]*\]/g, (t) => t.replace(/\s+/g, JOIN)).split(/\s+/).filter(Boolean);
const norm = (tok: string) => tok.replace(/\[[^\]]*\]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const words = (s: string) => tokensOf(s).map(norm).filter(Boolean);
const OPEN_QUOTE = /^[“"‘'(«]+/;
/** Does `text` already end with `tail` (case, punctuation and audio tags ignored)? */
function endsWithWords(text: string, tail: string): boolean {
  const a = words(text);
  const b = words(tail);
  return b.length > 0 && a.length >= b.length && b.every((w, i) => a[a.length - b.length + i] === w);
}
/** How many of `tail`'s first words `text` already ends with (a partial overlap; 0 if none). */
function overlap(text: string, tail: string): number {
  const a = words(text);
  const b = words(tail);
  // A finished sentence ("I lost it all.") only counts if it ends with the whole tail, never a part of it.
  // (A comma/semicolon/colon is a deliberate pause too: "freedom, freedom to fail" keeps both words.)
  const finished = /[.!?,;:]["”’')»]*$/.test(untagged(text));
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    if (finished && k < b.length) break;
    if (b.slice(0, k).every((w, i) => a[a.length - k + i] === w)) return k;
  }
  return 0;
}
/** The tail as it follows `setup`: after a full stop it starts a new sentence (capitalised). */
// A sentence ended (a full stop, maybe inside a closing quote), but not a "..." pause before the punch.
const SENTENCE_END = /(?<!\.)[.!?]["”’')»]*$/;
const untagged = (s: string) => s.replace(/\[[^\]]*\]/g, '').trim();
/** The tail as it follows `setup`: after a sentence end it starts a new sentence (first letter capitalised). */
const tailAfter = (setup: string, tail: string) => (SENTENCE_END.test(untagged(setup)) ? tail.replace(/\p{L}/u, (c) => c.toUpperCase()) : tail);
const joinSentence = (setup: string, tail: string) => (setup.trim() ? `${setup.trim()} ${tailAfter(setup, tail)}` : tail);
/** `text` without its last `n` words, plus any opening quote the first dropped word carried. */
function dropWords(text: string, n: number): { rest: string; lead: string } {
  const tokens = tokensOf(text);
  let lead = '';
  while (n > 0 && tokens.length) {
    const tok = tokens.pop()!;
    if (norm(tok)) {
      n--;
      lead = OPEN_QUOTE.exec(tok.replace(/\[[^\]]*\]/g, ''))?.[0] ?? '';
    }
  }
  return { rest: tokens.join(' ').replaceAll(JOIN, ' '), lead };
}
/** `text` with whatever it already says of `tail` taken off its end (so joining never repeats words). */
function before(text: string, tail: string): { rest: string; lead: string } {
  const k = overlap(text, tail);
  return k ? dropWords(text, k) : { rest: text.trim(), lead: '' };
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
  // Models sometimes leave all or part of the punch in the line's text too: never say a word twice.
  const already = endsWithWords(line.text, punch);
  const cut = before(line.text, punch);
  const shown = cut.lead && !OPEN_QUOTE.test(punch) ? cut.lead + punch : punch; // keep an opening quote
  // The punch's spoken form (numbers written out, "..." beats), without its delivery tag.
  const spoken = draft!.tts.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || punch;
  const refuse = () => {
    if (!already) line.text = joinSentence(cut.rest, shown);
    // The voice line must say the whole sentence too (it may hold only the setup, as the prompt asks).
    if (line.tts?.trim() && !endsWithWords(line.tts, spoken) && !endsWithWords(line.tts, punch)) line.tts = joinSentence(before(line.tts, spoken).rest, spoken);
    return false;
  };
  if (line.speaker !== 'prosecution' && line.speaker !== 'defense') return refuse();
  const side: Side = line.speaker === 'prosecution' ? 'yes' : 'no';
  const count = punch.split(/\s+/).length;
  if (used.size > 0 || count > MAX_WORDS) return refuse();
  // The punch must be exactly the end of `text` (setupText() cuts it off by length), after a real setup.
  if (!words(cut.rest).length) return false; // the punch would be the whole line: keep it as a plain line
  used.add(side);
  const tail = tailAfter(cut.rest, shown);
  line.text = `${cut.rest} ${tail}`;
  line.punch = { text: tail, tts: punchTts(line.speaker, draft!.tts, punch) };
  // The setup clip is voiced from `tts`: if it also says (part of) the punch, in either form, cut it.
  if (line.tts?.trim()) {
    const t = line.tts;
    const rest = endsWithWords(t, spoken) || overlap(t, spoken) ? before(t, spoken).rest : before(t, punch).rest;
    line.tts = words(rest).length ? rest : ''; // nothing left but a tag: voice the setup text instead
  }
  return true;
}
