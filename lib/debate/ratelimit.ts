// Gemini free-tier budget: each model allows N calls per rolling 60s (GEMINI_RPM, default 5) and a
// small daily quota (20/day for 3.6-flash). A trial lasts several minutes, so the window keeps refilling:
// calls wait for a free slot instead of failing with 429, and fail over to the next model when one is
// busy or out for the day. Background calls (pre-writing the next topic) never take a model's last
// slot, so a user's interrupt is never stuck behind them.
//
// State is per server process (globalThis, shared by every API route in it). On Vercel each function
// instance has its own copy: they still pace themselves and fail over on a real 429, just without
// seeing each other's calls.
import { keyFor, perKey, poolId, usingOwnKey } from '@/lib/keys';

export type Priority = 'interactive' | 'background';

export class RateLimiter {
  private stamps: number[] = [];
  /** Epoch ms before which nothing may be sent (set from a 429's retry delay). */
  private blockedUntil = 0;

  constructor(
    private perMinute: number,
    private windowMs = 60_000,
    private now: () => number = Date.now,
  ) {}

  private prune(t: number) {
    while (this.stamps.length && t - this.stamps[0] >= this.windowMs) this.stamps.shift();
  }

  /** How long until a call of this priority may go, or 0 if it may go now. */
  waitFor(priority: Priority): number {
    const t = this.now();
    this.prune(t);
    const reserve = priority === 'background' && this.perMinute > 1 ? 1 : 0;
    const free = this.perMinute - reserve - this.stamps.length;
    const block = Math.max(0, this.blockedUntil - t);
    if (free > 0) return block;
    // The slot we need frees up when the (1 - free)th oldest call leaves the window.
    const oldest = this.stamps[-free];
    return Math.max(block, oldest + this.windowMs - t);
  }

  /** Record a call as sent. */
  record() {
    this.stamps.push(this.now());
  }

  /** The API said "retry in N ms": hold everything until then. */
  penalize(retryMs: number) {
    this.blockedUntil = Math.max(this.blockedUntil, this.now() + retryMs);
  }
}

/** Never hold a model longer than this for a per-minute limit: those clear within a minute. */
export const MAX_HOLD_MS = 65_000;

export type QuotaError = { kind: 'daily' | 'minute' | 'overload'; ms: number };

/** What a failed Gemini call means for the pool, or null if it isn't a quota/overload problem. */
export function classifyGeminiError(err: unknown): QuotaError | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b503\b|UNAVAILABLE|high demand|over capacity/i.test(msg)) return { kind: 'overload', ms: 2000 };
  if (/^Groq (429|413)/.test(msg)) {
    // Groq: "… tokens per minute (TPM) … Please try again in 7.5s" / "requests per day (RPD) … 2h3m4.5s"
    const t = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
    const ms = t ? Math.ceil(((Number(t[1] ?? 0) * 60 + Number(t[2] ?? 0)) * 60 + Number(t[3])) * 1000) : 15_000;
    if (/per day|\bRPD\b|\bTPD\b/i.test(msg)) return { kind: 'daily', ms };
    return { kind: 'minute', ms: Math.min(MAX_HOLD_MS, ms) };
  }
  if (!/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) return null;
  const s = msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":"(\d+)s"/)?.[1];
  const ms = s ? Math.ceil(Number(s) * 1000) : 15_000;
  if (/PerDay/i.test(msg)) return { kind: 'daily', ms: s ? ms : 6 * 3600_000 };
  return { kind: 'minute', ms: Math.min(MAX_HOLD_MS, ms) };
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted')); // an already-fired signal never fires again
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true });
  });

export class ModelPool {
  private limiters = new Map<string, RateLimiter>();

  constructor(
    readonly models: string[],
    perMinute: number | ((model: string) => number),
    private now: () => number = Date.now,
  ) {
    for (const m of models) this.limiters.set(m, new RateLimiter(typeof perMinute === 'number' ? perMinute : perMinute(m), 60_000, now));
  }

  /** The best model to use now: the first one free, else the one free soonest. null if all are out for the day. */
  pick(priority: Priority): { model: string; wait: number } | null {
    let best: { model: string; wait: number } | null = null;
    for (const model of this.models) {
      const wait = this.limiters.get(model)!.waitFor(priority);
      if (wait === 0) return { model, wait };
      if (wait <= MAX_HOLD_MS && (!best || wait < best.wait)) best = { model, wait };
    }
    return best;
  }

