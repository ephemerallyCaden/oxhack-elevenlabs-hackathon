import { describe, expect, it } from 'vitest';
import { classifyGeminiError, ModelPool, RateLimiter } from './ratelimit';

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
    expect(rl.available()).toBe(1);
  });

  it('keeps the last slot for interactive calls', () => {
    const c = clock();
    const rl = new RateLimiter(5, 60_000, c.now);
    (rl as unknown as { stamps: number[] }).stamps.push(0, 0, 0, 0);
    expect(rl.waitFor('interactive')).toBe(0);
    expect(rl.waitFor('background')).toBe(60_000);
  });

  it('acquire takes a slot immediately when one is free, and refuses waits longer than allowed', async () => {
    const c = clock();
    const rl = new RateLimiter(2, 60_000, c.now);
    await rl.acquire('interactive', 0);
    await rl.acquire('interactive', 0);
    expect(rl.available()).toBe(0);
    await expect(rl.acquire('interactive', 1000)).rejects.toThrow(/next slot in 60s/);
  });

  it('a 429 holds everything until its retry delay', () => {
    const c = clock();
    const rl = new RateLimiter(5, 60_000, c.now);
    rl.penalize(12_000);
    expect(rl.available()).toBe(0);
    expect(rl.waitFor('interactive')).toBe(12_000);
    c.advance(12_000);
    expect(rl.waitFor('interactive')).toBe(0);
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

  it('when every model is busy, waits for whichever frees up first', () => {
    const c = clock();
    const pool = new ModelPool(['best', 'lite'], 1, c.now);
    pool.take('best');
    c.advance(30_000);
    pool.take('lite');
    expect(pool.pick('interactive')).toEqual({ model: 'best', wait: 30_000 });
  });
});
