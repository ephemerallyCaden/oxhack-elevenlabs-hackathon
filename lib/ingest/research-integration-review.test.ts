// @vitest-environment node

import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());
afterEach(() => vi.unstubAllEnvs());

test("the HTTP route uses the selected provider for source-backed cards and reports a missing key without fallback", async () => {
  vi.resetModules();
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "gemini");
  vi.stubEnv("RESEARCH_MODEL", "synthetic-gemini-model");
  vi.stubEnv("GEMINI_API_KEY", "synthetic-gemini-key");
  vi.stubEnv("AGNES_API_KEY", "");
  vi.stubEnv("AGNES_API_KEY_1", "");
  vi.stubEnv("THUNDERBIT_API_KEY", "synthetic-search-key");

  const passage = "Students who defer an accepted place may enter the following academic year, subject to confirmation.";
  const sourceUrl = "https://university.example.org/gap-year-policy";
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    requests.push({ url, body });

    if (url === "https://openapi.thunderbit.com/openapi/v1/search") {
      assert.equal(init?.method, "POST");
      assert.equal(init?.redirect, "error");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-search-key");
      assert.match(String(body?.query), /gap year outcomes costs financial risks primary research official statistics/i);
      return Response.json({ success: true, data: { results: [{
        success: true, url: sourceUrl, title: "Gap year admissions policy", markdown: passage,
      }] } });
    }

    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-gemini-key");
    assert.equal(body?.model, "synthetic-gemini-model");
    assert.equal(body?.reasoning_effort, "low");
    assert.equal("chat_template_kwargs" in (body ?? {}), false);
    const messages = body?.messages as { role: string; content: string }[];
    const payload = JSON.parse(messages[1].content) as {
      request: { question: string; topic: Record<string, unknown>; side: string; tier: string };
      records: { id: string; text: string }[];
    };
    assert.deepEqual(payload.request, {
      question: "Should I take a gap year?",
      topic: { id: "topic-gap-year", title: "Cost", question: "What costs and financial risks matter?" },
      side: "no",
      tier: "deep",
    });
    assert.ok(payload.records[0].text.includes(passage));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{
      recordId: payload.records[0].id, quote: passage, side: "no",
    }] }) } }] });
  };

  vi.stubGlobal("fetch", fakeFetch);
  const { POST } = await import("../../app/api/research/route");
  const requestBody = {
    question: "Should I take a gap year?",
    topic: { id: "topic-gap-year", title: "Cost", question: "What costs and financial risks matter?",
      importance: 1, research_speed: "deep", intro: "Consider the financial trade-off." },
    side: "no",
    tier: "deep",
  };

  const liveResponse = await POST(new Request("http://localhost/api/research", {
    method: "POST", body: JSON.stringify(requestBody),
  }));
  assert.equal(liveResponse.status, 200);
  const live = await liveResponse.json();
  assert.equal(live.fallback, false);
  assert.equal(live.diagnostics.status, "partial");
  assert.equal(live.diagnostics.acceptedCards, 1);
  assert.deepEqual(live.cards.map((card: Record<string, unknown>) => ({
    side: card.side, topic_id: card.topic_id, tier: card.tier, claim: card.claim,
    source_url: card.source_url, strength: card.strength,
  })), [{ side: "no", topic_id: "topic-gap-year", tier: "deep", claim: passage,
    source_url: sourceUrl, strength: 1 }]);
  assert.match(live.cards[0].source_name, /university\.example\.org.*Gap year admissions policy/i);
  assert.match(live.cards[0].evidence, /verification has not been performed/i);
  assert.equal(requests.length, 2);

  vi.stubEnv("GEMINI_API_KEY", "");
  const missingKeyResponse = await POST(new Request("http://localhost/api/research", {
    method: "POST", body: JSON.stringify(requestBody),
  }));
  assert.equal(missingKeyResponse.status, 200);
  const missingKey = await missingKeyResponse.json();
  assert.deepEqual(missingKey.cards, []);
  assert.equal(missingKey.fallback, true);
  assert.equal(missingKey.diagnostics.status, "not_configured");
  assert.match(missingKey.diagnostics.warnings.join(" "), /key is not configured/i);
  assert.equal(requests.length, 2, "a missing selected-provider key must not fall back or send another request");
});
