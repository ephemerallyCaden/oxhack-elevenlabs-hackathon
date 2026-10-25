// Pure scoring maths: weights, topic balance, spectrum. Everything the verdict's numbers come from.
import type { LedgerEntry, Spectrum, SpectrumLabel, Topic } from '@/types';

export const MAX_TOPICS = 2;

const live = (t: Topic) => t.status !== 'removed';

/** Scale importances of non-removed topics so they sum to 1 (equal split if all are 0). */
export function normalise(topics: Topic[]): Topic[] {
  const total = topics.filter(live).reduce((s, t) => s + Math.max(0, t.importance), 0);
  const n = topics.filter(live).length;
  return topics.map((t) =>
    !live(t) ? { ...t, importance: 0 } : { ...t, importance: total > 0 ? Math.max(0, t.importance) / total : 1 / n },
  );
}

/** Add a topic that should carry `share` (0-1) of the weight; existing topics shrink proportionally. */
export function addTopic(topics: Topic[], topic: Topic, share: number): Topic[] {
  const s = Math.min(0.6, Math.max(0.05, share));
  const scaled = normalise(topics).map((t) => (live(t) ? { ...t, importance: t.importance * (1 - s) } : t));
  return [...scaled, { ...topic, importance: s }];
}

export function removeTopic(topics: Topic[], id: string): Topic[] {
  return normalise(topics.map((t) => (t.id === id ? { ...t, status: 'removed' as const } : t)));
}

/** Quick-to-research topics first (stable), so the debate can start while deep research runs. */
export function orderAgenda(topics: Topic[]): Topic[] {
  return [...topics].sort((a, b) => (a.research_speed === b.research_speed ? 0 : a.research_speed === 'quick' ? -1 : 1));
}

/** −1 … +1 from the ledger alone: strength-weighted YES minus NO. Used as the fallback topic score. */
export function ledgerBalance(entries: LedgerEntry[]): number {
  let yes = 0;
  let no = 0;
  for (const e of entries) {
    if (e.supports === 'yes') yes += e.strength;
    if (e.supports === 'no') no += e.strength;
  }
  return yes + no === 0 ? 0 : (yes - no) / (yes + no);
}

export function spectrumLabel(value: number): SpectrumLabel {
  if (value <= -60) return 'Strong no';
  if (value <= -20) return 'Lean no';
  if (value < 20) return 'Toss-up';
  if (value < 60) return 'Lean yes';
  return 'Strong yes';
}

/** Importance-weighted average of SCORED, non-removed topics, × 100. 0 before any topic is scored. */
export function computeSpectrum(topics: Topic[]): Spectrum {
  const scored = topics.filter((t) => live(t) && t.score);
  const w = scored.reduce((s, t) => s + t.importance, 0);
  const raw = w === 0 ? 0 : scored.reduce((s, t) => s + t.importance * t.score!.t, 0) / w;
  const value = Math.round(Math.max(-1, Math.min(1, raw)) * 100);
  return { value, label: spectrumLabel(value) };
}
