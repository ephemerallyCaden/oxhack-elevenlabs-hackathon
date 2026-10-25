import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import SpectrumBar from './SpectrumBar';

type Props = { value: number; scored: number; verdict: boolean; visible: boolean };

// A trial drives the HUD through props; every animation runs on timers, so fake timers play it out.
function mount(initial: Props) {
  const sfx = vi.fn();
  const r = render(<SpectrumBar {...initial} sfx={sfx} />);
  const el = r.container.querySelector<HTMLElement>('[data-spectrum]')!;
  const lit = (side: 'yes' | 'no') => el.querySelectorAll(`.spec-blk.on-${side}`).length;
  const value = () => el.querySelector('[data-spectrum-value]')!.textContent;
  const label = () => el.querySelector('[data-spectrum-label]')!.textContent;
  const set = async (p: Props, ms = 3000) => {
    r.rerender(<SpectrumBar {...p} sfx={sfx} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  return { el, lit, value, label, set, sfx };
}

describe('SpectrumBar in a trial', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays hidden until the trial is on screen, then drops in', async () => {
    const h = mount({ value: 0, scored: 0, verdict: false, visible: false });
    expect(h.el.classList.contains('spec-hidden')).toBe(true);
    await h.set({ value: 0, scored: 0, verdict: false, visible: true });
    expect(h.el.classList.contains('spec-hidden')).toBe(false);
    expect(h.el.classList.contains('in')).toBe(true);
    expect(h.value()).toBe('0');
    expect(h.label()).toBe('TOSS-UP');
  });

  it('plays a whole trial: rulings, a lead change, a hold, a re-weigh and the verdict', async () => {
    const h = mount({ value: 0, scored: 0, verdict: false, visible: false });
    await h.set({ value: 0, scored: 0, verdict: false, visible: true });

    await h.set({ value: 12, scored: 1, verdict: false, visible: true }); // ruling toward YES
    expect([h.lit('yes'), h.lit('no'), h.value()]).toEqual([1, 0, '+12']);
    expect(h.sfx).toHaveBeenCalledWith('needle_up', 1);

    await h.set({ value: -28, scored: 2, verdict: false, visible: true }); // lead change to NO
    expect([h.lit('yes'), h.lit('no'), h.value(), h.label()]).toEqual([0, 3, '-28', 'LEAN NO']);
    expect(h.sfx).toHaveBeenCalledWith('gasp', 0.5);

    await h.set({ value: -28, scored: 3, verdict: false, visible: true }); // a ruling that doesn't move it
    expect([h.lit('no'), h.value()]).toEqual([3, '-28']);

    await h.set({ value: -8, scored: 3, verdict: false, visible: true }); // agenda change: re-weigh
    expect([h.lit('no'), h.value(), h.label()]).toEqual([1, '-8', 'TOSS-UP']);

    await h.set({ value: 64, scored: 4, verdict: false, visible: true }); // landslide to YES
    expect([h.lit('yes'), h.lit('no'), h.value(), h.label()]).toEqual([6, 0, '+64', 'STRONG YES']);

    await h.set({ value: 64, scored: 4, verdict: true, visible: true }); // verdict: lock for YES
    expect(h.el.classList.contains('locked')).toBe(true);
    expect(h.el.classList.contains('verdict-yes')).toBe(true);
    expect(h.el.querySelectorAll('.spec-blk.dim').length).toBe(20 - 6);
  });

  it('queues changes that land close together, so each still animates in order', async () => {
    const h = mount({ value: 0, scored: 0, verdict: false, visible: false });
    await h.set({ value: 0, scored: 0, verdict: false, visible: true });
    await h.set({ value: 30, scored: 1, verdict: false, visible: true }, 0); // no time to finish…
    await h.set({ value: 30, scored: 1, verdict: true, visible: true }, 5000); // …before the verdict
    expect([h.lit('yes'), h.value()]).toEqual([3, '+30']);
    expect(h.el.classList.contains('verdict-yes')).toBe(true);
  });

  it('hitting +100 fills every YES block', async () => {
    const h = mount({ value: 0, scored: 0, verdict: false, visible: false });
    await h.set({ value: 0, scored: 0, verdict: false, visible: true });
    await h.set({ value: 100, scored: 1, verdict: false, visible: true });
    expect(h.lit('yes')).toBe(10);
  });
});
