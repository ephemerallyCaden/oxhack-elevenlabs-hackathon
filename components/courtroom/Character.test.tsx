import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import Character from './Character';
import type { Expression } from './expressions';

// Expression keyframes (shocked, sweating, confident, breakdown) animate `.char-pose`'s
// transform, which overrides any inline transform on it. The facing-left mirror must
// therefore live on a wrapper, or a left-facing character flips back mid-expression.
describe('Character facing-left mirror', () => {
  const pose = (expression: Expression) => {
    const { container } = render(
      <Character role="defense" mood={{ expression, talking: false }} facing="left" faceSrc="/assets/face.png" />,
    );
    return container.querySelector<HTMLImageElement>('.char-pose')!;
  };

  it.each<Expression>(['idle', 'shocked', 'sweating', 'confident', 'breakdown'])(
    'keeps the mirror off the animated pose element (%s)',
    (expression) => {
      const img = pose(expression);
      expect(img.style.transform).toBe('');
      expect(img.parentElement!.style.transform).toBe('scaleX(-1)');
    },
  );

  it('does not mirror front or right-facing characters', () => {
    for (const facing of ['front', 'right'] as const) {
      const { container } = render(
        <Character role="prosecution" mood={{ expression: 'shocked', talking: false }} facing={facing} faceSrc="/assets/face.png" />,
      );
      const img = container.querySelector<HTMLImageElement>('.char-pose')!;
      expect(img.style.transform).toBe('');
      expect(img.parentElement!.style.transform).toBe('');
    }
  });
});
