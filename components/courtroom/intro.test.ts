import { describe, expect, it } from 'vitest';
import { INTRO, ORIGIN, PLANES, blurAmount, camTransform, pathAt, planeOffset, springAt } from './intro';

const STAGE = { w: 960, h: 540 };

describe('intro camera path', () => {
  it('lands exactly on today\'s witness view: scale(1.4) translate(0.1%, -14.3%)', () => {
    const end = pathAt(1);
    const [S, tx, ty] = camTransform(end).match(/-?[\d.]+/g)!.map(Number);
    expect(S).toBeCloseTo(1.4, 6);
    expect(tx).toBeCloseTo(0.001 * STAGE.w, 2); // 0.1% of 960 = 0.96px
    expect(ty).toBeCloseTo(-0.143 * STAGE.h, 2); // -14.3% of 540 = -77.22px
  });

  it('starts at the start zoom with the frame bottom on the image\'s bottom row', () => {
    const start = pathAt(0);
    expect(start.S).toBeCloseTo(INTRO.startZoom, 6);
    expect(start.cy + ORIGIN.y / start.S).toBeCloseTo(1024.14, 2);
  });

  it('pulls back mid-move (room opens up) and pushes in by the end', () => {
    const mid = pathAt(0.5);
    expect(mid.S).toBeLessThan(pathAt(0).S);
    expect(mid.S).toBeLessThan(pathAt(1).S);
  });
});

describe('depth planes', () => {
  it('are ordered back to front, far wall first', () => {
    expect(PLANES[0]).toMatchObject({ name: 'far', weight: 0 });
    const w = PLANES.map((p) => p.weight);
    expect([...w].sort((a, b) => a - b)).toEqual(w);
  });

  it('are untouched at rest, so the scene matches the flat background exactly', () => {
    for (const p of PLANES) expect(planeOffset(p.weight, 0)).toEqual({ dy: -0, scale: 1 });
  });

  it('nearer planes start lifted higher and smaller (parallax)', () => {
    const near = planeOffset(1, 1), mid = planeOffset(0.3, 1);
    expect(near.dy).toBeLessThan(mid.dy);
    expect(near.scale).toBeLessThan(mid.scale);
    expect(planeOffset(0, 1)).toEqual({ dy: -0, scale: 1 }); // far wall never moves
  });

  it('the far plane covers the whole frame at every point of the move (no empty stage)', () => {
    const far = PLANES[0].style;
    for (let e = 0; e <= 1.06; e += 0.01) {
      const { S, cx, cy } = pathAt(e);
      const halfW = ORIGIN.x / S, halfH = ORIGIN.y / S;
      expect(cx - halfW).toBeGreaterThanOrEqual(far.left);
      expect(cx + halfW).toBeLessThanOrEqual(far.left + far.width);
      expect(cy - halfH).toBeGreaterThanOrEqual(far.top);
      expect(cy + halfH).toBeLessThanOrEqual(far.top + far.height);
    }
  });
});

describe('landing + blur', () => {
  it('overshoots past the landing and settles back', () => {
    expect(springAt(0)).toBe(1);
    const peak = Math.max(...Array.from({ length: 300 }, (_, t) => springAt(t)));
    expect(peak).toBeGreaterThan(1.01);
    expect(Math.abs(springAt(INTRO.springMs) - 1)).toBeLessThan(0.005);
  });

  it('blur scales with speed and is capped', () => {
    expect(blurAmount(0)).toBe(0);
    expect(blurAmount(1)).toBeCloseTo(INTRO.blur / 2.5, 6);
    expect(blurAmount(100)).toBe(INTRO.blur);
  });
});
