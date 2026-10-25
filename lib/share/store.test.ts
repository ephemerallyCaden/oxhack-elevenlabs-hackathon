// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Transcript } from '@/types';

let dir = '';
vi.mock('@/lib/supabase', () => ({ supabase: null, get LOCAL_DIR() { return dir; } }));

const t: Transcript = {
  question: 'Should I?',
  lines: [{ id: 'l', speaker: 'judge', kind: 'opening', text: 'Order.', tts: '[calm] Order.', cites: [], audioUrl: 'data:audio/mpeg;base64,AAAA' }],
  sources: [],
};
const DAY = 24 * 3600 * 1000;
const age = async (id: string, days: number) => {
  const when = new Date(Date.now() - days * DAY);
  await utimes(join(dir, 'trials', `${id}.json`), when, when);
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roulette-trials-'));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe('saved trials (local store)', () => {
  it('saves the words only and reads them back', async () => {
    const { saveTrial, getTrial } = await import('./store');
    const id = await saveTrial(t);
    const got = await getTrial(id);
    expect(got?.lines[0].text).toBe('Order.');
    expect(got?.lines[0].audioUrl).toBeUndefined();
    expect(got?.lines[0].tts).toBeUndefined();
  });

  it('hides a trial after 7 days, and the next save deletes it', async () => {
    const { saveTrial, getTrial } = await import('./store');
    const old = await saveTrial(t);
    const fresh = await saveTrial(t);
    await age(old, 7.01);
    await age(fresh, 6.9);
    expect(await getTrial(old)).toBeNull();
    expect(await getTrial(fresh)).not.toBeNull();
    await saveTrial(t); // purges
    const files = await readdir(join(dir, 'trials'));
    expect(files).not.toContain(`${old}.json`);
    expect(files).toContain(`${fresh}.json`);
  });

  it('rejects ids that are not ours', async () => {
    const { getTrial } = await import('./store');
    expect(await getTrial('../../etc/passwd')).toBeNull();
  });
});
