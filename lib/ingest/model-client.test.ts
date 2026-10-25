// @vitest-environment node

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import type { CollectionRecord } from "./collection";
import { ModelRequestError, readBoundedModelJson, requestModelJson, resolveModelConfiguration } from "./model-client";
import { createPassageSelector } from "./research-selection";
import type { TopicResearchRequest } from "./research-contract";

afterEach(() => vi.unstubAllEnvs());

const stamp = "2026-10-24T09:00:00.000Z";
const recordId = `record_${"a".repeat(24)}`;
const passage = "This introductory course meets every Saturday and includes a mentoring session.";
const record: CollectionRecord = {
  id: recordId,
  sourceUrl: "https://example.org/course",
  title: "Introductory course listing",
  text: passage,
  collector: "easyspider",
  capturedAt: stamp,
  captureMode: "import",
  limitations: ["Imported excerpt; source completeness is not verified."],
  verified: false,
};
const researchRequest: TopicResearchRequest = {
  question: "Should I take this course?",
  topic: { id: "topic-time", title: "Time", question: "What time does it require?" },
  side: "yes",
  tier: "quick",
};

function providerResponse(content: unknown): Response {
  return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] });
}

test("Agnes and Gemini use isolated endpoints and provider-specific JSON options", async () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  const observed: { provider: string; url: string; init: RequestInit; body: Record<string, unknown> }[] = [];

  for (const provider of ["agnes", "gemini"] as const) {
    const apiKey = `synthetic-${provider}-key`;
    const result = await requestModelJson({ provider, apiKey, model: `${provider}-test-model` }, {
      messages: [{ role: "user", content: "Return a small JSON object." }], maxTokens: 321, schema,
    }, new AbortController().signal, async (input, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      observed.push({ provider, url: String(input), init: init ?? {}, body });
      return providerResponse({ answer: "ok" });
    });
    assert.deepEqual(result, { answer: "ok" });
  }

  const agnes = observed.find(item => item.provider === "agnes")!;
  assert.equal(agnes.url, "https://apihub.agnes-ai.com/v1/chat/completions");
  assert.equal(new Headers(agnes.init.headers).get("authorization"), "Bearer synthetic-agnes-key");
  assert.equal(agnes.init.redirect, "error");
  assert.deepEqual(agnes.body.chat_template_kwargs, { enable_thinking: false });
  assert.deepEqual(agnes.body.response_format, { type: "json_object" });
  assert.equal("reasoning_effort" in agnes.body, false);
  assert.equal("json_schema" in (agnes.body.response_format as Record<string, unknown>), false);
  assert.equal(agnes.body.max_tokens, 321);

  const gemini = observed.find(item => item.provider === "gemini")!;
  assert.equal(gemini.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(new Headers(gemini.init.headers).get("authorization"), "Bearer synthetic-gemini-key");
  assert.equal(gemini.init.redirect, "error");
  assert.equal(gemini.body.reasoning_effort, "low");
  assert.deepEqual(gemini.body.response_format, {
    type: "json_schema", json_schema: { name: "research_result", strict: true, schema },
  });
  assert.equal("chat_template_kwargs" in gemini.body, false);
});

test("the environment provider switch reaches the passage selector", async () => {
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "gemini");
  vi.stubEnv("RESEARCH_MODEL", "synthetic-gemini-model");
  vi.stubEnv("AGNES_API_KEY", "synthetic-agnes-key");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");

  const requests: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const geminiFetch: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    return providerResponse({ selections: [{ recordId, quote: passage, side: "yes" }] });
  };

  const selection = await createPassageSelector({ fetchImpl: geminiFetch })(researchRequest, [record], new AbortController().signal);

  assert.equal(selection.status, "ok");
  assert.deepEqual(selection.selections, [{ recordId, quote: passage, side: "yes" }]);
  assert.equal(requests.length, 1);
  const [sent] = requests;
  assert.equal(sent.url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  assert.equal(sent.body.model, "synthetic-gemini-model");
  assert.equal(new Headers(sent.init.headers).get("authorization"), "Bearer synthetic-gemini-key");
  assert.equal(sent.body.reasoning_effort, "low");
  assert.equal("chat_template_kwargs" in sent.body, false);
});

