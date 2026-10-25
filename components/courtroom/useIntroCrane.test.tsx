import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useIntroCrane, type IntroMode } from './useIntroCrane';
import { planeTransform } from './intro';

function Harness({ mode }: { mode: IntroMode }) {
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const shaker = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  useIntroCrane({ stage, camera, shaker, ghosts, lines }, mode);
  return (
    <div ref={stage} data-testid="stage">
      <div ref={shaker}>
        <div ref={camera}>
          <div data-plane="floor" data-weight="1" />
        </div>
      </div>
      <div ref={ghosts} />
      <div ref={lines} />
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useIntroCrane', () => {
  it('reveals the stage (data-ready) and holds the planes at the carpet frame', () => {
    const { getByTestId, container } = render(<Harness mode="hold" />);
    expect(getByTestId('stage').hasAttribute('data-ready')).toBe(true);
    expect(getByTestId('stage').dataset.intro).toBe('hold');
    expect(container.querySelector<HTMLElement>('[data-plane]')!.style.transform).toBe(planeTransform(1, 1));
  });

  it('puts the planes back at rest if the crane is cut off mid-play (play → none)', () => {
    // jsdom has neither: full motion, frames on a timer.
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    const { getByTestId, container, rerender } = render(<Harness mode="hold" />);
    rerender(<Harness mode="play" />);
    expect(getByTestId('stage').dataset.intro).toBe('crane');
    rerender(<Harness mode={null} />);
    expect(container.querySelector<HTMLElement>('[data-plane]')!.style.transform).toBe(planeTransform(1, 0));
  });

  it('puts the planes back at rest if the trial ends before the crane plays (hold → none)', () => {
    const { getByTestId, container, rerender } = render(<Harness mode="hold" />);
    rerender(<Harness mode={null} />);
    expect(getByTestId('stage').dataset.intro).toBe('done');
    expect(container.querySelector<HTMLElement>('[data-plane]')!.style.transform).toBe(planeTransform(1, 0));
  });
});
