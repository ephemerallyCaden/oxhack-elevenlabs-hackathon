import { z } from "zod";

export type ModelProvider = "agnes" | "gemini" | "groq";
export type ModelOptions = { provider?: ModelProvider; apiKey?: string; model?: string; fetchImpl?: typeof fetch };
export type ModelConfiguration = { provider: ModelProvider | null; model: string; apiKey: string; warning?: string };
const providers = {
  agnes: { endpoint: "https://apihub.agnes-ai.com/v1/chat/completions", model: "agnes-2.5-flash" },
  gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-3.8-flash" },
  // Groq free tier: 1,000 requests/day per model. gpt-oss-20b keeps research off the debate's gpt-oss-120b quota.
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-20b" },
} as const;
const isProvider = (name: string): name is ModelProvider => name in providers;

/** Server configuration only. Request bodies cannot choose an endpoint or credentials. */
export function resolveModelConfiguration(options: ModelOptions = {}): ModelConfiguration {
  if (typeof window !== "undefined") throw new Error("Model credentials must stay on the server");
  const name = options.provider ?? (process.env.RESEARCH_MODEL_PROVIDER?.trim() || "agnes");
  if (!isProvider(name)) return { provider: null, model: "unconfigured", apiKey: "",
    warning: "Unsupported research model provider; no request sent." };
  const providerModel = { agnes: process.env.AGNES_MODEL, gemini: process.env.GEMINI_MODEL, groq: process.env.GROQ_RESEARCH_MODEL }[name]?.trim();
  const model = options.model?.trim() || process.env.RESEARCH_MODEL?.trim() || providerModel || providers[name].model;
  const providerKey = { agnes: process.env.AGNES_API_KEY || process.env.AGNES_API_KEY_1, gemini: process.env.GEMINI_API_KEY, groq: process.env.GROQ_API_KEY }[name];
  const apiKey = options.apiKey ?? providerKey ?? "";
  return { provider: name, model, apiKey,
    ...(!apiKey.trim() ? { warning: "Selected model provider key is not configured; no request sent." } : {}) };
}

export async function readBoundedModelJson(response: Response, signal: AbortSignal, maxBytes = 65536): Promise<unknown> {
  signal.throwIfAborted();
  if (Number(response.headers.get("content-length")) > maxBytes || !response.body) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Response size");
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) { cancel(); throw new Error("Response size"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}

export class ModelRequestError extends Error {
  constructor(readonly kind: "not_configured" | "unavailable", message: string) { super(message); }
}

/** The providers implement the same JSON result boundary, with separate wire options (Gemini and Groq share the OpenAI json_schema shape). */
export async function requestModelJson(config: ModelConfiguration, input: {
  messages: { role: "system" | "user"; content: string }[]; maxTokens: number; schema: Record<string, unknown>;
}, signal: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (typeof window !== "undefined") throw new Error("Model calls must run on the server");
  if (!config.provider || config.warning) throw new ModelRequestError("not_configured", config.warning ?? "Model is not configured.");
  signal.throwIfAborted();
  const response = await fetchImpl(providers[config.provider].endpoint, {
    method: "POST", redirect: "error", signal,
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: config.model, temperature: 0, max_tokens: input.maxTokens, stream: false,
      ...(config.provider === "agnes"
        ? { chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_object" } }
        : { reasoning_effort: "low", response_format: { type: "json_schema", json_schema: { name: "research_result", strict: true, schema: input.schema } } }),
      messages: input.messages,
    }),
  });
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new ModelRequestError("unavailable", response.status === 429 ? "Model rate/quota limit."
      : response.status === 401 || response.status === 403 ? "Model access denied." : "Model request failed.");
  }
  const envelope = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().max(20000) }) })).min(1).max(4) })
    .parse(await readBoundedModelJson(response, signal));
  signal.throwIfAborted();
  return JSON.parse(envelope.choices[0].message.content);
}
