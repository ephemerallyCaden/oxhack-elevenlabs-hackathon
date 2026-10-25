import { describe, expect, it } from 'vitest';
import { SHOT, WHIP, outExpo, sameShot, shotCss, whipAt, whipBlur } from './whip';
import { pathAt, camTransform } from './intro';

describe('camera shots', () => {
  it('keep the validated framings (translate % of the 960×540 stage)', () => {
    expect(shotCss(SHOT.judge)).toBe(`scale(2) translate(0px, ${-0.079 * 540}px)`);
    expect(SHOT.yes.tx).toBeCloseTo(208.32, 2);
    expect(SHOT.no.tx).toBeCloseTo(-206.4, 2);
  });

  it('the intro lands exactly on the witness shot, so the first whip starts from there', () => {
    const end = pathAt(1);
    const [S, tx, ty] = camTransform(end).match(/-?[\d.]+/g)!.map(Number);
    expect(S).toBeCloseTo(SHOT.witness.S, 6);
    expect(tx).toBeCloseTo(SHOT.witness.tx, 2);
    expect(ty).toBeCloseTo(SHOT.witness.ty, 2);
  });
});

describe('whip pan', () => {
  it('starts at the old shot, ends exactly on the new one', () => {
    expect(sameShot(whipAt(SHOT.yes, SHOT.judge, 0), SHOT.yes)).toBe(true);
    expect(sameShot(whipAt(SHOT.yes, SHOT.judge, 1), SHOT.judge)).toBe(true);
  });

  it('is very-fast-start: most of the travel happens in the first third', () => {
    expect(outExpo(0.3)).toBeGreaterThan(0.85);
    const mid = whipAt(SHOT.yes, SHOT.no, 0.3);
    expect(Math.abs(mid.tx - SHOT.no.tx)).toBeLessThan(Math.abs(SHOT.yes.tx - SHOT.no.tx) * 0.15);
  });

  it('blurs only while moving, peaking mid-move at the tuned 10px', () => {
    expect(whipBlur(0)).toBe(0);
    expect(whipBlur(1)).toBeCloseTo(0, 6);
    expect(whipBlur(0.5)).toBeCloseTo(WHIP.blurPx, 6);
    expect(WHIP).toEqual({ ms: 200, blurPx: 10 });
  });
});
