// Server-only Gemini client: writes the debate when there's no ANTHROPIC_API_KEY but there is a
// GEMINI_API_KEY. Same prompts and zod schemas as the Claude path (ask() in trial.ts).
// Model test (24 Oct): gemini-3.6-flash with MINIMAL thinking answered in 1.6-2.2s; 3.7/3.8-flash
// don't support MINIMAL and took >15s on LOW, too slow for the trial's 6-9s timeouts.
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { z } from 'zod';

export const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';

export const hasGeminiKey = () => Boolean(process.env.GEMINI_API_KEY);

let client: GoogleGenAI | null = null;

/** One structured call → object validated against `schema` (throws → caller's mock fallback). */
export async function askGemini<S extends z.ZodType>(system: string, content: string, schema: S, signal: AbortSignal): Promise<z.infer<S>> {
  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema; // Gemini rejects the meta-schema key
  const res = await client.models.generateContent({
    model: GEMINI_MODEL,
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
}
