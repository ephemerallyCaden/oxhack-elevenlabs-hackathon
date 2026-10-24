// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import { createCollectionFetcher } from "./collection-fetch";
import { createResearchAgent } from "./research-agent";
import { planPublicResearch, type TopicResearchRequest } from "./research-contract";

const SEARCH_ENDPOINT = "https://openapi.thunderbit.com/openapi/v1/search";

function request(overrides: Partial<TopicResearchRequest> = {}): TopicResearchRequest {
  return {
    question: "Should I leave my UK job?",
    topic: { id: "career", title: "Career outcomes", question: "Employment outcomes" },
    side: "yes",
    tier: "deep",
    ...overrides,
  };
}

function searchResponse(results: unknown[]): Response {
  return Response.json({ success: true, data: { results } });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    url: "https://research.example.org/study",
    title: "Research study",
    markdown: "A sufficiently detailed public source excerpt for the research evidence.",
    ...overrides,
  };
}

test("search without a key returns not_configured and makes no request", async () => {
  let calls = 0;
  const fetcher = createCollectionFetcher({ apiKey: "", fetchImpl: async () => {
    calls++;
    throw new Error("fetch must not run without an API key");
  } });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "not_configured");
  assert.deepEqual(result.records, []);
  assert.equal(calls, 0);
});

test("search sends only the fixed HTTPS endpoint and exact bounded request", async () => {
  let calledUrl = "";
  let init: RequestInit | undefined;
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async (input, requestInit) => {
    calledUrl = String(input);
    init = requestInit;
    return searchResponse([row()]);
  } });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "live");
  assert.equal(calledUrl, SEARCH_ENDPOINT);
  assert.equal(init?.method, "POST");
  assert.equal(init?.redirect, "error");
  assert.equal(new Headers(init?.headers).get("authorization"), "Bearer fixture-key");
  assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(String(init?.body)), {
    query: "UK leaving employment career change outcomes",
    limit: 3,
    formats: ["markdown"],
    timeout: 5000,
  });
  assert.ok(init?.signal instanceof AbortSignal);
  assert.equal(result.records[0].sourceUrl, "https://research.example.org/study");
});

test("search keeps accepted markdown sources and reports failed, string, snippet-only, and unsafe rows as omissions", async () => {
  const results = [
    row(),
    { success: false, error: "provider-private-token" },
    "provider returned a text error",
    { success: true, url: "https://snippet.example.org/", title: "Snippet only", snippet: "Not source text." },
    row({ url: "http://unsafe.example.org/plain" }),
    row({ url: "https://user:password@unsafe.example.org/credentialed" }),
    row({ url: "https://localhost/private" }),
  ];
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async () => searchResponse(results) });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "live");
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].sourceUrl, "https://research.example.org/study");
  assert.match(result.records[0].text, /sufficiently detailed public source excerpt/);
  assert.ok(!JSON.stringify(result.records).includes("Not source text."));
  assert.ok(!JSON.stringify(result).includes("provider-private-token"));
  assert.ok(result.records[0].limitations.some(limitation => /Search returned 7 rows; 6 failed or unusable rows were omitted/i.test(limitation)));
  assert.ok(result.records[0].limitations.some(limitation => /limited search sample/i.test(limitation)));
  assert.ok(result.records[0].limitations.some(limitation => /not publication or measurement time/i.test(limitation)));
  assert.equal(result.records[0].verified, false);
});

test("search with no usable rows returns invalid with no evidence", async () => {
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async () => searchResponse([
    { success: false, error: "upstream failure" },
    "error text",
    { success: true, url: "https://snippet.example.org/", title: "Snippet", snippet: "No markdown field." },
    row({ url: "ftp://research.example.org/archive" }),
    row({ url: "https://research.example.org:8443/private" }),
  ]) });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.records, []);
  assert.ok(result.warnings.some(warning => /no usable records/i.test(warning)));
  assert.ok(result.warnings.some(warning => /5 rows; 5 failed or unusable/.test(warning)));
});

test("search rejects bodies over the byte cap", async () => {
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async () =>
    new Response(new Uint8Array(512_001), { status: 200 }) });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "invalid");
  assert.deepEqual(result.records, []);
  assert.ok(result.warnings.some(warning => /unusable/i.test(warning)));
});

test("search deadline covers a response body that hangs after headers", async () => {
  let signal: AbortSignal | null | undefined;
  let cancelled = false;
  const started = performance.now();
  const fetcher = createCollectionFetcher({
    apiKey: "fixture-key",
    timeoutMs: 20,
    fetchImpl: async (_input, init) => {
      signal = init?.signal;
      const body = new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"success":true,')); },
        cancel() { cancelled = true; },
      });
      return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await fetcher.search("UK leaving employment career change outcomes");
  assert.equal(result.status, "unavailable");
  assert.ok(signal?.aborted, "the deadline should abort the in-flight request");
  assert.equal(cancelled, true, "the reader must release an abandoned body");
  assert.ok(performance.now() - started < 500, "the body read must not outlive the acquisition deadline");
});

test("public research planner strips private details and names from the outbound query", () => {
  const plan = planPublicResearch(request({
    question: "Should Alice Example, who works in London, leave her job on salary £198765? Dictation transcript: PRIVATE_TRANSCRIPT_CANARY_73",
    topic: { id: "job_choice", title: "Career and costs", question: "Employment, rent and cost outcomes" },
    tier: "deep",
  }));

  assert.deepEqual(plan, {
    source: "search",
    query: "United Kingdom leaving employment career change costs financial risks primary research official statistics",
  });
  assert.ok(!JSON.stringify(plan).includes("Alice Example"));
  assert.ok(!JSON.stringify(plan).includes("198765"));
  assert.ok(!JSON.stringify(plan).includes("PRIVATE_TRANSCRIPT_CANARY_73"));
});

test("unsupported quick research returns without search or provider traffic", async () => {
  let calls = 0;
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async () => {
    calls++;
    throw new Error("unsupported quick request must not search");
  } });
  const input = request({
    question: "Should I spend more time painting?",
    topic: { id: "hobby", title: "Creative time", question: "Personal enjoyment" },
    tier: "quick",
  });

  assert.deepEqual(planPublicResearch(input), { source: "none" });
  const result = await createResearchAgent({ community: false, fetcher }).run(input);
  assert.equal(result.diagnostics.status, "unsupported");
  assert.deepEqual(result.cards, []);
  assert.equal(calls, 0);
});

test("ONS CPI is selected only for a UK-scoped CPI topic", () => {
  const ukCpi = request({
    question: "Should I stay in London?",
    topic: { id: "prices", title: "Inflation and consumer prices", question: "UK CPI exposure" },
    tier: "quick",
  });
  const usCpi = request({
    question: "Should I move to New York?",
    topic: { id: "prices", title: "Inflation and consumer prices", question: "Consumer price index" },
    tier: "deep",
  });
  const ukNonCpi = request({
    question: "Should I leave my job in London?",
    topic: { id: "career", title: "Career outcomes", question: "Employment prospects" },
    tier: "deep",
  });

  assert.deepEqual(planPublicResearch(ukCpi), { source: "ons-cpi" });
  const usPlan = planPublicResearch(usCpi);
  assert.equal(usPlan.source, "search");
  assert.ok(usPlan.query && !/\bUnited Kingdom\b/i.test(usPlan.query), "US CPI must not select the UK-only ONS series or inject a UK scope");
  assert.deepEqual(planPublicResearch(ukNonCpi), {
    source: "search",
    query: "United Kingdom leaving employment career change employment outcomes primary research official statistics",
  });
});
