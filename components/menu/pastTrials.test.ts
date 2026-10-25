import { beforeEach, describe, expect, it } from 'vitest';
import { addPastTrial, parsePastTrials, pastTrialsRaw } from './pastTrials';

const DAY = 24 * 3600 * 1000;
beforeEach(() => localStorage.clear());

describe('past trials on this laptop', () => {
  it('lists the newest first, once each', () => {
    const now = Date.now();
    addPastTrial({ id: 'a', question: 'Should I move?', value: -18, label: 'Lean no', at: now - DAY });
    addPastTrial({ id: 'b', question: 'Should I quit?', value: 34, label: 'Lean yes', at: now });
    addPastTrial({ id: 'a', question: 'Should I move?', value: -18, label: 'Lean no', at: now });
    expect(parsePastTrials(pastTrialsRaw()).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('drops trials older than the 7 days shared trials are kept', () => {
    const now = Date.now();
    localStorage.setItem('roulette.trials', JSON.stringify([
      { id: 'old', question: 'q', value: 0, label: 'Toss-up', at: now - 8 * DAY },
      { id: 'new', question: 'q', value: 0, label: 'Toss-up', at: now - 6 * DAY },
    ]));
    expect(parsePastTrials(pastTrialsRaw(now)).map((t) => t.id)).toEqual(['new']);
  });

  it('survives junk in storage', () => {
    localStorage.setItem('roulette.trials', '{not json');
    expect(parsePastTrials(pastTrialsRaw())).toEqual([]);
  });
});

describe('verdictSide', () => {
  it('reads the side from the court’s label', async () => {
    const { verdictSide } = await import('./pastTrials');
    expect(['Strong yes', 'Lean yes', 'Toss-up', 'Lean no', 'Strong no'].map(verdictSide)).toEqual(['yes', 'yes', null, 'no', 'no']);
  });
});
