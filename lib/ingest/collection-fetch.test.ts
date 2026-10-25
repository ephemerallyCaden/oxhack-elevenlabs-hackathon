// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import { createCollectionFetcher } from "./collection-fetch";

const ONS_ENDPOINT = "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23/data";
const THUNDERBIT_ENDPOINT = "https://openapi.thunderbit.com/openapi/v1/distill";
const ONS_SOURCE = "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23";

function onsPayload(unit = "%") {
  return {
    description: {
      cdid: "D7G7", unit, title: "CPI ANNUAL RATE 00: ALL ITEMS 2015=100",
      releaseDate: "2026-10-15T08:00:00.000Z",
    },
    months: [
      { date: "2026 MAY", value: "3.4", year: "2026", month: "May" },
      { date: "2026 OCT", value: "3.8", year: "2026", month: "October" },
      { date: "bad future row", value: "99", year: "2027", month: "Smarch" },
      { date: "2026 SEP", value: "invalid", year: "2026", month: "September" },
    ],
  };
}

test("Thunderbit missing key and unknown source do not fetch; configured calls use only fixed endpoints", async () => {
  let calls = 0;
  const noKey = createCollectionFetcher({ apiKey: "", fetchImpl: async () => { calls++; throw new Error("must not fetch"); } });
  assert.equal((await noKey.thunderbit("ons-cpi")).status, "not_configured");
  assert.equal((await noKey.thunderbit("not-registered" as "ons-cpi")).status, "invalid");
  assert.equal(calls, 0);

  let calledUrl = "";
  let requestBody: Record<string, unknown> | undefined;
  const configured = createCollectionFetcher({
    apiKey: "test-key",
    fetchImpl: async (input, init) => {
      calledUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        success: true,
        data: { url: ONS_SOURCE, markdown: "The fixed registered source was extracted.", metadata: { sourceUrl: ONS_SOURCE } },
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const result = await configured.thunderbit("ons-cpi");

  assert.equal(result.status, "live");
  assert.equal(calledUrl, THUNDERBIT_ENDPOINT);
  assert.equal(requestBody?.url, ONS_SOURCE);
  assert.equal(requestBody?.renderMode, "none");
  assert.equal(result.records[0].sourceUrl, ONS_SOURCE);
});

test("ONS selection validates unit, chooses latest valid month, and cache preserves original capture time", async () => {
  let now = Date.parse("2026-10-24T09:00:00.000Z");
  let calls = 0;
  const fetcher = createCollectionFetcher({
    now: () => now,
    fetchImpl: async input => {
      calls++;
      assert.equal(String(input), ONS_ENDPOINT);
      return new Response(JSON.stringify(onsPayload()), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const live = await fetcher.ons();
  assert.equal(live.status, "live");
  assert.equal(live.records[0].collector, "ons");
  assert.match(live.records[0].text, /3\.8% for 2026 OCT/);
  assert.equal(live.records[0].sourceUrl, ONS_SOURCE);
  assert.equal(live.records[0].publishedAt, "2026-10-15T08:00:00.000Z");
  assert.equal(live.records[0].capturedAt, "2026-10-24T09:00:00.000Z");

  now += 5000;
  const cached = await fetcher.ons();
  assert.equal(cached.status, "cached");
  assert.equal(cached.records[0].capturedAt, live.records[0].capturedAt);
  assert.equal(calls, 1);

  const wrongUnit = createCollectionFetcher({
    fetchImpl: async () => new Response(JSON.stringify(onsPayload("index points")), { status: 200 }),
  });
  const invalid = await wrongUnit.ons();
  assert.equal(invalid.status, "invalid");
  assert.deepEqual(invalid.records, []);
});

test("publisher and provider rate limits honor Retry-After and suppress repeat requests", async () => {
  const now = Date.parse("2026-10-24T09:00:00.000Z");
  const publisherPayload = JSON.stringify({ error: { code: "SCRAPE_TARGET_RATE_LIMITED" } });
  let publisherCalls = 0;
  const publisherFetcher = createCollectionFetcher({
    apiKey: "test-key", now: () => now,
    fetchImpl: async () => {
      publisherCalls++;
      return new Response(publisherPayload, { status: 403, headers: { "retry-after": "180" } });
    },
  });
  const publisherLimit = await publisherFetcher.thunderbit("ons-cpi");
  const publisherCooldown = await publisherFetcher.thunderbit("poker-paper");
  assert.equal(publisherLimit.status, "rate_limited");
  assert.match(publisherLimit.warnings[0], /Publisher rate limit/i);
  assert.equal(publisherLimit.retryAt, new Date(now + 180_000).toISOString());
  assert.equal(publisherCooldown.status, "rate_limited");
  assert.equal(publisherCalls, 1);

  let providerCalls = 0;
  const providerFetcher = createCollectionFetcher({
    apiKey: "test-key", now: () => now,
    fetchImpl: async () => {
      providerCalls++;
      return new Response("{}", { status: 429, headers: { "retry-after": "120" } });
    },
  });
  const providerLimit = await providerFetcher.thunderbit("poker-paper");
  const providerCooldown = await providerFetcher.thunderbit("ons-cpi");
  assert.equal(providerLimit.status, "rate_limited");
  assert.match(providerLimit.warnings[0], /Provider\/source rate limit/i);
  assert.equal(providerLimit.retryAt, new Date(now + 120_000).toISOString());
  assert.equal(providerCooldown.status, "rate_limited");
  assert.equal(providerCalls, 1);
});

test("five-second budget aborts a stalled fetch and oversized source bodies are rejected", async () => {
  let signal: AbortSignal | null | undefined;
  const started = performance.now();
  const stalled = createCollectionFetcher({
    timeoutMs: 15,
    fetchImpl: async (_input, init) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    },
  });
  const timeout = await stalled.ons();
  assert.equal(timeout.status, "unavailable");
  assert.match(timeout.warnings[0], /five-second budget/i);
  assert.equal(signal?.aborted, true);
  assert.ok(performance.now() - started < 500);

  const oversized = createCollectionFetcher({
    fetchImpl: async () => new Response("x".repeat(512_001), { status: 200 }),
  });
  const tooLarge = await oversized.ons();
  assert.equal(tooLarge.status, "invalid");
  assert.deepEqual(tooLarge.records, []);
  assert.match(tooLarge.warnings[0], /unusable/i);
});

test("sixteen cold consumers share one acquisition and cannot mutate each other's records", async () => {
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const fetcher = createCollectionFetcher({ fetchImpl: async () => {
    calls++;
    await gate;
    return Response.json(onsPayload());
  } });
  const pending = Array.from({ length: 16 }, () => fetcher.ons());
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  const reports = await Promise.all(pending);
  assert.ok(reports.every(report => report.status === "live"));
  reports[0].records[0].text = "Changed by one caller";
  assert.notEqual(reports[1].records[0].text, reports[0].records[0].text);
  const cached = await fetcher.ons();
  assert.equal(cached.status, "cached");
  assert.notEqual(cached.records[0].text, reports[0].records[0].text);
  assert.equal(calls, 1);
});

test("shared failures leave no stuck promise or success-cache entry", async () => {
  let calls = 0;
  const fetcher = createCollectionFetcher({ fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response("{}", { status: 503 }) : Response.json(onsPayload());
  } });
  const failed = await Promise.all([fetcher.ons(), fetcher.ons()]);
  assert.equal(calls, 1);
  assert.ok(failed.every(report => report.status === "unavailable"));
  assert.equal((await fetcher.ons()).status, "live");
  assert.equal(calls, 2);
});

test("ONS skips contradictory and unusable date labels without relabeling their values", async () => {
  const fetcher = createCollectionFetcher({ fetchImpl: async () => Response.json({
    description: { cdid: "D7G7", unit: "%", title: "CPI annual rate", releaseDate: "2026-10-15T08:00:00.000Z" },
    months: [
      { date: "2026 SEP", value: "2.7", year: "2026", month: "September" },
      { date: "2030 MAR", value: "3.8", year: "2026", month: "October" },
      { date: "unavailable", value: "4.1", year: "2026", month: "November" },
    ],
  }) });
  const report = await fetcher.ons();
  assert.equal(report.status, "live");
  assert.equal(report.records.length, 1);
  assert.match(report.records[0].text, /2\.7% for 2026 SEP/);
  assert.doesNotMatch(report.records[0].text, /3\.8|4\.1|2030/);
});
