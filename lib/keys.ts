// Server-only. Bring-your-own-keys (BYOK): which API key each request uses.
//
// A visitor can paste their own keys into the menu ("Use your own keys"); the browser sends them with
// every /api call as headers (lib/byok/browser.ts), and every API route runs inside withKeys(), so the
// service clients deep in lib/ (voice/client.ts, debate/claude.ts, gemini.ts, groq.ts) read the key for
// *this* request: the visitor's own → the house key from .env (unless HOUSE_KEYS=off) → none (mock).
// Visitors' keys are only ever used for their own request: never logged, never stored.
// Mock mode (the menu's "mock trial") sends `x-roulette-mock: 1`: every service acts as if it had no key.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';

export type Service = 'elevenlabs' | 'groq' | 'gemini' | 'anthropic';
export const SERVICES: Service[] = ['elevenlabs', 'groq', 'gemini', 'anthropic'];

/** Request headers carrying a visitor's keys (lower-case, as fetch normalises them). */
export const KEY_HEADER: Record<Service, string> = {
  elevenlabs: 'x-key-elevenlabs',
  groq: 'x-key-groq',
  gemini: 'x-key-gemini',
  anthropic: 'x-key-anthropic',
};
export const MOCK_HEADER = 'x-roulette-mock';

const ENV: Record<Service, string> = {
  elevenlabs: 'ELEVENLABS_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

interface RequestKeys {
  own: Partial<Record<Service, string>>;
  mock: boolean;
}

const store = new AsyncLocalStorage<RequestKeys>();

/** A pasted key, trimmed; anything that couldn't be a key (empty, whitespace inside, absurdly long) is ignored. */
function clean(v: string | null): string | undefined {
  const k = v?.trim();
  return k && k.length <= 200 && !/\s/.test(k) ? k : undefined;
}

export function keysFrom(req: Request): RequestKeys {
  const own: RequestKeys['own'] = {};
  for (const s of SERVICES) {
    const k = clean(req.headers.get(KEY_HEADER[s]));
    if (k) own[s] = k;
  }
  return { own, mock: req.headers.get(MOCK_HEADER) === '1' };
}

/** Run `fn` with this request's keys in scope. */
export function withKeys<T>(req: Request, fn: () => T): T {
  return store.run(keysFrom(req), fn);
}

/** Wrap a route handler so everything it calls sees the request's keys. */
export function byok<A extends unknown[], R>(handler: (req: Request, ...rest: A) => R) {
  return (req: Request, ...rest: A): R => withKeys(req, () => handler(req, ...rest));
}

/** The house keys (.env) are on unless HOUSE_KEYS=off (a public deployment where visitors bring their own). */
export const houseKeysOn = () => process.env.HOUSE_KEYS !== 'off';

/** The key to use for `service` in this request, or undefined (→ that service's mock). */
export function keyFor(service: Service): string | undefined {
  const ctx = store.getStore();
  if (ctx?.mock) return undefined;
  const own = ctx?.own[service];
  if (own) return own;
  return houseKeysOn() ? process.env[ENV[service]] || undefined : undefined;
}

/** True when this request uses the visitor's own key for `service` (not the house one). */
export function usingOwnKey(service: Service): boolean {
  const ctx = store.getStore();
  return !ctx?.mock && Boolean(ctx?.own[service]);
}

/** True in mock mode (the menu's mock trial): no service is called at all. */
export const mockRequested = () => Boolean(store.getStore()?.mock);

/**
 * A short, non-reversible id for the LLM keys in use, so each visitor's keys get their own rate limiter
 * (one visitor's traffic must never throttle another's quota). 'house' for the .env keys.
 */
export function poolId(): string {
  const parts = (['groq', 'gemini'] as const).map((s) => (usingOwnKey(s) ? keyFor(s) : `house:${s}`));
  if (parts.every((p) => p?.startsWith('house:'))) return 'house';
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
}

/** Which services have a house key (for the menu: "this site runs on your keys" when none). */
export function houseServices(): Record<Service, boolean> {
  return Object.fromEntries(SERVICES.map((s) => [s, houseKeysOn() && Boolean(process.env[ENV[s]])])) as Record<Service, boolean>;
}
