// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const del = vi.fn();
let client: unknown = { voices: { get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) } };
vi.mock('@/lib/voice/client', () => ({ elevenlabs: () => client }));
process.env.ELEVENLABS_VOICE_ID = 'PresenterVoice0001';
const { POST } = await import('../route');

const call = (body: unknown) => POST(new Request('http://x/api/voice/clone/delete', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
  get.mockReset();
  del.mockReset();
  client = { voices: { get: (...a: unknown[]) => get(...a), delete: (...a: unknown[]) => del(...a) } };
});

describe('/api/voice/clone/delete (onboarding Redo)', () => {
  it('rejects a missing or malformed voice id', async () => {
    expect((await call({})).status).toBe(400);
    expect((await call({ voiceId: '../../x' })).status).toBe(400);
  });

  it('never deletes the presenter voice or a voice that is not an onboarding clone', async () => {
    expect((await call({ voiceId: 'PresenterVoice0001' })).status).toBe(403);
    get.mockResolvedValue({ name: 'My studio voice' });
    expect((await call({ voiceId: 'SomeOtherVoice0001' })).status).toBe(403);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes a session_* clone, and carries on quietly when it can not', async () => {
    get.mockResolvedValue({ name: 'session_2026-10-25T07-00-00-000Z' });
    expect(await (await call({ voiceId: 'SessionClone00001' })).json()).toEqual({ deleted: true });
    expect(del).toHaveBeenCalledWith('SessionClone00001', expect.anything());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    get.mockRejectedValue(new Error('gone'));
    expect(await (await call({ voiceId: 'SessionClone00002' })).json()).toEqual({ deleted: false });
  });

  it('without an ElevenLabs key there is nothing to delete', async () => {
    client = null;
    expect(await (await call({ voiceId: 'SessionClone00001' })).json()).toEqual({ deleted: false });
  });
});
