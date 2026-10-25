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
const norm = (tok: string) => tok.replace(/\[[^\]]*\]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]/gu, '');
const words = (s: string) => tokensOf(s).map(norm).filter(Boolean);
const OPEN_QUOTE = /^[“"‘'(«]+/;
// How a number is spoken: number words (also "twenty-five", "third", "nineties"), and the units that follow one.
const UNIT = 'one|two|three|four|five|six|seven|eight|nine';
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const NUMBERISH = new RegExp(
  `^(?:zero|${UNIT}|ten|eleven|twelve|\\p{L}+teen|(?:${TENS})(?:${UNIT})?|hundred|thousand|million|billion|trillion` +
    `|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|\\p{L}+teenth|\\p{L}+tieth` +
    `|(?:${TENS})(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth)|hundredth|thousandth|millionth` +
    `|(?:twen|thir|for|fif|six|seven|eigh|nine)ties|noughties|times?|twice|double|half|am|pm|oclock` +
    `|percent|pounds?|dollars?|euros?|pence|cents?|quid|grand|k|years?|months?|weeks?|days?|hours?|minutes?)$`,
  'u',
);
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
  const finished = /[.!?,;:…]["”’')»]*$/.test(untagged(text));
  for (let k = Math.min(a.length, b.length); k > 0; k--) {
    if (finished && k < b.length) break;
    if (b.slice(0, k).every((w, i) => a[a.length - k + i] === w)) return k;
  }
  return 0;
}
/** The tail as it follows `setup`: after a full stop it starts a new sentence (capitalised). */
// A sentence ended (a full stop, maybe inside a closing quote), but not a "..." pause before the punch
// and not an initialism like "the U.S." (more likely mid-sentence).
const SENTENCE_END = /(?<!\.)[.!?]["”’')»]*$/;
const INITIALISM = /\b(?:\p{Lu}\.){2,}["”’')»]*$/u;
const untagged = (s: string) => s.replace(/\[[^\]]*\]/g, '').trim();
const endsSentence = (s: string) => SENTENCE_END.test(untagged(s)) && !INITIALISM.test(untagged(s));
/** Capitalise the first word, if it starts with a letter ("£2,000 a month." stays; "iPhones" stays). */
const capitalise = (tail: string) => tail.replace(/^([^\p{L}\p{N}]*)(\p{Ll})(?!\p{Lu})/u, (_, lead: string, c: string) => lead + c.toUpperCase());
/** The tail as it follows `setup`: after a sentence end (or alone) it starts a new sentence. */
const tailAfter = (setup: string, tail: string) => (!untagged(setup) || endsSentence(setup) ? capitalise(tail) : tail);
const joinSentence = (setup: string, tail: string) => (setup.trim() ? `${setup.trim()} ${tailAfter(setup, tail)}` : capitalise(tail));
/** `text` without its last `n` words, plus any opening quote the first dropped word carried. */
function dropWords(text: string, n: number): { rest: string; lead: string; first: string } {
  const tokens = tokensOf(text);
  let lead = '';
  let first = ''; // the first dropped word as the text wrote it (its case wins over the punch's)
  while (n > 0 && tokens.length) {
    const tok = tokens.pop()!;
    if (norm(tok)) {
      n--;
      first = tok.replace(/\[[^\]]*\]/g, '');
      lead = OPEN_QUOTE.exec(first)?.[0] ?? '';
    }
  }
  return { rest: tokens.join(' ').replaceAll(JOIN, ' '), lead, first };
}
/** `text` with whatever it already says of `tail` taken off its end (so joining never repeats words). */
function before(text: string, tail: string): { rest: string; lead: string; first: string } {
  const k = overlap(text, tail);
  return k ? dropWords(text, k) : { rest: text.trim(), lead: '', first: '' };
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
  if (line.tts != null && !words(line.tts).length) line.tts = ''; // blank or only a tag: voice the text instead
  // Models sometimes leave all or part of the punch in the line's text too: never say a word twice.
  const already = endsWithWords(line.text, punch);
  // Did the text itself say (part of) the punch? (Measured before `line.text` is rewritten below.)
  const textOverlap = already || overlap(line.text, punch) > 0;
  const cut = before(line.text, punch);
  // Keep an opening quote, and the case the text gave the overlapping word ("I said no." + "No." → "I said no.").
  const quoted = cut.lead && !OPEN_QUOTE.test(punch) ? cut.lead + punch : punch;
  const textLetter = cut.first.match(/\p{L}/u)?.[0];
  const shown = textLetter ? quoted.replace(/\p{L}/u, textLetter) : quoted;
  // The punch's spoken form (numbers written out, "..." beats), without its delivery tag.
  const spoken = draft!.tts.replace(/^\s*\[[^\]]+\]\s*/, '').trim() || punch;
  /** A partial overlap of the clip with the punch is cut only if the text overlapped too, or the clip lines up
   *  with the setup right before it ("…more than | every quant"): a coincidence ("…returns seven | percent"
   *  for the text's "7%") never cuts a setup word. */
  const clipOverlap = (tts: string, tail: string) => {
    const k = overlap(tts, tail);
    if (k <= 0) return false;
    if (textOverlap) return true;
    const clip = words(tts);
    const setup = words(cut.rest);
    if (!setup.length) return false;
    const prev = clip[clip.length - k - 1];
    const lastRaw = tokensOf(cut.rest).at(-1) ?? '';
    // A number the text writes in digits is said in the clip as digits ("30") or spelled out ("thirty",
    // "thirty-year", "£12,000" ↔ "…pounds", "7%" ↔ "percent"). The clip's unit belongs to the number, so
    // "seven | percent" or "twelve thousand | pounds" never counts as running into a punch that starts with it.
    if (/\d/.test(lastRaw)) {
      // The clip's token right before the overlap, as written ("thirty-year", "%"), and its last word part.
      const raws = tokensOf(tts);
      let i = raws.length;
      for (let seen = 0; i > 0 && seen < k; ) if (norm(raws[--i])) seen++;
      const rawPrev = raws.slice(0, i).reverse().find((t) => /[\p{L}\p{N}%]/u.test(t.replace(/\[[^\]]*\]/g, ''))) ?? '';
      const spokenPrev = norm(rawPrev.split('-').at(-1) ?? '');
      const bare = lastRaw.replace(/[^\p{L}\p{N}%£$€¥]/gu, '');
      if (bare.endsWith('%')) return prev === setup[setup.length - 1] || /^(?:per)?cent$/.test(prev ?? '') || /%$/.test(rawPrev);
      // The number's spoken units, from its symbol and suffix ("£12k" → pounds…, grand, thousand).
      const units = [
        /£/.test(bare) && /^(?:pounds?|quid|grand|pence|p)$/,
        /\$/.test(bare) && /^(?:dollars?|bucks|grand|cents?)$/,
        /€/.test(bare) && /^(?:euros?|cents?|grand)$/,
        /¥/.test(bare) && /^yen$/,
        /\dx$/i.test(bare) && /^times$/,
        /\dp$/i.test(bare) && /^(?:pence|p)$/,
        /\dk$/i.test(bare) && /^(?:thousand|k|grand)$/,
      ].filter((u): u is RegExp => !!u);
      // The overlap starts with the number's unit ("…five | million dollars"): it belongs to the setup.
      const ov = clip.slice(clip.length - k);
      const j = ov.findIndex((w) => units.some((u) => u.test(w)));
      // Number words before the unit only belong to the setup if its digits say them ("$5m" → million).
      const scale = /\dk$/i.test(bare) ? /^thousand$/ : /\dm$/i.test(bare) ? /^million$/ : /\d(?:bn|b)$/i.test(bare) ? /^billion$/ : null;
      if (j >= 0 && ov.slice(0, j).every((w) => scale?.test(w))) return false;
      // "am"/"pm" only count as part of the number right after one ("nine am", not "I am").
      if (/^(?:am|pm)$/.test(spokenPrev) && !NUMBERISH.test(clip[clip.length - k - 2] ?? '')) return prev === setup[setup.length - 1];
      return prev === setup[setup.length - 1] || NUMBERISH.test(spokenPrev);
    }
    return prev === setup[setup.length - 1];
  };
  const refuse = () => {
    if (!already) line.text = joinSentence(cut.rest, shown);
    // The voice line must say the whole sentence too (it may hold only the setup, as the prompt asks).
    if (line.tts?.trim() && !endsWithWords(line.tts, spoken) && !endsWithWords(line.tts, punch))
      line.tts = joinSentence(clipOverlap(line.tts, spoken) ? before(line.tts, spoken).rest : line.tts, spoken);
    return false;
  };
  if (line.speaker !== 'prosecution' && line.speaker !== 'defense') return refuse();
  const side: Side = line.speaker === 'prosecution' ? 'yes' : 'no';
  const count = punch.split(/\s+/).length;
  if (used.size > 0 || count > MAX_WORDS) return refuse();
  // The punch must be exactly the end of `text` (setupText() cuts it off by length), after a real setup.
  // The whole line is (the start of) the punch: no setup to cut to, so it's a plain line (with the rest of the punch).
  if (!words(cut.rest).length) return refuse();
  used.add(side);
  const tail = tailAfter(cut.rest, shown);
  line.text = `${cut.rest} ${tail}`;
  line.punch = { text: tail, tts: punchTts(line.speaker, draft!.tts, punch) };
  // The setup clip is voiced from `tts`: if it also says (part of) the punch, in either form, cut it.
  if (line.tts?.trim()) {
    const t = line.tts;
    // Partial overlaps only where clipOverlap allows them (else "freedom, freedom to fail" — same word
    // count in clip and text — would lose a word in the clip).
    const rest = endsWithWords(t, spoken)
      ? before(t, spoken).rest
      : endsWithWords(t, punch)
        ? before(t, punch).rest
        : clipOverlap(t, spoken)
          ? before(t, spoken).rest
          : clipOverlap(t, punch)
            ? before(t, punch).rest
            : t.trim();
    line.tts = words(rest).length ? rest : ''; // nothing left but a tag: voice the setup text instead
  }
  return true;
}
