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
 * `line.text`/`line.tts` come in as the setup; on success `text` becomes setup + punch.
 */
export function attachPunch(line: Line, draft: { text: string; tts: string } | undefined, used: Set<Side>): boolean {
  const punch = draft?.text.trim();
  if (!punch || line.text.trim().endsWith('—')) return false;
  if (line.speaker !== 'prosecution' && line.speaker !== 'defense') return false;
  const side: Side = line.speaker === 'prosecution' ? 'yes' : 'no';
  const words = punch.split(/\s+/).length;
  if (used.size > 0 || words > MAX_WORDS || !line.text.trim()) return false;
  used.add(side);
  line.text = `${line.text.trim()} ${punch}`;
  line.punch = { text: punch, tts: punchTts(line.speaker, draft!.tts, punch) };
  return true;
}
