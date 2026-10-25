// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

const calls: [string, AbortSignal | undefined][] = [];
vi.mock('@/lib/debate/trial', () => {
  const rec = (name: string) => async (_req: unknown, signal?: AbortSignal) => (calls.push([name, signal]), { ok: name });
  return { buildSetup: rec('setup'), writeTopic: rec('topic'), verdict: rec('verdict'), judgeInterrupt: rec('judge'), extractProfile: rec('profile') };
});

describe('/api/trial/* pass the request signal down', () => {
  it.each(['setup', 'topic', 'verdict', 'judge-interrupt', 'profile'])('%s', async (route) => {
    const { POST } = await import(`../${route}/route`);
    const ctl = new AbortController();
    await POST(new Request(`http://test/api/trial/${route}`, { method: 'POST', body: '{}', signal: ctl.signal }));
    const signal = calls.at(-1)![1];
    expect(signal).toBeDefined();
    ctl.abort();
    expect(signal!.aborted).toBe(true); // a client that gave up frees the model slot
  });
});
