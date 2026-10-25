// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The service-role client: getUser(token) verifies the token with Supabase Auth.
const getUserMock = vi.fn();
const rows = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/supabase', () => ({
  LOCAL_DIR: '/tmp/roulette-test',
  supabase: {
    auth: { getUser: (t: string) => getUserMock(t) },
    from: () => ({
      upsert: async (row: Record<string, unknown>) => (rows.set(row.id as string, row), { error: null }),
      select: () => ({ eq: (_c: string, id: string) => ({ maybeSingle: async () => ({ data: rows.get(id) ?? null }) }) }),
      delete: () => ({ eq: async (_c: string, id: string) => rows.delete(id) }),
    }),
  },
}));
// ElevenLabs voices by id → name.
const voices = new Map<string, string>();
vi.mock('@/lib/voice/client', () => ({
  elevenlabs: {
    voices: {
      get: async (id: string) => (voices.has(id) ? { name: voices.get(id) } : Promise.reject(new Error('404'))),
      update: async (id: string, { name }: { name: string }) => voices.set(id, name),
      delete: async (id: string) => voices.delete(id),
    },
  },
}));

const { POST: save } = await import('../route');
const { POST: get } = await import('../get/route');
const { POST: del } = await import('../delete/route');

const MAYA = '7d3c1b0e-2f4a-4c8e-9b1d-6a5f3e2d1c0b';
const req = (body: unknown, token?: string) =>
  new Request('http://test/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });

beforeEach(() => {
  rows.clear();
  voices.clear();
  getUserMock.mockReset();
  getUserMock.mockImplementation(async (t: string) =>
    t === 'good-token' ? { data: { user: { id: MAYA, email: 'maya@example.com' } }, error: null } : { data: { user: null }, error: new Error('invalid JWT') },
  );
});

describe('/api/users* require a verified Google session', () => {
  it.each([
    ['save', save, { profile: { name: 'Maya' } }],
    ['get', get, {}],
    ['delete', del, {}],
  ] as const)('%s: 401 without a token', async (_n, route, body) => {
    expect((await route(req(body))).status).toBe(401);
  });

  it.each([
    ['save', save, { profile: {} }],
    ['get', get, {}],
    ['delete', del, {}],
  ] as const)('%s: 401 with a forged or expired token (verified, not just present)', async (_n, route, body) => {
    expect((await route(req(body, 'forged'))).status).toBe(401);
    expect(getUserMock).toHaveBeenCalledWith('forged');
  });

  it('saves under the signed-in user id, never one the client picks', async () => {
    const r = await save(req({ id: 'someone-elses-id-123456', profile: { name: 'Maya' } }, 'good-token'));
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.id).toBe(MAYA);
    expect(body.juryKey).toMatch(/^[\w-]{12}$/); // opaque: lets this browser skip its own seat in the jury
    expect([...rows.keys()]).toEqual([MAYA]);
  });

  it('returns only the caller’s own row, with both heads', async () => {
    const heads = { front: { src: 'data:image/png;base64,AAA', lipY: 0.8 }, side: { src: 'data:image/png;base64,BBB' } };
    await save(req({ profile: { name: 'Maya' }, selfie: heads.front.src, heads }, 'good-token'));
    const r = await get(req({ id: 'ignored' }, 'good-token'));
    const { user } = await r.json();
    expect(user.id).toBe(MAYA);
    expect(user.selfie).toBe(heads.front.src);
    expect(user.heads.side.src).toBe(heads.side.src);
  });

  it('forget me deletes the caller’s row', async () => {
    await save(req({ profile: {} }, 'good-token'));
    expect((await (await del(req({}, 'good-token'))).json()).deleted).toBe(true);
    expect(rows.size).toBe(0);
  });
});

describe('voice clones stay tied to their owner', () => {
  it('renames the fresh clone to the user, and deletes the clone a re-onboarding replaced', async () => {
    voices.set('v1', 'session_1');
    await save(req({ profile: {}, voiceId: 'v1' }, 'good-token'));
    expect(voices.get('v1')).toBe(`user_${MAYA}`);
    voices.set('v2', 'session_2');
    await save(req({ profile: {}, voiceId: 'v2' }, 'good-token'));
    expect(voices.has('v1')).toBe(false);
    expect(voices.get('v2')).toBe(`user_${MAYA}`);
  });

  it('never renames or deletes a voice that is not a fresh clone or theirs', async () => {
    voices.set('presenter', 'Presenter voice');
    voices.set('leo', 'user_someone-else-0000000000');
    await save(req({ profile: {}, voiceId: 'presenter' }, 'good-token'));
    expect(voices.get('presenter')).toBe('Presenter voice');
    await save(req({ profile: {}, voiceId: 'leo' }, 'good-token'));
    expect(voices.get('leo')).toBe('user_someone-else-0000000000');
    await del(req({}, 'good-token'));
    expect(voices.get('leo')).toBe('user_someone-else-0000000000');
    expect(voices.get('presenter')).toBe('Presenter voice');
  });
});

describe('images the server will decode later', () => {
  it('only accepts PNG/JPEG/WebP faces (no SVG)', async () => {
    const svg = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    expect((await save(req({ profile: {}, selfie: svg }, 'good-token'))).status).toBe(400);
    expect((await save(req({ profile: {}, heads: { front: { src: svg } } }, 'good-token'))).status).toBe(400);
  });
});
