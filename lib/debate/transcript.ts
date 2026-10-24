// Builds the post-verdict transcript: every line in order + numbered sources from the cards they cite.
import type { EvidenceCard, Line, Transcript, Verdict } from '@/types';

export function buildTranscript(question: string, lines: Line[], cards: EvidenceCard[], verdict?: Verdict): Transcript {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const sources: EvidenceCard[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const id of line.cites) {
      const card = byId.get(id);
      if (card && !seen.has(id)) {
        seen.add(id);
        sources.push(card);
      }
    }
  }
  return { question, lines, sources, verdict };
}

/** Footnote numbers for a line, e.g. [2, 5], in the transcript's source order. */
export function footnotes(t: Transcript, line: Line): number[] {
  return line.cites.map((id) => t.sources.findIndex((c) => c.id === id) + 1).filter((n) => n > 0);
}
