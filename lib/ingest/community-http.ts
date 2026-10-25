import { withinDeadline } from "./research-control";
import type { CommunityTransport } from "./community-types";

export class CommunityHttpError extends Error {
  constructor(readonly status: number, readonly retryAt?: string) { super("Public source request was not successful."); }
}
type Options = { hosts: readonly string[]; fetchImpl?: typeof fetch; now?: () => number; cooldown?: Map<string, number>;
  /** Shortest cooldown after a 429 without a usable Retry-After (default one minute). */
  minCooldownMs?: number };
/** One collection gets at most four requests, each bounded to 4s and 512KB. */
export function createCommunityTransport(options: Options): CommunityTransport {
  let requests = 0;
  const fetchImpl = options.fetchImpl ?? fetch, now = options.now ?? Date.now;
  const cooldown = options.cooldown ?? new Map<string, number>();
  const minCooldownMs = options.minCooldownMs ?? 60000;
  async function read(value: string, signal: AbortSignal, init?: RequestInit): Promise<string> {
    if (typeof window !== "undefined") throw new Error("Community collection must run on the server");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || !options.hosts.includes(url.hostname)) throw new Error("Unregistered source endpoint");
    signal.throwIfAborted();
    const until = cooldown.get(url.hostname) ?? 0;
    if (until > now()) throw new CommunityHttpError(429, new Date(until).toISOString());
    if (++requests > 4) throw new Error("Collection request budget exceeded");
    return withinDeadline(async bounded => {
      const headers = new Headers({ Accept: "application/json, text/html;q=0.9", "User-Agent": "RouletteResearch/0.2 (+https://github.com/ephemerallyCaden/oxhack-elevenlabs-hackathon)" });
      new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
      const response = await fetchImpl(url, { ...init, redirect: "error", signal: bounded,
        headers });
      if (bounded.aborted) { void response.body?.cancel().catch(() => {}); bounded.throwIfAborted(); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        let retryAt: string | undefined;
        if (response.status === 429) {
          const retry = response.headers.get("retry-after") ?? "";
          const time = /^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry);
          const end = now() + Math.max(minCooldownMs, Math.min(86400000, Number.isFinite(time) ? time - now() : minCooldownMs));
          cooldown.set(url.hostname, end); retryAt = new Date(end).toISOString();
        }
        throw new CommunityHttpError(response.status, retryAt);
      }
      if (!response.body || Number(response.headers.get("content-length")) > 512000) {
        void response.body?.cancel().catch(() => {}); throw new Error("Source body exceeds budget");
      }
      const reader = response.body.getReader(), decoder = new TextDecoder();
      const cancel = () => { void reader.cancel().catch(() => {}); };
      bounded.addEventListener("abort", cancel, { once: true });
      let bytes = 0, text = "";
      try {
        while (true) {
          const { value: chunk, done } = await reader.read(); bounded.throwIfAborted();
          if (done) break;
          bytes += chunk.byteLength;
          if (bytes > 512000) throw new Error("Source body exceeds budget");
          text += decoder.decode(chunk, { stream: true });
        }
        return text + decoder.decode();
      } finally { bounded.removeEventListener("abort", cancel); cancel(); reader.releaseLock(); }
    }, 4000, signal);
  }
  return { text: read, json: async (...args) => JSON.parse(await read(...args)) };
}
