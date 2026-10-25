// @vitest-environment node
import assert from "node:assert/strict";
import { test } from "vitest";
import { importCollectorExport } from "./collection";
import { createCollectionFetcher } from "./collection-fetch";
import { createResearchAgent, type PublicCaptureTool } from "./research-agent";
import { createResearchQueue, withinDeadline } from "./research-control";
import { createPassageSelector, type PassageSelector } from "./research-selection";
import { type TopicResearchRequest } from "./research-contract";
import { POST } from "../../app/api/research/route";

const req: TopicResearchRequest = { question: "Should I learn pottery?",
  topic: { id: "topic-hobby", title: "Time", question: "What time does it require?" }, side: "yes", tier: "quick" };
const quote = "This introductory class meets for two hours each week.";
const imported = importCollectorExport({ collector: "easyspider", capturedAt: "2026-10-24T09:00:00.000Z",
  payload: [{ url: "https://www.nomadicmatt.com/fixture-classes", title: "Course listing", text: `${quote} Materials are provided.` }] });
const record = imported.records[0];
const capture: PublicCaptureTool = { id: "public-course-capture-v1", matches: () => true,
  read: async () => ({ status: "cached", records: [record], warnings: [] }) };
const noNetwork = createCollectionFetcher({ apiKey: "", fetchImpl: async () => { throw new Error("Unexpected network"); } });
const select: PassageSelector = async request => ({ status: "ok", selections: [{ recordId: record.id, quote, side: request.side }], warnings: [] });
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test("imported evidence becomes request-bound cards; original caveats and citation identity survive", async () => {
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, publicCaptures: [capture], selector: select });
  const yes = await agent.run({ ...req, topic: { ...req.topic, importance: 0.5, status: "pending" } });
  const no = await agent.run({ ...req, side: "no" });
  assert.equal(yes.fallback, false);
  assert.equal(yes.diagnostics.status, "partial"); // one source; never pad to the desired count
  assert.equal(yes.cards[0].claim, quote);
  assert.equal(yes.cards[0].source_url, record.sourceUrl);
  assert.equal(yes.cards[0].topic_id, req.topic.id);
  assert.notEqual(yes.cards[0].id, no.cards[0].id);
  assert.ok(record.limitations.every(limit => yes.cards[0].evidence.includes(limit)));
  assert.match(yes.cards[0].evidence, /verification has not/);
});

test("unknown source IDs, changed quotations, duplicate sources and wrong-side selections are rejected", async () => {
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, publicCaptures: [capture], selector: async () => ({ status: "ok", warnings: [], selections: [
    { recordId: "invented", quote, side: "yes" },
    { recordId: record.id, quote: "This class guarantees a salary of 999999 pounds.", side: "yes" },
    { recordId: record.id, quote, side: "no" },
    { recordId: record.id, quote, side: "yes" },
    { recordId: record.id, quote, side: "yes" },
  ] }) });
  const result = await agent.run(req);
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].claim, quote);
  assert.ok(!JSON.stringify(result.cards).includes("999999"));
  assert.match(result.diagnostics.warnings.join(" "), /Rejected/);
});

test("sixteen requests share public acquisition but retain separate card selection", async () => {
  let reads = 0, selections = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent = createResearchAgent({ community: false, fetcher: noNetwork,
    publicCaptures: [{ ...capture, read: async () => { reads++; await gate; return capture.read(new AbortController().signal); } }],
    selector: async (...args) => { selections++; return select(...args); },
  });
  const pending = Array.from({ length: 16 }, (_, i) => agent.run({ ...req, topic: { ...req.topic, id: `topic-${i}` } }));
  await delay(0); assert.equal(reads, 1); release();
  const results = await Promise.all(pending);
  assert.equal(reads, 1); assert.equal(selections, 16);
  assert.equal(new Set(results.flatMap(result => result.cards.map(card => card.id))).size, 16);
});

test("one cancelled consumer cannot cancel another subscriber's shared source job", async () => {
  let release!: () => void;
  let jobSignal: AbortSignal | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const caller = new AbortController();
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, selector: select, publicCaptures: [{ ...capture, read: async signal => {
    jobSignal = signal; await gate; return capture.read(signal);
  } }] });
  const first = agent.run(req, { signal: caller.signal });
  const second = agent.run({ ...req, tier: "deep" });
  await delay(0); caller.abort();
  assert.equal((await first).diagnostics.status, "cancelled");
  assert.equal(jobSignal?.aborted, false);
  release(); assert.equal((await second).cards.length, 1);
});

