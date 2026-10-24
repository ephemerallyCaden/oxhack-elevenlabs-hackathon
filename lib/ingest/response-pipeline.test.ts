// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import type { CollectionRecord } from "./collection";
import { generateCollectedResponse } from "./response-pipeline";

const stamp = "2026-10-24T09:00:00.000Z";
const ID_ONE = "record_111111111111111111111111";
const ID_TWO = "record_222222222222222222222222";

function record(id: string, sourceUrl: string, title: string, text: string): CollectionRecord {
  return {
    id, sourceUrl, title, text,
    collector: "easyspider", capturedAt: stamp, captureMode: "import",
    limitations: ["Imported excerpt; source completeness is not verified."],
    verified: false,
  };
}

function response(text: string, citedIds: string[]): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ text, citedIds }) } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

test("ONS citations do not permit unsupported values or periods, while SEP and September match the supplied observation", async () => {
  const onsRecord = record(
    ID_ONE,
    "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23",
    "CPI ANNUAL RATE 00: ALL ITEMS 2015=100",
    "ONS series D7G7, UK all-items CPI annual rate: 3.5% for 2026 SEP. This is the change over 12 months, observed in that month, not a forecast.",
  );
  const unsupportedClaims = [
    "The annual rate was 3.5% for July 2026.",
    "The annual rate was 8.7% for September 2026.",
  ];
  for (const claim of unsupportedClaims) {
    let calls = 0;
    const unsupported = await generateCollectedResponse([onsRecord], {
      apiKey: "test-key",
      fetchImpl: async () => {
        calls++;
        return response(claim, [ID_ONE]);
      },
    });

    assert.equal(calls, 2);
    assert.equal(unsupported.draft.mode, "fallback", `unsupported claim must fall back: ${claim}`);
    assert.equal(unsupported.summary.mode, "fallback", `summary of unsupported claim must fall back: ${claim}`);
    assert.deepEqual(unsupported.draft.citedIds, [ID_ONE]);
    assert.deepEqual(unsupported.summary.citedIds, [ID_ONE]);
    assert.ok(!unsupported.draft.text.includes(claim));
    assert.ok(!unsupported.summary.text.includes(claim));
    assert.match(unsupported.draft.warning ?? "", /unusable response/i);
  }

  let supportedCalls = 0;
  const supported = await generateCollectedResponse([onsRecord], {
    apiKey: "test-key",
    fetchImpl: async () => {
      supportedCalls++;
      return response("The latest observed annual rate was 3.5% for September 2026; this is not a forecast.", [ID_ONE]);
    },
  });
  assert.equal(supportedCalls, 2);
  assert.equal(supported.draft.mode, "live");
  assert.equal(supported.summary.mode, "live");
  assert.match(supported.draft.text, /September 2026/);
  assert.deepEqual(supported.summary.citedIds, [ID_ONE]);
});

test("missing API key returns deterministic local stages without fetching", async () => {
  let calls = 0;
  const result = await generateCollectedResponse([record(ID_ONE, "https://example.org/one", "First source", "First excerpt.")], {
    apiKey: "",
    fetchImpl: async () => { calls++; throw new Error("must not fetch"); },
  });

  assert.equal(calls, 0);
  assert.equal(result.draft.mode, "fallback");
  assert.equal(result.summary.mode, "fallback");
  assert.deepEqual(result.draft.citedIds, [ID_ONE]);
  assert.deepEqual(result.summary.citedIds, [ID_ONE]);
  assert.match(result.warnings.join(" "), /key is not configured/i);
  assert.match(result.draft.text, /all remain unverified/i);
});

test("two sequential stages send original records, then draft plus original records, and constrain summary citations", async () => {
  const first = Object.assign(
    record(ID_ONE, "https://example.org/one", "First public source", "First public excerpt."),
    { personalSalary: 173421, privateDecision: "PRIVATE_DECISION_CANARY" },
  );
  const second = record(ID_TWO, "https://example.org/two", "Second public source", "Second public excerpt.");
  const sent: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    sent.push({ url: String(input), body });
    return sent.length === 1
      ? response("Draft cites both source records and preserves their limitations.", [ID_ONE, ID_TWO])
      : response("Summary cites the second source and keeps its scope caveat.", [ID_TWO]);
  };
  const result = await generateCollectedResponse([first, second], { apiKey: "test-key", fetchImpl });

  assert.equal(sent.length, 2);
  assert.ok(sent.every(item => item.url === "https://apihub.agnes-ai.com/v1/chat/completions"));
  assert.equal(result.draft.mode, "live");
  assert.equal(result.summary.mode, "live");
  assert.deepEqual(result.draft.citedIds, [ID_ONE, ID_TWO]);
  assert.deepEqual(result.summary.citedIds, [ID_TWO]);

  const firstMessages = sent[0].body.messages as { role: string; content: string }[];
  const draftInput = JSON.parse(firstMessages[1].content) as { stage: string; records: unknown[] };
  assert.equal(draftInput.stage, "draft");
  assert.equal(draftInput.records.length, 2);

  const summaryMessages = sent[1].body.messages as { role: string; content: string }[];
  const summaryInput = JSON.parse(summaryMessages[1].content) as {
    stage: string; records: CollectionRecord[]; draft: { text: string; citedIds: string[] }; allowedCitationIds: string[];
  };
  assert.equal(summaryInput.stage, "summary");
  assert.equal(summaryInput.records.length, 2);
  assert.equal(summaryInput.draft.text, result.draft.text);
  assert.deepEqual(summaryInput.draft.citedIds, [ID_ONE, ID_TWO]);
  assert.deepEqual(summaryInput.allowedCitationIds, [ID_ONE, ID_TWO]);
  assert.ok(!JSON.stringify(sent).includes("PRIVATE_DECISION_CANARY"));
  assert.ok(!JSON.stringify(sent).includes("173421"));
  assert.ok(!JSON.stringify(sent).includes("personalSalary"));
  assert.ok(!("privateDecision" in result.records[0]));
});

test("a summary with an unknown citation falls back at the summary stage and cites only the draft evidence", async () => {
  let calls = 0;
  const result = await generateCollectedResponse([
    record(ID_ONE, "https://example.org/one", "Cited source", "This source supports the draft."),
    record(ID_TWO, "https://example.org/two", "Uncited source", "This source was not cited by the draft."),
  ], {
    apiKey: "test-key",
    fetchImpl: async () => {
      calls++;
      return calls === 1
        ? response("Draft uses only the cited source.", [ID_ONE])
        : response("UNTRUSTED_SUMMARY_CANARY", [ID_TWO]);
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.draft.mode, "live");
  assert.deepEqual(result.draft.citedIds, [ID_ONE]);
  assert.equal(result.summary.mode, "fallback");
  assert.match(result.summary.warning ?? "", /unusable response/i);
  assert.deepEqual(result.summary.citedIds, [ID_ONE]);
  assert.match(result.summary.text, /Cited source/);
  assert.ok(!result.summary.text.includes("Uncited source"));
  assert.ok(!result.summary.text.includes("UNTRUSTED_SUMMARY_CANARY"));
});