  /**
   * Claim a slot: returns the model to call, already counted. Re-checks after every wait, so callers
   * that were waiting for the same freed slot can't both take it (only one wakes to a free model).
   * Throws if no model frees up before `deadline` (epoch ms).
   */
  async acquire(priority: Priority, deadline: number, signal?: AbortSignal): Promise<string> {
    for (;;) {
      if (signal?.aborted) throw new Error('aborted'); // the caller gave up: don't spend a slot on it
      const pick = this.pick(priority);
      if (!pick) throw new Error('every Gemini model is out of quota for today');
      if (pick.wait === 0) {
        this.limiters.get(pick.model)!.record();
        return pick.model;
      }
      if (this.now() + pick.wait > deadline) throw new Error(`no Gemini model free in time (next: ${pick.model} in ${Math.ceil(pick.wait / 1000)}s)`);
      await sleep(pick.wait + 25, signal);
    }
  }

  /** Record a call as sent (tests; acquire() does this itself). */
  take(model: string) {
    this.limiters.get(model)?.record();
  }

  /** A call failed with a quota/overload error: hold that model for as long as it asked. */
  fail(model: string, q: QuotaError) {
    this.limiters.get(model)?.penalize(q.ms);
  }
}

// Default order: Groq's gpt-oss-120b first (0.4s, 1,000/day), then Gemini's best (20/day), then the rest.
const DEFAULT_MODELS = [
  'groq:openai/gpt-oss-120b',
  'gemini-3.6-flash',
  'groq:openai/gpt-oss-20b',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-flash-lite-latest',
  'gemma-4-31b-it',
];

/**
 * Model order. GEMINI_MODELS=a,b,c sets it (e.g. a lite model first in rehearsals to save the best
 * model's daily quota for the demo). GEMINI_MODEL (one model; research reads it too) goes first if set.
 * Only providers with a key are kept: `groq:` models need GROQ_API_KEY, the others GEMINI_API_KEY.
 */
export function modelOrder(env: { GEMINI_MODELS?: string; GEMINI_MODEL?: string; groq?: boolean; gemini?: boolean }): string[] {
  const list = (env.GEMINI_MODELS ?? '').split(',');
  const single = (env.GEMINI_MODEL ?? '').split(',')[0]; // research needs a single id; never treat it as a list
  const usable = (m: string) => (m.startsWith('groq:') ? env.groq !== false : env.gemini !== false);
  return [single, ...list, ...DEFAULT_MODELS].map((s) => s.trim()).filter((m, i, a) => m && a.indexOf(m) === i && usable(m));
}

/** Calls per minute per model: Groq's 8,000 tokens/min fits ~3 topic calls; Gemini allows 5. */
const paceFor = (model: string) => (model.startsWith('groq:') ? Number(process.env.GROQ_RPM) || 3 : Number(process.env.GEMINI_RPM) || 5);

/**
 * The pool for this request's keys (lib/keys.ts). The house keys share one pool per server process (on
 * globalThis because Next bundles each API route separately); each visitor's own keys get their own,
 * so one visitor's traffic never throttles another's quota.
 */
const g = globalThis as unknown as { __geminiPool?: ModelPool; __visitorPools?: Map<string, ModelPool> };
const MAX_VISITOR_POOLS = 64;

export function poolForRequest(): ModelPool {
  const build = (groq: boolean, gemini: boolean) =>
    new ModelPool(modelOrder({ GEMINI_MODELS: process.env.GEMINI_MODELS, GEMINI_MODEL: process.env.GEMINI_MODEL, groq, gemini }), paceFor);
  const id = poolId();
  if (id === 'house') return (g.__geminiPool ??= build(Boolean(keyFor('groq')), Boolean(keyFor('gemini'))));
  // A visitor's pool holds only the providers they brought their own key for: a house key stays in the
  // shared house pool, so its per-minute pacing can't be multiplied by visitors' private pools.
  return perKey((g.__visitorPools ??= new Map()), id, () => build(usingOwnKey('groq'), usingOwnKey('gemini')), MAX_VISITOR_POOLS);
}
