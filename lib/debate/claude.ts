// Server-only Claude client for the debate prompts. Never import from a "use client" file.
import Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

export const hasClaudeKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
export function claude(): Anthropic {
  // maxRetries 0: every caller has its own timeout + cached fallback, retries would blow the budget.
  client ??= new Anthropic({ maxRetries: 0 });
  return client;
}
