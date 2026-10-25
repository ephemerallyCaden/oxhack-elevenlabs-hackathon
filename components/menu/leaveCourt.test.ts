import { describe, expect, it, vi } from 'vitest';
import { leaveCourt } from './leaveCourt';

function store(init: Record<string, string>): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
    ...Object.fromEntries(m),
  } as Storage;
}

describe('leaveCourt', () => {
  it('Main menu: signs out, clears this tab, then navigates', async () => {
    const order: string[] = [];
    const s = store({ 'roulette.voiceId': 'v', 'roulette.heads': 'h', 'sb-roulette-auth': 't', other: 'keep' });
    await leaveCourt('/', { signOut: async () => void order.push('signOut'), assign: (h) => order.push(`go:${h}`), storage: s });
    expect(order).toEqual(['signOut', 'go:/']);
    expect(s.getItem('roulette.voiceId')).toBeNull();
    expect(s.getItem('sb-roulette-auth')).toBeNull();
    expect(s.getItem('other')).toBe('keep');
  });

  it('Main menu still leaves when sign-out hangs or fails', async () => {
    const assign = vi.fn();
    await leaveCourt('/', { signOut: () => new Promise(() => {}), assign, waitMs: 20, storage: store({}) });
    expect(assign).toHaveBeenCalledWith('/');
    await leaveCourt('/', { signOut: () => Promise.reject(new Error('offline')), assign, storage: store({}) });
    expect(assign).toHaveBeenCalledTimes(2);
  });

  it('New case keeps the sign-in and the tab (voice, faces, profile)', async () => {
    const signOut = vi.fn(async () => {});
    const assign = vi.fn();
    await leaveCourt('/?again=1', { signOut, assign, storage: store({ 'roulette.voiceId': 'v' }) });
    expect(signOut).not.toHaveBeenCalled();
    expect(assign).toHaveBeenCalledWith('/?again=1');
  });

  it('ignores a second click while the first is signing out', async () => {
    const assign = vi.fn();
    let release!: () => void;
    const first = leaveCourt('/', { signOut: () => new Promise<void>((r) => (release = r)), assign, storage: store({}) });
    await leaveCourt('/', { signOut: async () => {}, assign, storage: store({}) });
    release();
    await first;
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
