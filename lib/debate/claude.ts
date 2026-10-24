// Server-only Claude client. Never import from a "use client" file.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

export const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
export function claude(): Anthropic {
  // No SDK retries: every caller has its own timeout + mock fallback.
  client ??= new Anthropic({ maxRetries: 0 });
  return client;
}