test("missing selected-provider keys and unknown providers never fall back to another provider key", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    throw new Error("Unexpected provider request");
  };
  const select = () => createPassageSelector({ fetchImpl })(researchRequest, [record], new AbortController().signal);

  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "gemini");
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("AGNES_API_KEY", "synthetic-agnes-key");
  vi.stubEnv("AGNES_API_KEY_1", "synthetic-agnes-alternate-key");
  const withoutGeminiKey = await select();
  assert.equal(withoutGeminiKey.status, "not_configured");
  assert.match(withoutGeminiKey.warnings.join(" "), /key is not configured/i);

  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "unknown-provider");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");
  const unknownProvider = await select();
  assert.equal(unknownProvider.status, "not_configured");
  assert.match(unknownProvider.warnings.join(" "), /unsupported/i);
  assert.equal(calls, 0);
});

test("HTTP failures are classified, stop redirects, and cancel unread response bodies", async () => {
  const observedRedirects: (RequestRedirect | undefined)[] = [];
  for (const status of [429, 403]) {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } });
    const result = requestModelJson({ provider: "agnes", apiKey: "synthetic-agnes-key", model: "agnes-test-model" }, {
      messages: [{ role: "user", content: "request" }], maxTokens: 10, schema: { type: "object" },
    }, new AbortController().signal, async (_input, init) => {
      observedRedirects.push(init?.redirect);
      return new Response(body, { status });
    });

    await assert.rejects(result, error => {
      assert.ok(error instanceof ModelRequestError);
      assert.equal(error.kind, "unavailable");
      assert.match(error.message, status === 429 ? /rate\/quota/i : /access denied/i);
      return true;
    });
    await Promise.resolve();
    assert.equal(cancelled, true);
  }
  assert.deepEqual(observedRedirects, ["error", "error"]);
});

test("bounded model reads cancel oversized bodies and an aborted stalled stream", async () => {
  let headerBodyCancelled = false;
  const headerBody = new ReadableStream<Uint8Array>({ cancel: () => { headerBodyCancelled = true; } });
  await assert.rejects(readBoundedModelJson(
    new Response(headerBody, { headers: { "content-length": "11" } }), new AbortController().signal, 10,
  ), /Response size/);
  assert.equal(headerBodyCancelled, true);

  let streamedBodyCancelled = false;
  const streamedBody = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode('{"ok":true}')); },
    cancel: () => { streamedBodyCancelled = true; },
  });
  await assert.rejects(readBoundedModelJson(new Response(streamedBody), new AbortController().signal, 5), /Response size/);
  assert.equal(streamedBodyCancelled, true);

  let stalledBodyCancelled = false;
  const stalledBody = new ReadableStream<Uint8Array>({ cancel: () => { stalledBodyCancelled = true; } });
  const controller = new AbortController();
  const pendingRead = readBoundedModelJson(new Response(stalledBody), controller.signal, 32);
  controller.abort();
  await assert.rejects(pendingRead, error => error instanceof Error && error.name === "AbortError");
  assert.equal(stalledBodyCancelled, true);
});

test("Groq uses its own endpoint, key and the OpenAI json_schema options", async () => {
  const schema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };
  let seen: { url: string; init: RequestInit; body: Record<string, unknown> } | undefined;
  const result = await requestModelJson({ provider: "groq", apiKey: "synthetic-groq-key", model: "openai/gpt-oss-20b" }, {
    messages: [{ role: "user", content: "Return a small JSON object." }], maxTokens: 123, schema,
  }, new AbortController().signal, async (input, init) => {
    seen = { url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as Record<string, unknown> };
    return providerResponse({ answer: "ok" });
  });
  assert.deepEqual(result, { answer: "ok" });
  assert.equal(seen!.url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(new Headers(seen!.init.headers).get("authorization"), "Bearer synthetic-groq-key");
  assert.equal(seen!.init.redirect, "error");
  assert.equal(seen!.body.model, "openai/gpt-oss-20b");
  assert.equal(seen!.body.reasoning_effort, "low");
  assert.deepEqual(seen!.body.response_format, { type: "json_schema", json_schema: { name: "research_result", strict: true, schema } });
});

