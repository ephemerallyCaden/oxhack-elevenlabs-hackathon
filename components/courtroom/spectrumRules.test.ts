import { describe, expect, it } from 'vitest';
import { BAR, blocksOf, causeOf, labelOf, planMove, verdictSide } from './spectrumRules';

describe('spectrum HUD blocks', () => {
  it('one block per 10 points from the centre, NO negative, YES positive, capped at the ends', () => {
    expect(blocksOf(0)).toBe(0);
    expect(blocksOf(12)).toBe(1);
    expect(blocksOf(-28)).toBe(-3);
    expect(blocksOf(64)).toBe(6);
    expect(blocksOf(100)).toBe(BAR.side);
    expect(blocksOf(-140)).toBe(-BAR.side);
  });

  it('uses the trial’s own labels, upper-cased', () => {
    expect([-80, -30, 0, 30, 80].map(labelOf)).toEqual(['STRONG NO', 'LEAN NO', 'TOSS-UP', 'LEAN YES', 'STRONG YES']);
  });
});

describe('what moved the bar', () => {
  const s = (value: number, scored = 0, verdict = false) => ({ value, scored, verdict });
  it('a newly scored topic is a ruling, even when the value doesn’t move', () => {
    expect(causeOf(s(0), s(18, 1))).toBe('ruling');
    expect(causeOf(s(-28, 2), s(-28, 3))).toBe('ruling');
  });
  it('a value change without a new score is a re-weigh (topic added or removed)', () => {
    expect(causeOf(s(-28, 3), s(-8, 3))).toBe('reweigh');
  });
  it('the verdict wins over everything else', () => {
    expect(causeOf(s(64, 4), s(60, 4, true))).toBe('verdict');
  });
  it('nothing the bar shows changed: no animation', () => {
    expect(causeOf(s(10, 1), s(10, 1))).toBeNull();
  });
});

describe('how a move plays', () => {
  it('a small ruling steps toward the side, with a signed chip', () => {
    const p = planMove(0, 12, 'ruling');
    expect(p).toMatchObject({ hold: false, lead: false, swing: false, wall: false, sound: 'needle_up' });
    expect(p.chip).toEqual({ text: '+12', tone: 'yes', big: false });
  });
  it('a big ruling is a swing: shake + big chip', () => {
    const p = planMove(10, -24, 'ruling');
    expect(p.swing).toBe(true);
    expect(p.sound).toBe('needle_down');
  });
  it('crossing the centre is a lead change', () => {
    const p = planMove(12, -28, 'ruling');
    expect(p.lead).toBe(true);
    expect(p.chip).toEqual({ text: 'LEAD CHANGE!', tone: 'gold', big: true });
  });
  it('coming off zero is not a lead change', () => {
    expect(planMove(0, -28, 'ruling').lead).toBe(false);
    expect(planMove(3, -28, 'ruling').lead).toBe(false); // 3 is still block 0
  });
  it('no whole-block change holds: “HOLDS” when nothing moved, else the small delta', () => {
    expect(planMove(-28, -28, 'ruling')).toMatchObject({ hold: true, chip: { text: 'HOLDS', tone: 'gold' } });
    expect(planMove(20, 23, 'ruling')).toMatchObject({ hold: true, chip: { text: '+3', tone: 'yes' } });
  });
  it('a re-weigh is quieter and never a swing', () => {
    const p = planMove(-28, 20, 'reweigh');
    expect(p.swing).toBe(false);
    expect(p.sound).toBe('blip');
    expect(p.chip?.text).toBe('LEAD CHANGE!'); // still crosses the centre
    expect(planMove(-28, -8, 'reweigh').chip).toEqual({ text: 'RE-WEIGHED', tone: 'grey', big: false });
  });
  it('reaching ±100 hits the wall', () => {
    expect(planMove(60, 100, 'ruling').wall).toBe(true);
    expect(planMove(-60, -97, 'ruling').wall).toBe(true);
    expect(planMove(60, 90, 'ruling').wall).toBe(false);
  });
  it('the verdict landing on the current value needs no chip', () => {
    expect(planMove(64, 64, 'verdict').chip).toBeNull();
  });
});

describe('verdict side', () => {
  it('toss-up keeps the frame gold; otherwise the winner', () => {
    expect([-64, -19, 0, 19, 64].map(verdictSide)).toEqual(['no', 'tie', 'tie', 'tie', 'yes']);
  });
});
