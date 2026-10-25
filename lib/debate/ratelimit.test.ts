import { describe, expect, it, vi } from 'vitest';
import { classifyGeminiError, ModelPool, modelOrder, RateLimiter } from './ratelimit';

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('RateLimiter', () => {
  it('allows N calls per rolling minute, then refills as old calls leave the window', () => {
    const c = clock();
    const rl = new RateLimiter(5, 60_000, c.now);
    for (let i = 0; i < 5; i++) {
      expect(rl.waitFor('interactive')).toBe(0);
      (rl as unknown as { stamps: number[] }).stamps.push(c.now());
      c.advance(1000);
    }
    // 5 used at t=0..4s; at t=5s the first frees at t=60s.
    expect(rl.waitFor('interactive')).toBe(55_000);
    c.advance(55_000);
    expect(rl.waitFor('interactive')).toBe(0);
  });

  it('keeps the last slot for interactive calls', () => {
    const c = clock();
    const rl = new RateLimiter(5, 60_000, c.now);
    (rl as unknown as { stamps: number[] }).stamps.push(0, 0, 0, 0);
    expect(rl.waitFor('interactive')).toBe(0);
    expect(rl.waitFor('background')).toBe(60_000);
  });

  it('a 429 holds everything until its retry delay', () => {
    const c = clock();
    const rl = new RateLimiter(5, 60_000, c.now);
    rl.penalize(12_000);
    expect(rl.waitFor('interactive')).toBe(12_000);
    c.advance(12_000);
    expect(rl.waitFor('interactive')).toBe(0);
  });
});

describe('modelOrder', () => {
  it('GEMINI_MODEL is one model (research reads it too), even if someone wrote a list there', () => {
    const order = modelOrder({ GEMINI_MODEL: 'gemini-3.5-flash-lite,gemini-3.6-flash' });
    expect(order[0]).toBe('gemini-3.5-flash-lite');
    expect(order).toContain('gemini-3.6-flash');
  });
  it('GEMINI_MODELS sets the order, then the defaults follow without duplicates', () => {
    const order = modelOrder({ GEMINI_MODELS: 'gemini-3.1-flash-lite, gemini-3.6-flash' });
    expect(order.slice(0, 2)).toEqual(['gemini-3.1-flash-lite', 'gemini-3.6-flash']);
    expect(new Set(order).size).toBe(order.length);
  });
});

describe('classifyGeminiError', () => {
  it('a per-minute 429: hold for the delay Gemini asks for, capped at a minute', () => {
    const msg = '{"error":{"code":429,"message":"Quota exceeded … Please retry in 11.985732779s.","status":"RESOURCE_EXHAUSTED","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}}';
    expect(classifyGeminiError(new Error(msg))).toEqual({ kind: 'minute', ms: 11_986 });
  });
  it('a per-day 429: hold the model until the daily reset', () => {
    const msg = '429 RESOURCE_EXHAUSTED "quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier" Please retry in 24321s.';
    expect(classifyGeminiError(new Error(msg))).toEqual({ kind: 'daily', ms: 24_321_000 });
  });
  it('a 503 "high demand": short hold, it is usually momentary', () => {
    const msg = '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}';
    expect(classifyGeminiError(new Error(msg))).toEqual({ kind: 'overload', ms: 2000 });
  });
  it('ignores other errors', () => {
    expect(classifyGeminiError(new Error('400 bad request'))).toBeNull();
  });
});

describe('ModelPool', () => {
  it('uses the first model in preference order while it has slots', () => {
    const pool = new ModelPool(['best', 'lite'], 2, clock().now);
    expect(pool.pick('interactive')).toEqual({ model: 'best', wait: 0 });
  });

  it('moves to the next model when one is at its per-minute limit, instead of waiting', () => {
    const c = clock();
    const pool = new ModelPool(['best', 'lite'], 2, c.now);
    pool.take('best');
    pool.take('best');
    expect(pool.pick('interactive')).toEqual({ model: 'lite', wait: 0 });
  });

  it("skips a model whose daily quota is used up, and says when nothing's left today", () => {
    const pool = new ModelPool(['best', 'lite'], 5, clock().now);
    pool.fail('best', { kind: 'daily', ms: 6 * 3600_000 });
    expect(pool.pick('interactive')?.model).toBe('lite');
    pool.fail('lite', { kind: 'daily', ms: 6 * 3600_000 });
    expect(pool.pick('interactive')).toBeNull();
  });

  it('acquire claims a free slot at once and refuses to wait past the deadline', async () => {
    const c = clock();
    const pool = new ModelPool(['best'], 2, c.now);
    expect(await pool.acquire('interactive', 0)).toBe('best');
    expect(await pool.acquire('interactive', 0)).toBe('best');
    await expect(pool.acquire('interactive', 1000)).rejects.toThrow(/next: best in 60s/);
  });

  it("two callers waiting for the same freed slot don't both get it", async () => {
    vi.useFakeTimers();
    try {
      const pool = new ModelPool(['best'], 1, () => Date.now());
      await pool.acquire('interactive', Date.now()); // the only slot is used
      let got = 0;
      const deadline = Date.now() + 200_000;
      const a = pool.acquire('interactive', deadline).then(() => got++);
      const b = pool.acquire('interactive', deadline).then(() => got++);
      await vi.advanceTimersByTimeAsync(61_000); // one slot frees up
      expect(got).toBe(1); // the second caller re-checked and kept waiting
      await vi.advanceTimersByTimeAsync(61_000);
      expect(got).toBe(2);
      await Promise.all([a, b]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('when every model is busy, waits for whichever frees up first', () => {
    const c = clock();
    const pool = new ModelPool(['best', 'lite'], 1, c.now);
    pool.take('best');
    c.advance(30_000);
    pool.take('lite');
    expect(pool.pick('interactive')).toEqual({ model: 'best', wait: 30_000 });
  });
});

describe('Groq in the pool', () => {
  it('a Groq per-minute token limit holds that model for the delay it asks for', () => {
    const msg = 'Groq 429: {"error":{"message":"Rate limit reached for model `openai/gpt-oss-120b` on tokens per minute (TPM): Limit 8000, Used 7900, Requested 2100. Please try again in 7.5s."}}';
    expect(classifyGeminiError(new Error(msg))).toEqual({ kind: 'minute', ms: 7500 });
  });
  it('a Groq daily limit holds the model until it resets', () => {
    const msg = 'Groq 429: {"error":{"message":"Rate limit reached … on requests per day (RPD): Limit 1000, Used 1000. Please try again in 1h2m3.5s."}}';
    expect(classifyGeminiError(new Error(msg))).toEqual({ kind: 'daily', ms: 3_723_500 });
  });
  it('a request too large for the model fails over instead of breaking the call', () => {
    expect(classifyGeminiError(new Error('Groq 413: Request too large for model'))?.kind).toBe('minute');
  });
  it('only providers with a key join the pool; Groq goes first by default', () => {
    expect(modelOrder({ groq: true, gemini: true })[0]).toBe('groq:openai/gpt-oss-120b');
    expect(modelOrder({ groq: false, gemini: true }).some((m) => m.startsWith('groq:'))).toBe(false);
    expect(modelOrder({ groq: true, gemini: false }).every((m) => m.startsWith('groq:'))).toBe(true);
  });
});
