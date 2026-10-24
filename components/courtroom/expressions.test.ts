import { describe, expect, it } from 'vitest';
import { deriveMoods, type MoodInputs } from './expressions';
import type { Line, Topic } from '@/types';

let n = 0;
function line(partial: Partial<Line>): Line {
  return { id: `l${++n}`, speaker: 'prosecution', kind: 'argument', text: '…', cites: [], ...partial };
}

function topic(t: number): Topic {
  return {
    id: 't1',
    title: 'Money',
    question: 'Can you afford it?',
    importance: 1,
    research_speed: 'quick',
    status: 'done',
    added_by: 'judge',
    score: { t, confidence: 0.8, reasoning: '', deciding_argument: '' },
  };
}

/** Build a state where `lines` have been said and the last one is playing. */
function playing(lines: Line[], partial: Partial<MoodInputs> = {}): MoodInputs {
  return {
    phase: 'speaking',
    transcript: lines,
    current: lines.at(-1),
    agenda: [],
    spectrum: { value: 0, label: 'Toss-up' },
    ...partial,
  };
}

describe('deriveMoods', () => {
  it('a plain argument: speaker talks, everyone idle', () => {
    const m = deriveMoods(playing([line({ speaker: 'prosecution' })]));
    expect(m.prosecution).toEqual({ expression: 'idle', talking: true });
    expect(m.defense).toEqual({ expression: 'idle', talking: false });
    expect(m.judge).toEqual({ expression: 'idle', talking: false });
  });

  it('cut_in: cutter angry AND talking, cut-off side shocked', () => {
    const m = deriveMoods(playing([line({ speaker: 'prosecution' }), line({ speaker: 'defense', kind: 'cut_in' })]));
    expect(m.defense).toEqual({ expression: 'angry', talking: true });
    expect(m.prosecution).toEqual({ expression: 'shocked', talking: false });
  });

  it('talking does not override expressions: shocked side stays shocked while it resumes', () => {
    const m = deriveMoods(
      playing([
        line({ speaker: 'prosecution' }),
        line({ speaker: 'defense', kind: 'cut_in' }),
        line({ speaker: 'prosecution', kind: 'resume' }),
      ]),
    );
    expect(m.prosecution).toEqual({ expression: 'shocked', talking: true });
    expect(m.defense).toEqual({ expression: 'angry', talking: false });
  });

  it('reactions clear on the next fresh argument', () => {
    const m = deriveMoods(
      playing([
        line({ speaker: 'prosecution' }),
        line({ speaker: 'defense', kind: 'cut_in' }),
        line({ speaker: 'prosecution', kind: 'resume' }),
        line({ speaker: 'defense', kind: 'argument' }),
      ]),
    );
    expect(m.prosecution.expression).toBe('idle');
    expect(m.defense).toEqual({ expression: 'idle', talking: true });
  });

  it('user interrupt: target angry while listening, still angry while answering', () => {
    const before = [line({ speaker: 'defense' })];
    const listening = deriveMoods({ ...playing(before), phase: 'listening', interruptTarget: 'defense' });
    expect(listening.defense).toEqual({ expression: 'angry', talking: false });

    const answering = deriveMoods(
      playing([...before, line({ speaker: 'user', kind: 'user' }), line({ speaker: 'defense', kind: 'answer' })]),
    );
    expect(answering.defense).toEqual({ expression: 'angry', talking: true });
  });

  it('score: winner confident, loser sweating; held through the next intro', () => {
    const score = line({ speaker: 'judge', kind: 'score', topic_id: 't1' });
    const s = playing([line({ speaker: 'defense' }), score], { agenda: [topic(-0.6)] });
    let m = deriveMoods(s);
    expect(m.defense.expression).toBe('confident');
    expect(m.prosecution.expression).toBe('sweating');
    expect(m.judge).toEqual({ expression: 'idle', talking: true });

    m = deriveMoods(playing([...s.transcript, line({ speaker: 'judge', kind: 'intro' })], { agenda: [topic(-0.6)] }));
    expect(m.prosecution.expression).toBe('sweating');
    expect(m.judge.talking).toBe(true);
  });

  it('score toss-up: no reaction', () => {
    const m = deriveMoods(playing([line({ speaker: 'judge', kind: 'score', topic_id: 't1' })], { agenda: [topic(0.05)] }));
    expect(m.prosecution.expression).toBe('idle');
    expect(m.defense.expression).toBe('idle');
  });

  it('verdict: winner confident, loser breaks down, judge talks; held after the trial ends', () => {
    const spectrum = { value: 62, label: 'Strong yes' as const };
    const verdictLine = line({ speaker: 'judge', kind: 'verdict' });
    const m = deriveMoods(playing([verdictLine], { spectrum }));
    expect(m.prosecution.expression).toBe('confident');
    expect(m.defense.expression).toBe('breakdown');
    expect(m.judge.talking).toBe(true);

    const done = deriveMoods({ ...playing([verdictLine], { spectrum }), phase: 'done' });
    expect(done.defense).toEqual({ expression: 'breakdown', talking: false });
  });

  it('verdict toss-up: nobody gloats', () => {
    const m = deriveMoods(playing([line({ speaker: 'judge', kind: 'verdict' })], { spectrum: { value: 5, label: 'Toss-up' } }));
    expect(m.prosecution.expression).toBe('idle');
    expect(m.defense.expression).toBe('idle');
  });

  it('nobody talks outside the speaking phase', () => {
    for (const phase of ['ask', 'preparing', 'thinking', 'done'] as const) {
      const m = deriveMoods({ ...playing([line({})]), phase });
      expect(m.prosecution.talking).toBe(false);
    }
  });
});
