// Server-only Claude client. Never import from a "use client" file.
import Anthropic from '@anthropic-ai/sdk';
import { keyFor } from '@/lib/keys';

export const MODEL = 'claude-opus-5-5';

export const hasClaudeKey = () => Boolean(keyFor('anthropic'));

const clients = new Map<string, Anthropic>(); // per key (BYOK: lib/keys.ts)
export function claude(): Anthropic {
  const key = keyFor('anthropic') ?? '';
  let c = clients.get(key);
  if (!c) {
    // No SDK retries: every caller has its own timeout + mock fallback.
    c = new Anthropic({ apiKey: key, maxRetries: 0 });
    clients.set(key, c);
    if (clients.size > 32) clients.delete(clients.keys().next().value!);
  }
  return c;
}
