import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('./groq', () => ({ askGroq: vi.fn(), hasGroqKey: () => true }));

const schema = z.object({ lines: z.array(z.object({ text: z.string() })) });

describe('askGemini (model pool caller)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('GROQ_API_KEY', 'synthetic-groq-key');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GEMINI_MODELS', '');
    vi.stubEnv('GEMINI_MODEL', '');
    delete (globalThis as { __geminiPool?: unknown }).__geminiPool;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('asks again when a model answers with JSON that does not fit the schema', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValueOnce(JSON.stringify({ lines: ['a bare string, not a line object'] }));
    groq.mockResolvedValueOnce(JSON.stringify({ lines: [{ text: 'A real line.' }] }));
    const { askGemini } = await import('./gemini');

    const out = await askGemini('system', 'content', schema, new AbortController().signal);

    expect(out).toEqual({ lines: [{ text: 'A real line.' }] });
    expect(groq).toHaveBeenCalledTimes(2);
  });

  it('gives up (so the caller falls back) once both retries also answered malformed', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValue('{"lines": "not even an array"}');
    const { askGemini } = await import('./gemini');

    await expect(askGemini('system', 'content', schema, new AbortController().signal)).rejects.toBeInstanceOf(z.ZodError);
    expect(groq).toHaveBeenCalledTimes(3); // the answer + 2 retries
  });

  it('retries broken JSON (not just a schema mismatch) on the next model', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValueOnce('{"lines": [');
    groq.mockResolvedValueOnce(JSON.stringify({ lines: [{ text: 'Fixed.' }] }));
    const { askGemini } = await import('./gemini');

    await expect(askGemini('system', 'content', schema, new AbortController().signal)).resolves.toEqual({ lines: [{ text: 'Fixed.' }] });
    const models = groq.mock.calls.map((c) => c[0]);
    expect(models[1]).not.toBe(models[0]); // the model that answered badly sits out the retry
  });

  it('bad answers go to the mock after the retries, even if their text looks like a quota error', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValue('{"lines": "429 RESOURCE_EXHAUSTED high demand"}');
    const { askGemini } = await import('./gemini');

    await expect(askGemini('system', 'content', schema, new AbortController().signal)).rejects.toBeInstanceOf(z.ZodError);
    expect(groq).toHaveBeenCalledTimes(3); // the answer + 2 retries; no extra call from mistaking it for a quota hold
  });

  it('does not retry once the request is aborted', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    const ctl = new AbortController();
    groq.mockImplementationOnce(async () => {
      ctl.abort();
      return '{"lines": "nope"}';
    });
    const { askGemini } = await import('./gemini');

    await expect(askGemini('system', 'content', schema, ctl.signal)).rejects.toBeInstanceOf(z.ZodError);
    expect(groq).toHaveBeenCalledTimes(1);
  });

  it('does not retry without time left for another call (the mock must arrive on time)', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValue('{"lines": "nope"}');
    const { askGemini } = await import('./gemini');

    const deadline = Date.now() + 3900; // less than the 4s a call needs once the first answer is in
    await expect(askGemini('system', 'content', schema, new AbortController().signal, 'interactive', deadline)).rejects.toBeInstanceOf(z.ZodError);
    expect(groq).toHaveBeenCalledTimes(1);
  });
});
