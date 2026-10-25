// Server-only Groq client (OpenAI-compatible chat API). Free tier, measured 25 Oct: openai/gpt-oss-120b
// and gpt-oss-20b answer structured JSON in ~0.4s, 1,000 requests/day and 8,000 tokens/min each.
// Used through the model pool (ratelimit.ts) as `groq:<model id>`.

export const hasGroqKey = () => Boolean(process.env.GROQ_API_KEY);

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * One structured call → the JSON text the model returned. Throws with the HTTP status in the message
 * (e.g. "Groq 429: …") so classifyGeminiError can tell quota errors from real ones.
 */
export async function askGroq(model: string, system: string, content: string, jsonSchema: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
      // Not strict: zod validates the result, and strict mode rejects some of our schemas' shapes.
      response_format: { type: 'json_schema', json_schema: { name: 'out', strict: false, schema: jsonSchema } },
      ...(model.startsWith('openai/') ? { reasoning_effort: 'low' } : {}),
    }),
    signal,
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${(await res.text()).slice(0, 600)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content;
  if (!text) throw new SyntaxError('Groq: empty response'); // like Gemini's JSON.parse(''): a malformed answer, retried once
  return text;
}