test("queue wait consumes deadline; deep work leaves capacity for quick requests", async () => {
  const queue = createResearchQueue(2);
  let release!: () => void, queuedStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = withinDeadline(signal => queue.schedule(async () => { await gate; return 1; }, "deep", signal).promise, 500);
  await delay(0);
  const second = withinDeadline(signal => queue.schedule(async () => { queuedStarted = true; return 2; }, "deep", signal).promise, 15);
  const quick = await withinDeadline(signal => queue.schedule(async () => 3, "quick", signal).promise, 100);
  assert.equal(quick, 3);
  await assert.rejects(second);
  assert.equal(queuedStarted, false);
  release(); assert.equal(await first, 1);
});

test("a quick subscriber promotes a same-turn deep job before its queue handle exists", async () => {
  let release!: () => void, targetStarted = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const blockers = ["block-a", "block-b"].map(id => ({ id, matches: (r: TopicResearchRequest) => r.topic.id === id,
    read: async () => { await gate; return capture.read(new AbortController().signal); } }));
  const target = { ...capture, matches: (r: TopicResearchRequest) => r.topic.id === "target",
    read: async () => { targetStarted = true; return capture.read(new AbortController().signal); } };
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, selector: select, publicCaptures: [...blockers, target], quickMs: 200, deepMs: 500 });
  const held = blockers.map(b => agent.run({ ...req, tier: "deep", topic: { ...req.topic, id: b.id } }));
  await delay(0);
  const deep = agent.run({ ...req, tier: "deep", topic: { ...req.topic, id: "target" } });
  const quick = agent.run({ ...req, topic: { ...req.topic, id: "target" } });
  const result = await quick;
  assert.equal(targetStarted, true); assert.equal(result.cards.length, 1);
  release(); await Promise.all([...held, deep]);
});

test("late selection cannot add cards to a timed-out result", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, publicCaptures: [capture], quickMs: 20,
    selector: async (...args) => { await gate; return select(...args); } });
  const result = await agent.run(req);
  assert.equal(result.diagnostics.status, "timeout"); assert.equal(result.cards.length, 0);
  release(); await delay(0);
  assert.equal(result.cards.length, 0); assert.equal(result.diagnostics.acceptedCards, 0);
});

test("Agnes adapter uses one bounded structured passage call and never generates source identities", async () => {
  let calls = 0;
  const selector = createPassageSelector({ apiKey: "synthetic-test-key", fetchImpl: async (url, init) => {
    calls++; assert.equal(String(url), "https://apihub.agnes-ai.com/v1/chat/completions");
    assert.ok(init?.signal); assert.equal(init?.redirect, "error");
    const sent = JSON.parse(String(init?.body));
    const payload = JSON.parse(sent.messages[1].content);
    assert.equal(payload.records[0].text, record.text);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{ recordId: record.id, quote, side: "yes" }] }) } }] });
  } });
  const result = await createResearchAgent({ community: false, fetcher: noNetwork, publicCaptures: [capture], selector }).run(req);
  assert.equal(calls, 1); assert.equal(result.cards[0].claim, quote);
});

test("missing model key and unsupported inputs return explicit states without synthetic evidence", async () => {
  const selector = createPassageSelector({ apiKey: "", fetchImpl: async () => { throw new Error("Unexpected network"); } });
  const empty = await createResearchAgent({ community: false, fetcher: noNetwork, selector }).run(req);
  assert.equal(empty.diagnostics.status, "unsupported"); assert.equal(empty.fallback, true);
  const missingKey = await createResearchAgent({ community: false, fetcher: noNetwork, selector, publicCaptures: [capture] }).run(req);
  assert.equal(missingKey.diagnostics.status, "not_configured"); assert.deepEqual(missingKey.cards, []);
});

test("a selector exception is an unavailable provider, not an elapsed deadline", async () => {
  const agent = createResearchAgent({ community: false, fetcher: noNetwork, publicCaptures: [capture],
    selector: async () => { throw new Error("Provider failed immediately"); } });
  const result = await agent.run(req);
  assert.equal(result.diagnostics.status, "unavailable");
  assert.deepEqual(result.cards, []);
});

test("Next route validates request bounds and exposes unsupported status through the real JSON boundary", async () => {
  const response = await POST(new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify(req) }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.diagnostics.status, "unsupported"); assert.deepEqual(result.cards, []);
  for (const body of ["{", JSON.stringify({ ...req, side: "anything" }), JSON.stringify({ ...req, question: "x".repeat(16001) })]) {
    assert.equal((await POST(new Request("http://localhost/api/research", { method: "POST", body }))).status, 400);
  }
});
