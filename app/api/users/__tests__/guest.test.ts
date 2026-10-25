// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const rows = new Map<string, Record<string, unknown>>();
vi.mock('@/lib/supabase', () => ({
  LOCAL_DIR: '/tmp/roulette-test',
  supabase: {
    from: () => ({ upsert: async (row: Record<string, unknown>) => (rows.set(row.id as string, row), { error: null }) }),
  },
}));

const { POST: guest } = await import('../guest/route');

const MAYA = '7d3c1b0e-2f4a-4c8e-9b1d-6a5f3e2d1c0b';
const face = 'data:image/png;base64,iVBORw0KGgo=';
const req = (body: unknown) => new Request('http://test/api/users/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => rows.clear());

describe('/api/users/guest keeps a face without sign-in', () => {
  it('saves the face and profile under a new id the server picks', async () => {
    const r = await guest(req({ profile: { name: 'Sam' }, heads: { front: { src: face } } }));
    expect(r.status).toBe(200);
    const { id, juryKey } = await r.json();
    expect(id).toMatch(/^[\w-]{16,40}$/);
    expect(juryKey).toBeTruthy();
    expect(rows.get(id)?.profile).toEqual({ name: 'Sam' });
    expect(String(rows.get(id)?.selfie)).toContain(face);
  });

  it("can't target an existing row by sending its id", async () => {
    const { id } = await (await guest(req({ id: MAYA, profile: {}, selfie: face }))).json();
    expect(id).not.toBe(MAYA);
    expect(rows.has(MAYA)).toBe(false);
  });

  it('gives every save its own row', async () => {
    const a = (await (await guest(req({ profile: {}, selfie: face }))).json()).id;
    const b = (await (await guest(req({ profile: {}, selfie: face }))).json()).id;
    expect(a).not.toBe(b);
    expect(rows.size).toBe(2);
  });

  it('refuses a save with no face, or a non-PNG/JPEG/WebP face', async () => {
    expect((await guest(req({ profile: {} }))).status).toBe(400);
    expect((await guest(req({ profile: {}, selfie: 'data:image/svg+xml;base64,PHN2Zz4=' }))).status).toBe(400);
    expect(rows.size).toBe(0);
  });
});
