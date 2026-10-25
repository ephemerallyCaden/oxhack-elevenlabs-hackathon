// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ LOCAL_DIR: '/tmp/unused', supabase: null }));
vi.mock('@/lib/voice/client', () => ({ elevenlabs: null }));
const routes = { save: (await import('../route')).POST, get: (await import('../get/route')).POST, del: (await import('../delete/route')).POST };
const req = () => new Request('http://test/api/users', { method: 'POST', headers: { Authorization: 'Bearer anything' }, body: '{}' });

describe('/api/users* without Supabase on the server', () => {
  it.each(Object.entries(routes))('%s says sign-in is not configured (503), not "you are not signed in"', async (_n, route) => {
    const r = await route(req());
    expect(r.status).toBe(503);
  });
});
