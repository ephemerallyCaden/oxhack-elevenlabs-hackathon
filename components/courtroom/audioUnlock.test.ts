import { describe, expect, it } from 'vitest';
import { unlockSoon } from './audioUnlock';

describe('unlockSoon', () => {
  it('true when audio unlocks', async () => expect(await unlockSoon(async () => {})).toBe(true));
  it('false when it rejects (Safari without a gesture)', async () => expect(await unlockSoon(() => Promise.reject(new Error('NotAllowed')))).toBe(false));
  it('false when it hangs, after the wait', async () => expect(await unlockSoon(() => new Promise(() => {}), 20)).toBe(false));
});
