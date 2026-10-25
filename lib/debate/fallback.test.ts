import { describe, expect, it, vi } from 'vitest';
import { anySignal, withFallback } from './fallback';

describe('withFallback and the caller’s signal', () => {
  it('falls back at once when the caller aborts mid-call, and aborts the work', async () => {
    const outer = new AbortController();
    let workSignal: AbortSignal | undefined;
    const p = withFallback((s) => ((workSignal = s), new Promise<string>(() => {})), 'mock', 10_000, 'test', outer.signal);
    outer.abort();
    await expect(p).resolves.toEqual({ value: 'mock', fallback: true });
    expect(workSignal?.aborted).toBe(true);
  });

  it('does no work at all when the caller already gave up', async () => {
    const outer = new AbortController();
    outer.abort();
    const work = vi.fn(async () => 'real');
    await expect(withFallback(work, 'mock', 1000, 'test', outer.signal)).resolves.toEqual({ value: 'mock', fallback: true });
    expect(work).not.toHaveBeenCalled();
  });

  it('removes its listener once the work succeeds', async () => {
    const outer = new AbortController();
    const remove = vi.spyOn(outer.signal, 'removeEventListener');
    await expect(withFallback(async () => 'real', 'mock', 1000, 'test', outer.signal)).resolves.toEqual({ value: 'real', fallback: false });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('anySignal', () => {
  for (const native of [true, false]) {
    it(`aborts when any input does (${native ? 'AbortSignal.any' : 'fallback'})`, () => {
      const any = AbortSignal.any;
      if (!native) (AbortSignal as { any?: unknown }).any = undefined;
      try {
        const a = new AbortController();
        const b = new AbortController();
        const both = anySignal(a.signal, b.signal);
        expect(both.aborted).toBe(false);
        b.abort();
        expect(both.aborted).toBe(true);
        const pre = new AbortController();
        pre.abort();
        expect(anySignal(new AbortController().signal, pre.signal).aborted).toBe(true);
      } finally {
        (AbortSignal as { any?: unknown }).any = any;
      }
    });
  }
});
