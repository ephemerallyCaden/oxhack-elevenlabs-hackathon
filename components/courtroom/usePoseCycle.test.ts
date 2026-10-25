import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePoseCycle } from './usePoseCycle';
import type { CharacterMood, CourtActor, Expression } from './expressions';
import { POSE_TUNING } from './poses';

type Props = { role: CourtActor; mood: CharacterMood; interrupting?: boolean };
const mood = (expression: Expression, talking: boolean): CharacterMood => ({ expression, talking });

function setup(initial: Props) {
  return renderHook((p: Props) => usePoseCycle(p.role, p.mood, p.interrupting), { initialProps: initial });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePoseCycle', () => {
  it('changes pose every tick while talking, never repeating', () => {
    // Fixed random: every tick lands exactly `tick` ms after the last.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const tick = POSE_TUNING.tick.min + 0.5 * (POSE_TUNING.tick.max - POSE_TUNING.tick.min);
    const h = setup({ role: 'prosecution', mood: mood('confident', true) });
    const poses = [h.result.current.pose];
    for (let i = 0; i < 8; i++) {
      act(() => vi.advanceTimersByTime(tick));
      poses.push(h.result.current.pose);
    }
    vi.restoreAllMocks();
    for (let i = 1; i < poses.length; i++) expect(poses[i]).not.toBe(poses[i - 1]);
  });

  it('does not change before the minimum tick', () => {
    const h = setup({ role: 'prosecution', mood: mood('idle', true) });
    act(() => vi.advanceTimersByTime(POSE_TUNING.tick.min - 10));
    expect(h.result.current.pose).toBe('neutral1');
  });

  it('holds the pose when not talking', () => {
    const h = setup({ role: 'prosecution', mood: mood('confident', true) });
    act(() => vi.advanceTimersByTime(POSE_TUNING.tick.max));
    const held = h.result.current.pose;
    h.rerender({ role: 'prosecution', mood: mood('confident', false) });
    act(() => vi.advanceTimersByTime(POSE_TUNING.tick.max * 5));
    expect(h.result.current.pose).toBe(held);
  });

  it('a silent lawyer who becomes shocked jumps to the pose at once', () => {
    const h = setup({ role: 'defense', mood: mood('idle', false) });
    h.rerender({ role: 'defense', mood: mood('shocked', false) });
    expect(h.result.current.pose).toBe('shocked1');
    h.rerender({ role: 'defense', mood: mood('breakdown', false) });
    expect(h.result.current.pose).toBe('breakdown1');
  });

  it('a talking lawyer waits for the next tick', () => {
    const h = setup({ role: 'defense', mood: mood('idle', true) });
    h.rerender({ role: 'defense', mood: mood('shocked', true) });
    expect(h.result.current.pose).toBe('neutral1');
  });

  it('an interrupt turns everyone to the front-facing neutral and stops the ticks', () => {
    const h = setup({ role: 'prosecution', mood: mood('confident', true) });
    h.rerender({ role: 'prosecution', mood: mood('confident', true), interrupting: true });
    expect(h.result.current.pose).toBe('neutral2');
    expect(h.result.current.spec.head).toBe('front');
    act(() => vi.advanceTimersByTime(POSE_TUNING.tick.max * 3));
    expect(h.result.current.pose).toBe('neutral2');
  });

  it('plays animated poses at 200ms a frame: once-hold stops on the last frame', () => {
    const h = setup({ role: 'prosecution', mood: mood('idle', false) });
    h.rerender({ role: 'prosecution', mood: mood('shocked', false) });
    expect(h.result.current.frame).toBe(0);
    act(() => vi.advanceTimersByTime(200));
    expect(h.result.current.frame).toBe(1);
    act(() => vi.advanceTimersByTime(1000));
    expect(h.result.current.frame).toBe(1);
  });

  it('loops neutral2', () => {
    const h = setup({ role: 'prosecution', mood: mood('idle', false), interrupting: false });
    h.rerender({ role: 'prosecution', mood: mood('idle', false), interrupting: true });
    const frames = [h.result.current.frame];
    for (let i = 0; i < 4; i++) {
      act(() => vi.advanceTimersByTime(200));
      frames.push(h.result.current.frame);
    }
    expect(frames).toEqual([0, 1, 2, 0, 1]);
  });

  it('keeps the Judge on one pose', () => {
    const h = setup({ role: 'judge', mood: mood('shocked', true) });
    act(() => vi.advanceTimersByTime(POSE_TUNING.tick.max * 3));
    expect(h.result.current.pose).toBe('neutral1');
  });
});
