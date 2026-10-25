import { describe, expect, it } from 'vitest';
import { OBJECTION, SHOT, WHIP, objectionAt, outExpo, sameShot, shotCss, vignetteAt, whipAt, whipBlur } from './whip';
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

describe('OBJECTION! pull-back', () => {
  const from = SHOT.yes, to = OBJECTION.shot;

  it('starts on the close-up and ends exactly on the wide shot', () => {
    expect(objectionAt(from, to, 0)).toEqual(from);
    expect(objectionAt(from, to, 1)).toEqual(to);
  });

  it('pulls back hard: over half-way out within the first tenth of the move', () => {
    const half = Math.exp((Math.log(from.S) + Math.log(to.S)) / 2);
    expect(objectionAt(from, to, 0.1).S).toBeLessThan(half);
  });

  it('overshoots past the wide shot, then settles back onto it', () => {
    const widest = Math.min(...Array.from({ length: 101 }, (_, i) => objectionAt(from, to, i / 100).S));
    expect(widest).toBeLessThan(to.S);
    expect(widest).toBeCloseTo(Math.exp(Math.log(to.S) - (Math.log(from.S) - Math.log(to.S)) * OBJECTION.overshoot), 2);
  });

  it('without overshoot it never goes past the wide shot', () => {
    for (let i = 0; i <= 100; i++) expect(objectionAt(from, to, i / 100, 0).S).toBeGreaterThanOrEqual(to.S - 1e-9);
  });
});

describe('OBJECTION! vignette', () => {
  it('is clear on the close-up and at full darkness on the wide shot', () => {
    expect(vignetteAt(SHOT.yes.S, SHOT.yes.S).alpha).toBe(0);
    expect(vignetteAt(SHOT.yes.S, OBJECTION.shot.S).alpha).toBeCloseTo(OBJECTION.vignette.max, 6);
    expect(vignetteAt(SHOT.yes.S, OBJECTION.shot.S).inner).toBeCloseTo(OBJECTION.vignette.inner, 6);
  });

  it('gets darker the further out the camera is', () => {
    const a = [2.2, 1.8, 1.4, 1.1, 1.0].map((S) => vignetteAt(SHOT.yes.S, S).alpha);
    a.slice(1).forEach((v, i) => expect(v).toBeGreaterThan(a[i]));
  });

  it('never goes past black, even at the overshoot', () => {
    expect(vignetteAt(SHOT.yes.S, 0.5).alpha).toBeLessThanOrEqual(1);
  });

  it('is fully dark when the interrupt starts from a shot already as wide as the pull-back', () => {
    expect(vignetteAt(OBJECTION.shot.S, OBJECTION.shot.S).alpha).toBeCloseTo(OBJECTION.vignette.max, 6);
  });
});
