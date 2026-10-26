// Server-only Claude client. Never import from a "use client" file.
import Anthropic from '@anthropic-ai/sdk';
import { keyFor, perKey } from '@/lib/keys';

export const MODEL = 'claude-opus-5-5';

export const hasClaudeKey = () => Boolean(keyFor('anthropic'));

const clients = new Map<string, Anthropic>(); // per key (lib/keys.ts perKey)
export function claude(): Anthropic {
  const key = keyFor('anthropic') ?? '';
  // No SDK retries: every caller has its own timeout + mock fallback.
  return perKey(clients, key, () => new Anthropic({ apiKey: key, maxRetries: 0 }));
}
