// Server-side request budget for Gemini's free tier: N calls per rolling 60s (GEMINI_RPM, default 5).
// A trial lasts several minutes, so the window keeps refilling: calls wait for a free slot instead of
// failing with 429. Background calls (pre-writing the next topic) never take the last slot, so a user's
// interrupt is never stuck behind them. One process only: fine for `next dev` and a single demo instance.

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

  /** Free slots right now. */
  available(): number {
    const t = this.now();
    this.prune(t);
    return t < this.blockedUntil ? 0 : this.perMinute - this.stamps.length;
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

  /** Wait for a slot, then take it. Throws if that would take longer than maxWaitMs. */
  async acquire(priority: Priority, maxWaitMs: number, signal?: AbortSignal): Promise<void> {
    for (;;) {
      const wait = this.waitFor(priority);
      if (wait === 0) {
        this.stamps.push(this.now());
        return;
      }
      if (wait > maxWaitMs) throw new Error(`rate limit: next slot in ${Math.ceil(wait / 1000)}s`);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, wait + 25);
        signal?.addEventListener('abort', () => (clearTimeout(timer), reject(new Error('aborted'))), { once: true });
      });
      maxWaitMs -= wait + 25;
    }
  }

  /** Record a call as sent (when the caller did its own waiting). */
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

// ─── Several models, several quotas ─────────────────────────────────────────
// Each Gemini model has its OWN free-tier quotas (per minute AND per day, e.g. 20/day for 3.6-flash).
// The pool sends each call to the first model in preference order that has a free slot, skips models
// whose daily quota is used up until it resets, and moves on when one is busy instead of waiting.

export type QuotaError = { kind: 'daily' | 'minute' | 'overload'; ms: number };

/** What a failed Gemini call means for the pool, or null if it isn't a quota/overload problem. */
export function classifyGeminiError(err: unknown): QuotaError | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\b503\b|UNAVAILABLE|high demand/i.test(msg)) return { kind: 'overload', ms: 2000 };
  if (!/\b429\b|RESOURCE_EXHAUSTED/.test(msg)) return null;
  const s = msg.match(/retry in ([\d.]+)s/i)?.[1] ?? msg.match(/"retryDelay":"(\d+)s"/)?.[1];
  const ms = s ? Math.ceil(Number(s) * 1000) : 15_000;
  if (/PerDay/i.test(msg)) return { kind: 'daily', ms: s ? ms : 6 * 3600_000 };
  return { kind: 'minute', ms: Math.min(MAX_HOLD_MS, ms) };
}

export class ModelPool {
  private limiters = new Map<string, RateLimiter>();

  constructor(
    readonly models: string[],
    perMinute: number,
    private now: () => number = Date.now,
  ) {
    for (const m of models) this.limiters.set(m, new RateLimiter(perMinute, 60_000, now));
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

  /** Record a call as sent. */
  take(model: string) {
    this.limiters.get(model)?.record();
  }

  /** A call failed with a quota/overload error: hold that model for as long as it asked. */
  fail(model: string, q: QuotaError) {
    this.limiters.get(model)?.penalize(q.ms);
  }
}

const DEFAULT_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest', 'gemma-4-31b-it'];

/**
 * GEMINI_MODELS=a,b,c sets the order (e.g. a lite model first in rehearsals to save the best model's quota
 * for the demo). One pool per server process: kept on globalThis because Next bundles each API route
 * separately, and every route must see the same quota state.
 */
const g = globalThis as unknown as { __geminiPool?: ModelPool };
export const geminiPool = (g.__geminiPool ??= new ModelPool(
  (process.env.GEMINI_MODELS ?? process.env.GEMINI_MODEL ?? '').split(',').map((s) => s.trim()).filter(Boolean).concat(DEFAULT_MODELS).filter((m, i, a) => a.indexOf(m) === i),
  Number(process.env.GEMINI_RPM) || 5,
));
