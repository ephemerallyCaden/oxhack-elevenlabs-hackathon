import { describe, expect, it } from 'vitest';
import type { LedgerEntry, Topic } from '@/types';
import { addTopic, computeSpectrum, ledgerBalance, normalise, orderAgenda, removeTopic, spectrumLabel, sway, BAR_GAIN } from './spectrum';

const topic = (id: string, importance: number, extra: Partial<Topic> = {}): Topic => ({
  id, title: id, question: `${id}?`, importance, research_speed: 'quick', status: 'pending', added_by: 'judge', ...extra,
});
const sum = (ts: Topic[]) => ts.filter((t) => t.status !== 'removed').reduce((s, t) => s + t.importance, 0);

describe('weights', () => {
  it('normalises live topics to sum to 1 and zeroes removed ones', () => {
    const ts = normalise([topic('a', 2), topic('b', 6), topic('c', 5, { status: 'removed' })]);
    expect(ts.map((t) => t.importance)).toEqual([0.25, 0.75, 0]);
  });

  it('splits equally when every importance is 0', () => {
    expect(normalise([topic('a', 0), topic('b', 0)]).map((t) => t.importance)).toEqual([0.5, 0.5]);
  });

  it('adding a topic gives it its share and shrinks the rest proportionally', () => {
    const ts = addTopic([topic('a', 0.5), topic('b', 0.5)], topic('new', 0, { added_by: 'user' }), 0.2);
    expect(ts.find((t) => t.id === 'new')!.importance).toBeCloseTo(0.2);
    expect(ts.find((t) => t.id === 'a')!.importance).toBeCloseTo(0.4);
    expect(sum(ts)).toBeCloseTo(1);
  });

  it('removing a topic re-normalises the rest', () => {
    const ts = removeTopic([topic('a', 0.5), topic('b', 0.25), topic('c', 0.25)], 'a');
    expect(ts.find((t) => t.id === 'a')!.status).toBe('removed');
    expect(ts.find((t) => t.id === 'b')!.importance).toBeCloseTo(0.5);
    expect(sum(ts)).toBeCloseTo(1);
  });

  it('orders quick-to-research topics first, keeping their relative order', () => {
    const ts = orderAgenda([topic('d1', 1, { research_speed: 'deep' }), topic('q1', 1), topic('d2', 1, { research_speed: 'deep' }), topic('q2', 1)]);
    expect(ts.map((t) => t.id)).toEqual(['q1', 'q2', 'd1', 'd2']);
  });
});

describe('spectrum', () => {
  const scored = (id: string, importance: number, t: number, extra: Partial<Topic> = {}) =>
    topic(id, importance, { status: 'done', score: { t, confidence: 1, reasoning: '', deciding_argument: '' }, ...extra });

  it('is 0 / Toss-up before any topic is scored', () => {
    expect(computeSpectrum([topic('a', 1)])).toEqual({ value: 0, label: 'Toss-up' });
  });

  it('is the importance-weighted average of scored topics, swung by BAR_GAIN and capped at ±100', () => {
    // 0.75 * +1 + 0.25 * -1 = +0.5 → × 1.8 = +90
    expect(computeSpectrum([scored('a', 0.75, 1), scored('b', 0.25, -1), topic('c', 0.5)]).value).toBe(Math.round(50 * BAR_GAIN));
    // a mild lean reads as a lean, not a toss-up: +0.15 → +27
    expect(computeSpectrum([scored('a', 1, 0.15)]).label).toBe('Lean yes');
    expect(computeSpectrum([scored('a', 1, -0.8)]).value).toBe(-100);
  });

  it('ignores removed topics even if they were scored', () => {
    expect(computeSpectrum([scored('a', 0.5, 1), scored('b', 0.5, -1, { status: 'removed' })]).value).toBe(100);
  });

  it('labels the five bands', () => {
    expect([-100, -40, 0, 40, 100].map(spectrumLabel)).toEqual(['Strong no', 'Lean no', 'Toss-up', 'Lean yes', 'Strong yes']);
  });
});

describe('ledger balance', () => {
  const e = (supports: LedgerEntry['supports'], strength: number): LedgerEntry => ({
    id: 'x', line_id: 'l', topic_id: 't', by: 'user', supports, claim: '', strength, card_ids: [],
  });

  it('is strength-weighted yes minus no, ignoring neutral', () => {
    expect(ledgerBalance([e('yes', 3), e('no', 1), e('neutral', 5)])).toBeCloseTo(0.5);
  });

  it('is 0 for an empty ledger', () => {
    expect(ledgerBalance([])).toBe(0);
  });
});

describe('sway (the court commits)', () => {
  it('pushes a close ruling well off the middle, keeps the sign, and leaves 0 and ±1 alone', () => {
    expect(sway(0)).toBe(0);
    expect(sway(1)).toBe(1);
    expect(sway(-1)).toBe(-1);
    expect(sway(0.1)).toBeGreaterThan(0.25);
    expect(sway(-0.3)).toBeLessThan(-0.5);
    expect(Math.abs(sway(0.6))).toBeLessThan(1);
  });
});
