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

  it('gives up (so the caller falls back) after a second malformed answer', async () => {
    const { askGroq } = await import('./groq');
    const groq = vi.mocked(askGroq);
    groq.mockReset();
    groq.mockResolvedValue('{"lines": "not even an array"}');
    const { askGemini } = await import('./gemini');

    await expect(askGemini('system', 'content', schema, new AbortController().signal)).rejects.toThrow();
    expect(groq).toHaveBeenCalledTimes(2);
  });
});