test("RESEARCH_MODEL_PROVIDER=groq uses GROQ_API_KEY and gpt-oss-20b (off the debate's gpt-oss-120b quota)", () => {
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "groq");
  vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
  vi.stubEnv("RESEARCH_MODEL", "");
  vi.stubEnv("GROQ_RESEARCH_MODEL", "");
  const config = resolveModelConfiguration();
  assert.equal(config.provider, "groq");
  assert.equal(config.apiKey, "synthetic-groq-key");
  assert.equal(config.model, "openai/gpt-oss-20b");
  assert.equal(config.warning, undefined);
});

test("Groq without a key sends nothing and says why", () => {
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "groq");
  vi.stubEnv("GROQ_API_KEY", "");
  const config = resolveModelConfiguration();
  assert.match(config.warning ?? "", /key is not configured/);
});

test("openrouter and any OpenAI-compatible endpoint are configured from the environment", async () => {
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "openrouter");
  vi.stubEnv("OPENROUTER_API_KEY", "synthetic-openrouter-key");
  vi.stubEnv("RESEARCH_MODEL", "");
  vi.stubEnv("OPENROUTER_RESEARCH_MODEL", "");
  const openrouter = resolveModelConfiguration();
  assert.equal(openrouter.endpoint, "https://openrouter.ai/api/v1/chat/completions");
  assert.equal(openrouter.model, "openai/gpt-oss-20b:free");
  assert.equal(openrouter.warning, undefined);

  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "openai");
  vi.stubEnv("RESEARCH_MODEL_BASE_URL", "https://llm.example.test/v1/");
  vi.stubEnv("RESEARCH_MODEL_API_KEY", "synthetic-generic-key");
  vi.stubEnv("RESEARCH_MODEL", "vendor/some-model");
  const generic = resolveModelConfiguration();
  assert.equal(generic.endpoint, "https://llm.example.test/v1/chat/completions");
  let seenUrl = "";
  const result = await requestModelJson(generic, { messages: [{ role: "user", content: "x" }], maxTokens: 5, schema: { type: "object" } },
    new AbortController().signal, async (input, init) => {
      seenUrl = String(input);
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-generic-key");
      assert.equal(JSON.parse(String(init?.body)).response_format.type, "json_schema");
      return providerResponse({ ok: true });
    });
  assert.deepEqual(result, { ok: true });
  assert.equal(seenUrl, "https://llm.example.test/v1/chat/completions");
});

test("the generic provider sends nothing without an https endpoint or a model name", async () => {
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "openai");
  vi.stubEnv("RESEARCH_MODEL_API_KEY", "synthetic-generic-key");
  vi.stubEnv("RESEARCH_MODEL", "vendor/some-model");
  vi.stubEnv("RESEARCH_MODEL_BASE_URL", "http://llm.example.test/v1");
  assert.match(resolveModelConfiguration().warning ?? "", /endpoint/);
  vi.stubEnv("RESEARCH_MODEL_BASE_URL", "https://llm.example.test/v1");
  vi.stubEnv("RESEARCH_MODEL", "");
  assert.match(resolveModelConfiguration().warning ?? "", /model name/);
  let calls = 0;
  const selection = await createPassageSelector({ fetchImpl: async () => { calls++; throw new Error("must not fetch"); } })(researchRequest, [record], new AbortController().signal);
  assert.equal(selection.status, "not_configured");
  assert.equal(calls, 0);
});

test("with no RESEARCH_MODEL_PROVIDER, the first provider that has a key is used", () => {
  for (const key of ["RESEARCH_MODEL_PROVIDER", "GROQ_API_KEY", "GEMINI_API_KEY", "AGNES_API_KEY", "AGNES_API_KEY_1", "OPENROUTER_API_KEY", "RESEARCH_MODEL_API_KEY", "RESEARCH_MODEL"]) vi.stubEnv(key, "");
  assert.equal(resolveModelConfiguration().provider, "agnes"); // nothing configured: the old default, with its warning
  assert.match(resolveModelConfiguration().warning ?? "", /key is not configured/);
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");
  assert.deepEqual([resolveModelConfiguration().provider, resolveModelConfiguration().warning], ["gemini", undefined]);
  vi.stubEnv("GROQ_API_KEY", "synthetic-groq-key");
  assert.equal(resolveModelConfiguration().provider, "groq"); // groq wins when both are present
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "gemini");
  assert.equal(resolveModelConfiguration().provider, "gemini"); // an explicit choice always wins
});
