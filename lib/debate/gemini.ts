// Server-only Gemini client: writes the debate when there's no ANTHROPIC_API_KEY but there is a
// GEMINI_API_KEY. Same prompts and zod schemas as the Claude path (ask() in trial.ts).
// Model test (24 Oct): gemini-3.6-flash with MINIMAL thinking answered in 1.6-2.2s; 3.7/3.8-flash
// don't support MINIMAL and took >15s on LOW, too slow for the trial's 6-9s timeouts.
// Free-tier quota is per model, so when one returns 429 we move down the list (lite models ~3-4s).
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

export const GEMINI_MODELS = (process.env.GEMINI_MODEL ?? 'gemini-3.6-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

let client: GoogleGenAI | null = null;
/** model → time its quota ran out; skipped for 10 minutes so we don't burn the timeout on it. */
const exhausted = new Map<string, number>();
const COOLDOWN_MS = 10 * 60_000;

const isQuotaOrBusy = (e: unknown) => /"code":\s*(429|503)|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(String((e as Error)?.message ?? e));

/** One structured call → object validated against `schema` (throws → caller's mock fallback). */
export async function askGemini<S extends z.ZodType>(system: string, content: string, schema: S, signal: AbortSignal): Promise<z.infer<S>> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // Gemini rejects the meta-schema key

  const now = Date.now();
  const models = GEMINI_MODELS.filter((m) => now - (exhausted.get(m) ?? 0) > COOLDOWN_MS);
  let last: unknown = new Error('all Gemini models are out of quota');
  for (const model of models.length ? models : GEMINI_MODELS) {
    try {
      const res = await client.models.generateContent({
        model,
        contents: content,
        config: {
          systemInstruction: system,
          responseMimeType: 'application/json',
          responseJsonSchema: json,
          thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
          abortSignal: signal,
        },
      });
      return schema.parse(JSON.parse(res.text ?? ''));
    } catch (e) {
      last = e;
      if (!isQuotaOrBusy(e) || signal.aborted) throw e; // real error or out of time → mock fallback
      if (String((e as Error).message).includes('429')) exhausted.set(model, Date.now());
    }
  }
  throw last;
}
