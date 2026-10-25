import { describe, expect, it } from 'vitest';
import { asPerson, frontFit, guideBox, hairTop, rowExtent, sideFit, type Mask } from './headCut';
import { FRONT_FRAME, SIDE_FRAME } from '@/components/courtroom/heads';

/** A person mask from a predicate over (x, y). */
function mask(w: number, h: number, inside: (x: number, y: number) => boolean): Mask {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = inside(x, y) ? 1 : 0;
  return { data, width: w, height: h };
}

// A head: circle centred (200, 150) radius 60 → hair at y=90.
const head = mask(400, 400, (x, y) => (x - 200) ** 2 + (y - 150) ** 2 <= 60 ** 2);

describe('mask helpers', () => {
  it('finds the top of the hair and row extents', () => {
    expect(hairTop(head, 150, 250)).toBe(90);
    expect(rowExtent(head, 150)).toEqual([140, 260]);
    expect(rowExtent(head, 10)).toBeNull();
  });

  it('flips an inverted mask so the face reads as person', () => {
    const inverted = { ...head, data: head.data.map((v) => 1 - v) };
    expect(hairTop(asPerson(inverted, { x: 200, y: 150 }), 150, 250)).toBe(90);
    expect(asPerson(head, { x: 200, y: 150 })).toBe(head);
  });
});

describe('frontFit', () => {
  const face = {
    chin: { x: 200, y: 210 },
    left: { x: 145, y: 150 },
    right: { x: 255, y: 150 },
    mouth: { x: 200, y: 190 },
    eyes: [{ x: 225, y: 140 }, { x: 175, y: 140 }] as [{ x: number; y: number }, { x: number; y: number }],
  };
  const r = frontFit(face, 90);

  it('crops hair → chin into the front frame, centred between the cheeks', () => {
    expect(r.box.sy).toBe(90);
    expect(r.box.sh).toBe(120);
    expect(r.box.sw / r.box.sh).toBeCloseTo(FRONT_FRAME.w / FRONT_FRAME.h);
    expect(r.box.sx + r.box.sw / 2).toBeCloseTo(200);
  });

  it('measures the mouth line and eyes as fractions of the frame (left eye first)', () => {
    expect(r.spec.lipY).toBeCloseTo(100 / 120);
    expect(r.spec.eyes[0][0]).toBeLessThan(0.5);
    expect(r.spec.eyes[1][0]).toBeGreaterThan(0.5);
    expect(r.spec.eyes[0][1]).toBeCloseTo(50 / 120);
    expect(r.fit).toEqual({ hc: 120, lip: 100 / 120, eye: 50 / 120 });
  });
});

describe('sideFit', () => {
  it('uses the front head height so both heads come out the same size', () => {
    const fit = { hc: 120, lip: 0.8, eye: 0.42 };
    const r = sideFit(head, fit)!;
    expect(r.box.sy).toBe(90); // hair
    // the chin (hair + hc) lands on the frame's chin line
    expect((r.box.sh * SIDE_FRAME.chin) / SIDE_FRAME.h).toBeCloseTo(120);
    expect(r.box.sx + r.box.sw / 2).toBeCloseTo(200, 0);
    expect(r.spec.anchorY).toBeCloseTo(0.5 * (SIDE_FRAME.chin / SIDE_FRAME.h));
    expect(r.spec.lipY).toBeCloseTo(0.8 * (SIDE_FRAME.chin / SIDE_FRAME.h));
    expect(r.spec.eyes).toHaveLength(1);
    expect(r.spec.eyes[0][0]).toBeGreaterThan(0.5); // the profile faces right
  });

  it('gives up on an empty mask', () => {
    expect(sideFit(mask(100, 100, () => false), { hc: 50, lip: 0.8, eye: 0.4 })).toBeNull();
  });
});

describe('guideBox', () => {
  it('is centred with the frame aspect', () => {
    for (const kind of ['front', 'side'] as const) {
      const b = guideBox(kind, 1280, 720);
      const f = kind === 'front' ? FRONT_FRAME : SIDE_FRAME;
      expect(b.sw / b.sh).toBeCloseTo(f.w / f.h);
      expect(b.sx + b.sw / 2).toBeCloseTo(640);
      expect(b.sy + b.sh / 2).toBeCloseTo(360);
    }
  });
});
