import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Character from './Character';
import type { CourtActor, Expression } from './expressions';

const mount = (role: CourtActor, expression: Expression = 'idle') =>
  render(<Character role={role} mood={{ expression, talking: false }} />).container;

// Expression keyframes animate .pc-head (tremble, head jolt) and .pc-pose (breakdown shake),
// which override any inline transform on them. The side head's mirror for the defense must
// therefore live on .pc-head-in, or a left-facing head flips back mid-expression.
describe('Character side-head mirror', () => {
  it.each<Expression>(['idle', 'shocked', 'sweating', 'confident', 'breakdown'])(
    'keeps the defense mirror off the animated elements (%s)',
    (expression) => {
      const c = mount('defense', expression);
      expect(c.querySelector<HTMLElement>('[data-role]')!.dataset.head).toBe('side'); // rest pose: side head
      expect(c.querySelector<HTMLElement>('.pc-head-in')!.style.transform).toContain('scaleX(-1)');
      expect(c.querySelector<HTMLElement>('.pc-head')!.style.transform).toBe('');
      expect(c.querySelector<HTMLElement>('.pc-pose')!.style.transform).toBe('');
    },
  );

  it('does not mirror the prosecution (its art faces right, like the photo)', () => {
    const c = mount('prosecution', 'shocked');
    expect(c.querySelector<HTMLElement>('.pc-head-in')!.style.transform).toContain('scaleX(1)');
  });
});

describe('Character layering', () => {
  it('puts the head behind the suit so the neck comes out of the collar', () => {
    const c = mount('prosecution');
    const head = c.querySelector('.pc-head')!;
    const pose = c.querySelector('.pc-pose')!;
    expect(head.compareDocumentPosition(pose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('uses the pose art for each role (the defense has its own recoloured set)', () => {
    expect(mount('defense').querySelector<HTMLImageElement>('.pc-pose')!.getAttribute('src')).toBe('/assets/poses/defense/neutral1.webp');
    expect(mount('judge').querySelector<HTMLImageElement>('.pc-pose')!.getAttribute('src')).toBe('/assets/poses/judge/neutral1.webp');
  });

  it('shows crack lines only while breaking down', () => {
    expect(mount('prosecution', 'breakdown').querySelectorAll('.crack-slot')).toHaveLength(6);
    expect(mount('prosecution', 'angry').querySelectorAll('.crack-slot')).toHaveLength(0);
  });
});
