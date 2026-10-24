// Demo safety (D6): every external call on the demo path goes through withFallback.

import type { DebateEvent } from '@/types';

export const FALLBACK_TIMEOUT_MS = 5000;

/**
 * Judge lines the orchestrator needs instantly. They ride along in ScriptResponse.elaborations
 * under these keys so B5 voices them in the same batch as the debate.
 */
export const FIXED_LINES: Record<'judge-considers' | 'judge-penalty', DebateEvent[]> = {
  'judge-considers': [
    {
      id: 'fixed-considers', timestamp: 0, type: 'speech', speaker: 'judge',
      text: 'Order! The court considers the witness’s objection...',
      tts: '[authoritative] Order! [thoughtful] The court considers the witness’s objection...',
      durationMs: 3500,
    },
  ],
  'judge-penalty': [
    {
      id: 'fixed-penalty', timestamp: 0, type: 'speech', speaker: 'judge',
      text: 'That has nothing to do with the argument! The witness will refrain from wasting the court’s time.',
      tts: '[authoritative] That has nothing to do with the argument! [measured] The witness will refrain from wasting the court’s time.',
      durationMs: 5500,
    },
  ],
};

/** DESIGN.md "Interrupt Fallback": the rehearsed challenge + a reply that works with the network unplugged. */
export const FALLBACK_CHALLENGE = 'But what about quality of life?';
export const FALLBACK_INTERRUPT_REPLY: DebateEvent = {
  id: 'fallback-reply', timestamp: 0, type: 'speech', speaker: 'prosecution', cites: ['f3', 'f4'],
  text: 'Thank you! Finally, someone asks. Poker-me works 25 hours a week and scores 0.64 on happiness. Quant-me scores 0.55. Quality of life is the whole point.',
  tts: '[excited] Thank you! Finally, someone asks. [confident] Poker-me works twenty-five hours a week and scores zero point six four on happiness. Quant-me scores zero point five five. Quality of life is the whole point.',
  durationMs: 10000,
};

/**
 * Resolve `work`, or `cached` if it throws or takes longer than `ms`.
 * `work` gets an AbortSignal that fires on timeout so the slow request is cancelled.
 */
export async function withFallback<T>(
  work: (signal: AbortSignal) => Promise<T>,
  cached: T | (() => T),
  ms = FALLBACK_TIMEOUT_MS,
  label = 'call',
): Promise<{ value: T; fallback: boolean }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    const value = await Promise.race([work(controller.signal), timeout]);
    return { value, fallback: false };
  } catch (err) {
    console.warn(`[fallback] ${label}: ${(err as Error).message}`);
    const value = typeof cached === 'function' ? (cached as () => T)() : cached;
    return { value, fallback: true };
  } finally {
    clearTimeout(timer);
  }
}

/** POST JSON and parse the JSON reply. Throws on non-2xx so withFallback can catch it. */
export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}
