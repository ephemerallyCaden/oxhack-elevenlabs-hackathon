// Server-only Gemini client: writes the debate when there's no ANTHROPIC_API_KEY but there is a
// GEMINI_API_KEY. Same prompts and zod schemas as the Claude path (ask() in trial.ts).
// Model tests: gemini-3.6-flash + MINIMAL thinking 1.6-2.2s (24 Oct); 3.5-flash-lite 4.5s, 3.1-flash-lite
// 8.5s, gemma-4-31b-it 11.5s without thinking (25 Oct). 3.7/3.8-flash don't support MINIMAL (>15s on LOW).
// Free tier: each model has its own quota (3.6-flash: 5/min, 20/day), so calls rotate through a pool that
// also holds Groq's models (`groq:<id>`, groq.ts) when GROQ_API_KEY is set.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { askGroq } from './groq';
import { keyFor, perKey } from '@/lib/keys';
import { classifyGeminiError, poolForRequest, type Priority } from './ratelimit';

export const hasGeminiKey = () => Boolean(keyFor('gemini'));

const clients = new Map<string, GoogleGenAI>(); // per key (lib/keys.ts perKey)
function geminiClient(): GoogleGenAI {
  const key = keyFor('gemini') ?? '';
  return perKey(clients, key, () => new GoogleGenAI({ apiKey: key }));
}

const CALL_BUDGET_MS = 4000; // left for the call itself
const RETRY_HOLD_MS = 2000; // a model that answered malformed JSON sits out the retry
const MAX_MALFORMED = 2; // retries after an answer that broke the schema, before the caller's mock
/** How long a retry may wait for a slot: a topic written ahead (background) has time to spare. */
const RETRY_WAIT_MS: Record<Priority, number> = { interactive: 2500, background: 20_000 };

/** The answer parsed but the caller's own check (`opts.check`) rejected it: retried like a schema miss. */
export class Malformed extends Error {}

/** What was wrong with the last answer, for the retry prompt (first few problems only). */
function whatWasWrong(err: unknown): string {
  if (err instanceof z.ZodError)
    return err.issues
      .slice(0, 4)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
  return err instanceof Error ? err.message : String(err);
}

/**
 * One structured call → object validated against `schema` (throws → caller's mock fallback).
 * Tries the pool's models in order; a model that's out of quota or overloaded is held and the next one
 * is tried. Gives up when no model can answer before `deadline` (epoch ms).
 * `opts.repair` fixes known near-misses in the raw JSON before validation; `opts.check` can reject a
 * valid-but-unusable answer (it throws), which is retried like a schema miss.
 */
export async function askGemini<S extends z.ZodType>(
  system: string,
  content: string,
  schema: S,
  signal: AbortSignal,
  priority: Priority = 'interactive',
  deadline = Date.now() + 15_000,
  opts: { repair?: (raw: unknown) => unknown; check?: (out: z.infer<S>) => void } = {},
): Promise<z.infer<S>> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // Gemini rejects the meta-schema key
  const accept = (text: string): z.infer<S> => {
    const raw = JSON.parse(text);
    const out = schema.parse(opts.repair ? opts.repair(raw) : raw);
    try {
      opts.check?.(out);
    } catch (e) {
      throw new Malformed(e instanceof Error ? e.message : String(e));
    }
    return out;
  };

  const geminiPool = poolForRequest();
  let malformed = 0;
  let note = ''; // after a bad answer: what was wrong, appended to the prompt for the retry
  for (let attempt = 0; attempt < geminiPool.models.length + MAX_MALFORMED; attempt++) {
    // Claims a slot atomically (waits if every model is busy); leaves ~4s of the budget for the call itself.
    const model = await geminiPool.acquire(priority, deadline - CALL_BUDGET_MS, signal);
    const prompt = content + note;
    try {
      if (model.startsWith('groq:')) return accept(await askGroq(model.slice(5), system, prompt, json, signal));
      const res = await geminiClient().models.generateContent({
        model,
        contents: prompt,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: json,
          // Gemma rejects thinking settings; the Gemini 3.x flash models answer fastest on MINIMAL.
          ...(model.startsWith('gemma') ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }),
          abortSignal: signal,
        },
      });
      return accept(res.text ?? '');
    } catch (err) {
      // Free models sometimes answer with JSON that breaks the schema (lines as bare strings, a missing
      // field) or that the caller can't use: ask again (up to MAX_MALFORMED times) instead of dropping
      // straight to the mock lines, telling the model what was wrong. The model that failed sits out 2s,
      // so the retry goes to another model when one is free (the same prompt tends to fail the same way),
      // else to the same one after the pause; a topic written ahead may wait longer for a slot. Only if
      // it fits the budget. A bad answer is never a quota error: past the retries it goes to the mock.
      if (err instanceof z.ZodError || err instanceof SyntaxError || err instanceof Malformed) {
        if (malformed < MAX_MALFORMED && !signal.aborted) {
          malformed++;
          geminiPool.fail(model, { kind: 'overload', ms: RETRY_HOLD_MS });
          const next = geminiPool.pick(priority);
          if (next && next.wait <= RETRY_WAIT_MS[priority] && Date.now() + next.wait < deadline - CALL_BUDGET_MS) {
            console.warn(`[gemini] ${model}: answer didn't fit (${malformed}/${MAX_MALFORMED}): ${whatWasWrong(err)}; asking ${next.model}`);
            note =
              `\n\nYOUR PREVIOUS ANSWER WAS REJECTED (${whatWasWrong(err)}). Answer again with JSON that matches the ` +
              'schema exactly: every item of an array of objects is an object, and every field is present.';
            continue;
          }
        }
        throw err;
      }
      const q = classifyGeminiError(err);
      if (!q || signal.aborted) throw err;
      console.warn(`[gemini] ${model}: ${q.kind === 'daily' ? 'daily quota used up' : q.kind === 'minute' ? 'per-minute limit' : 'overloaded'}, holding it ${Math.round(q.ms / 1000)}s, trying the next model`);
      geminiPool.fail(model, q);
    }
  }
  throw new Error('no Gemini model answered');
}
