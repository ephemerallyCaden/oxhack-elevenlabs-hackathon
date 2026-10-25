import { z } from "zod";

export type ModelProvider = "agnes" | "gemini" | "groq" | "openrouter" | "openai";
export type ModelOptions = { provider?: ModelProvider; apiKey?: string; model?: string; fetchImpl?: typeof fetch };
export type ModelConfiguration = { provider: ModelProvider | null; model: string; apiKey: string; endpoint?: string; warning?: string };
type ProviderSpec = { endpoint?: string; model?: string; modelEnv: string; keyEnv: string[] };
// Every provider speaks the OpenAI chat-completions shape. Named entries only save typing the
// endpoint; `openai` takes endpoint, key and model from the environment, so any compatible
// server (OpenRouter, Ollama, vLLM, a proxy) works without a code change.
const providers: Record<ModelProvider, ProviderSpec> = {
  agnes: { endpoint: "https://apihub.agnes-ai.com/v1/chat/completions", model: "agnes-2.5-flash", modelEnv: "AGNES_MODEL", keyEnv: ["AGNES_API_KEY", "AGNES_API_KEY_1"] },
  gemini: { endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", model: "gemini-3.8-flash", modelEnv: "GEMINI_MODEL", keyEnv: ["GEMINI_API_KEY"] },
  // Groq free tier: 1,000 requests/day per model. gpt-oss-20b keeps research off the debate's gpt-oss-120b quota.
  groq: { endpoint: "https://api.groq.com/openai/v1/chat/completions", model: "openai/gpt-oss-20b", modelEnv: "GROQ_RESEARCH_MODEL", keyEnv: ["GROQ_API_KEY"] },
  // One key, many models. Free models end in ":free" (20 requests/min, 50/day without credits).
  openrouter: { endpoint: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-oss-20b:free", modelEnv: "OPENROUTER_RESEARCH_MODEL", keyEnv: ["OPENROUTER_API_KEY"] },
  openai: { modelEnv: "RESEARCH_MODEL", keyEnv: ["RESEARCH_MODEL_API_KEY"] },
};
const isProvider = (name: string): name is ModelProvider => name in providers;

/** RESEARCH_MODEL_BASE_URL may be the API root ("https://host/v1") or the full chat-completions URL. */
function chatCompletionsUrl(base: string | undefined): string | undefined {
  const value = base?.trim().replace(/\/+$/, "");
  if (!value) return;
  try {
    const url = new URL(value);
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return;
  } catch { return; }
  return value.endsWith("/chat/completions") ? value : `${value}/chat/completions`;
}

/** Server configuration only. Request bodies cannot choose an endpoint or credentials. */
export function resolveModelConfiguration(options: ModelOptions = {}): ModelConfiguration {
  if (typeof window !== "undefined") throw new Error("Model credentials must stay on the server");
  const name = options.provider ?? (process.env.RESEARCH_MODEL_PROVIDER?.trim() || "agnes");
  if (!isProvider(name)) return { provider: null, model: "unconfigured", apiKey: "",
    warning: "Unsupported research model provider; no request sent." };
  const spec = providers[name];
  const endpoint = spec.endpoint ?? chatCompletionsUrl(process.env.RESEARCH_MODEL_BASE_URL);
  const model = options.model?.trim() || process.env.RESEARCH_MODEL?.trim() || process.env[spec.modelEnv]?.trim() || spec.model || "";
  const apiKey = options.apiKey ?? spec.keyEnv.map(key => process.env[key]).find(Boolean) ?? "";
  const warning = !endpoint ? "Research model endpoint (RESEARCH_MODEL_BASE_URL, https) is not configured; no request sent."
    : !model ? "Research model name (RESEARCH_MODEL) is not configured; no request sent."
      : !apiKey.trim() ? "Selected model provider key is not configured; no request sent." : undefined;
  return { provider: name, model: model || "unconfigured", apiKey, ...(endpoint ? { endpoint } : {}), ...(warning ? { warning } : {}) };
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
  const endpoint = config.endpoint ?? providers[config.provider].endpoint;
  if (!endpoint) throw new ModelRequestError("not_configured", "Research model endpoint is not configured; no request sent.");
  const response = await fetchImpl(endpoint, {
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
