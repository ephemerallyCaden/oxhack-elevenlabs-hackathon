// Server-only Gemini client: writes the debate when there's no ANTHROPIC_API_KEY but there is a
// GEMINI_API_KEY. Same prompts and zod schemas as the Claude path (ask() in trial.ts).
// Model tests: gemini-3.6-flash + MINIMAL thinking 1.6-2.2s (24 Oct); 3.5-flash-lite 4.5s, 3.1-flash-lite
// 8.5s, gemma-4-31b-it 11.5s without thinking (25 Oct). 3.7/3.8-flash don't support MINIMAL (>15s on LOW).
// Free tier: each model has its own quota (3.6-flash: 5/min, 20/day), so calls rotate through a pool that
// also holds Groq's models (`groq:<id>`, groq.ts) when GROQ_API_KEY is set.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { askGroq } from './groq';
import { classifyGeminiError, geminiPool, type Priority } from './ratelimit';

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

let client: GoogleGenAI | null = null;

/**
 * One structured call → object validated against `schema` (throws → caller's mock fallback).
 * Tries the pool's models in order; a model that's out of quota or overloaded is held and the next one
 * is tried. Gives up when no model can answer before `deadline` (epoch ms).
 */
export async function askGemini<S extends z.ZodType>(
  system: string,
  content: string,
  schema: S,
  signal: AbortSignal,
  priority: Priority = 'interactive',
  deadline = Date.now() + 15_000,
): Promise<z.infer<S>> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // Gemini rejects the meta-schema key

  let malformed = false;
  for (let attempt = 0; attempt < geminiPool.models.length + 1; attempt++) {
    // Claims a slot atomically (waits if every model is busy); leaves ~4s of the budget for the call itself.
    const model = await geminiPool.acquire(priority, deadline - 4000, signal);
    try {
      if (model.startsWith('groq:')) return schema.parse(JSON.parse(await askGroq(model.slice(5), system, content, json, signal)));
      client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const res = await client.models.generateContent({
        model,
        contents: content,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: json,
          // Gemma rejects thinking settings; the Gemini 3.x flash models answer fastest on MINIMAL.
          ...(model.startsWith('gemma') ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }),
          abortSignal: signal,
        },
      });
      return schema.parse(JSON.parse(res.text ?? ''));
    } catch (err) {
      // Free models sometimes answer with JSON that breaks the schema (lines as bare strings, a missing
      // field): ask once more instead of dropping straight to the mock lines.
      if ((err instanceof z.ZodError || err instanceof SyntaxError) && !malformed && !signal.aborted) {
        malformed = true;
        console.warn(`[gemini] ${model}: answer didn't fit the schema, asking again`);
        continue;
      }
      const q = classifyGeminiError(err);
      if (!q || signal.aborted) throw err;
      console.warn(`[gemini] ${model}: ${q.kind === 'daily' ? 'daily quota used up' : q.kind === 'minute' ? 'per-minute limit' : 'overloaded'}, holding it ${Math.round(q.ms / 1000)}s, trying the next model`);
      geminiPool.fail(model, q);
    }
  }
  throw new Error('no Gemini model answered');
}
