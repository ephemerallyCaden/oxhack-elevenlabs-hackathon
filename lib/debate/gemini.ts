// Server-only Gemini client: writes the debate when there's no ANTHROPIC_API_KEY but there is a
// GEMINI_API_KEY. Same prompts and zod schemas as the Claude path (ask() in trial.ts).
// Model tests: gemini-3.6-flash + MINIMAL thinking 1.6-2.2s (24 Oct); 3.5-flash-lite 4.5s, 3.1-flash-lite
// 8.5s, gemma-4-31b-it 11.5s without thinking (25 Oct). 3.7/3.8-flash don't support MINIMAL (>15s on LOW).
// Free tier: each model has its own quota (3.6-flash: 5/min, 20/day), so calls rotate through a pool.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';
import { classifyGeminiError, geminiPool, type Priority } from './ratelimit';

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

let client: GoogleGenAI | null = null;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(new Error('aborted'))), { once: true });
  });

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
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // Gemini rejects the meta-schema key

  for (let attempt = 0; attempt < geminiPool.models.length + 1; attempt++) {
    const pick = geminiPool.pick(priority);
    if (!pick) throw new Error('every Gemini model is out of quota for today');
    // Leave ~4s of the budget for the call itself.
    if (Date.now() + pick.wait > deadline - 4000) throw new Error(`no Gemini model free in time (next: ${pick.model} in ${Math.ceil(pick.wait / 1000)}s)`);
    if (pick.wait) await sleep(pick.wait + 25, signal);
    geminiPool.take(pick.model);
    try {
      const res = await client.models.generateContent({
        model: pick.model,
        contents: content,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: json,
          // Gemma rejects thinking settings; the Gemini 3.x flash models answer fastest on MINIMAL.
          ...(pick.model.startsWith('gemma') ? {} : { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } }),
          abortSignal: signal,
        },
      });
      return schema.parse(JSON.parse(res.text ?? ''));
    } catch (err) {
      const q = classifyGeminiError(err);
      if (!q || signal.aborted) throw err;
      console.warn(`[gemini] ${pick.model}: ${q.kind === 'daily' ? 'daily quota used up' : q.kind === 'minute' ? 'per-minute limit' : 'overloaded'}, holding it ${Math.round(q.ms / 1000)}s, trying the next model`);
      geminiPool.fail(pick.model, q);
    }
  }
  throw new Error('no Gemini model answered');
}
