// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY_HEADER, MOCK_HEADER, keyFor, poolId, usingOwnKey, withKeys } from './keys';

const req = (headers: Record<string, string> = {}) => new Request('http://x/api/test', { method: 'POST', headers });

describe('BYOK: which key a request uses', () => {
  afterEach(() => vi.unstubAllEnvs());

  it("a visitor's own key wins over the house key, only inside their request", () => {
    vi.stubEnv('ELEVENLABS_API_KEY', 'house-el');
    withKeys(req({ [KEY_HEADER.elevenlabs]: 'visitor-el' }), () => {
      expect(keyFor('elevenlabs')).toBe('visitor-el');
      expect(usingOwnKey('elevenlabs')).toBe(true);
    });
    withKeys(req(), () => expect(keyFor('elevenlabs')).toBe('house-el'));
    expect(keyFor('elevenlabs')).toBe('house-el'); // outside any request: the house
  });

  it('HOUSE_KEYS=off: only visitors’ own keys are ever used', () => {
    vi.stubEnv('HOUSE_KEYS', 'off');
    vi.stubEnv('GROQ_API_KEY', 'house-groq');
    withKeys(req(), () => expect(keyFor('groq')).toBeUndefined());
    withKeys(req({ [KEY_HEADER.groq]: 'visitor-groq' }), () => expect(keyFor('groq')).toBe('visitor-groq'));
  });

  it('mock mode uses no key at all, not even a visitor’s', () => {
    vi.stubEnv('GROQ_API_KEY', 'house-groq');
    withKeys(req({ [MOCK_HEADER]: '1', [KEY_HEADER.groq]: 'visitor-groq' }), () => expect(keyFor('groq')).toBeUndefined());
  });

  it('ignores header values that could not be keys', () => {
    vi.stubEnv('GEMINI_API_KEY', 'house-gem');
    withKeys(req({ [KEY_HEADER.gemini]: '   ' }), () => expect(keyFor('gemini')).toBe('house-gem'));
    withKeys(req({ [KEY_HEADER.gemini]: 'two words' }), () => expect(keyFor('gemini')).toBe('house-gem'));
  });

  it("each visitor's LLM keys get their own rate-limit pool; the house shares one", () => {
    withKeys(req(), () => expect(poolId()).toBe('house'));
    const a = withKeys(req({ [KEY_HEADER.groq]: 'groq-a' }), poolId);
    const b = withKeys(req({ [KEY_HEADER.groq]: 'groq-b' }), poolId);
    expect(a).not.toBe('house');
    expect(a).not.toBe(b);
    expect(a).not.toContain('groq-a'); // a hash, never the key itself
  });
});
