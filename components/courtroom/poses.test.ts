import { describe, expect, it } from 'vitest';
import { POSE_ART, POSE_TUNING, nextFrame, nextTickMs, pickPose, poseOf, reactionPose } from './poses';
import type { Expression } from './expressions';

const seq = (...xs: number[]) => {
  let i = 0;
  return () => xs[i++ % xs.length];
};

describe('pickPose', () => {
  it('never repeats the current pose', () => {
    for (const expr of ['idle', 'confident', 'angry', 'sweating', 'shocked', 'breakdown'] as Expression[]) {
      for (const current of ['neutral1', 'neutral2', 'confident1', 'shocked1', 'breakdown1']) {
        for (let r = 0; r < 1; r += 0.05) expect(pickPose(expr, current, () => r)).not.toBe(current);
      }
    }
  });

  it('draws from neutrals plus the expression set', () => {
    const seen = (expr: Expression) => new Set(Array.from({ length: 40 }, (_, i) => pickPose(expr, 'none', () => i / 40)));
    expect(seen('idle')).toEqual(new Set(['neutral1', 'neutral2']));
    expect(seen('confident')).toEqual(new Set(['confident1', 'confident2', 'neutral1', 'neutral2']));
    expect(seen('angry')).toEqual(new Set(['confident1', 'confident2', 'neutral1', 'neutral2'])); // no angry art yet
    expect(seen('sweating')).toEqual(new Set(['sweating1', 'sweating2', 'neutral1', 'neutral2']));
  });

  it('favours the reaction pose ~70% of the time when shocked or breaking down', () => {
    expect(pickPose('shocked', 'neutral1', seq(0.69, 0))).toBe('shocked1');
    expect(pickPose('shocked', 'neutral1', seq(0.71, 0))).toBe('neutral2');
    expect(pickPose('breakdown', 'neutral2', seq(0.5, 0))).toBe('breakdown1');
    // Already in the reaction pose: switch to a neutral (no repeats).
    expect(pickPose('breakdown', 'breakdown1', seq(0.1, 0))).toBe('neutral1');
  });

  it('falls back to idle for an unknown expression', () => {
    expect(['neutral1', 'neutral2']).toContain(pickPose('unknown' as Expression, 'x', () => 0.3));
  });
});

describe('timing', () => {
  it('ticks every ~1-3s while talking', () => {
    expect(nextTickMs(() => 0)).toBe(POSE_TUNING.tick.min);
    expect(nextTickMs(() => 0.999)).toBeLessThan(POSE_TUNING.tick.max);
    expect(POSE_TUNING.tick.min).toBeGreaterThanOrEqual(900);
    expect(POSE_TUNING.tick.max).toBeLessThanOrEqual(3200);
  });

  it('jumps straight to the reaction pose', () => {
    expect(reactionPose('shocked')).toBe('shocked1');
    expect(reactionPose('breakdown')).toBe('breakdown1');
    expect(reactionPose('confident')).toBeUndefined();
  });
});

describe('frames', () => {
  const p = (pose: string) => poseOf('prosecution', pose);

  it('loops neutral2 and holds the last frame of confident2 / shocked1', () => {
    expect(p('neutral2').anim).toBe('loop');
    expect([0, 1, 2].map((f) => nextFrame(p('neutral2'), f))).toEqual([1, 2, 0]);
    for (const pose of ['confident2', 'shocked1']) {
      expect(p(pose).anim).toBe('once-hold');
      expect(nextFrame(p(pose), 0)).toBe(1);
      expect(nextFrame(p(pose), 1)).toBe(1);
    }
    expect(nextFrame(p('neutral1'), 0)).toBe(0);
  });

  it('marks front heads (blue markers) and side heads (red markers)', () => {
    expect(p('neutral2').head).toBe('front');
    expect(p('sweating1').head).toBe('front');
    expect(p('neutral1').head).toBe('side');
    expect(poseOf('judge', 'neutral1').head).toBe('front');
  });

  it('mirrors the defense art and its head markers', () => {
    const pros = POSE_ART.prosecution;
    const def = POSE_ART.defense;
    expect(def.faces).toBe('left');
    expect(def.poses.neutral1.centres[0][0]).toBeCloseTo(def.width - pros.poses.neutral1.centres[0][0], 0);
    expect(def.poses.neutral1.frames[0]).toBe('/assets/poses/defense/neutral1.webp');
  });

  it('falls back to the rest pose for an unknown name', () => {
    expect(p('nope')).toBe(p('neutral1'));
  });
});
