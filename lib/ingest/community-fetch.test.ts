// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { createCommunityFetcher, interleaveRecords, planCommunityQuery } from "./community-fetch";
import { createResearchAgent } from "./research-agent";
import { createCollectionFetcher } from "./collection-fetch";
import type { CollectionReport } from "./collection-fetch";
import type { TopicResearchRequest } from "./research-contract";
import { communityRecord } from "./community-utils";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const req: TopicResearchRequest = { question: "Should I move abroad with my private-name and 93217 savings?",
  topic: { id: "moving", title: "Cost", question: "What costs matter?" }, side: "no", tier: "deep" };
const parent = "I expected moving abroad to cost very little money.";
const reply = "In my experience relocation required much more savings than I expected.";
const thread = { id: 42, title: "Relocation experience", post_stream: { posts: [
  { id: 100, topic_id: 42, post_number: 1, cooked: `<p>${parent}</p>` },
  { id: 101, topic_id: 42, post_number: 2, reply_to_post_number: 1, cooked: `<aside class="quote"><blockquote>${parent}</blockquote></aside><p>${reply}</p>` },
] } };
const forumFetch: typeof fetch = async input => {
  const url = new URL(String(input));
  if (url.pathname === "/search.json") return Response.json({ topics: [{ id: 42, title: "Relocation" }] });
  if (url.pathname === "/t/42.json") return Response.json(thread);
  throw new Error("Unexpected external URL");
};

it("uses fixed community queries, quick opt-out, source limits and secret-free capabilities", () => {
  const fetcher = createCommunityFetcher({ env: { YOUTUBE_API_KEY: "secret" } });
  expect(planCommunityQuery(req)).toBe("moving abroad");
  expect(planCommunityQuery({ ...req, question: "Should I buy a car for my new job?" })).toBe("car ownership");
  expect(fetcher.plan(req).map(item => item.id)).toEqual(["stackexchange", "discourse", "youtube"]);
  expect(fetcher.plan({ ...req, tier: "quick" })).toEqual([]);
  expect(fetcher.plan({ ...req, question: "Should I take a gap year?" }).map(item => item.id)).toEqual(["stackexchange", "wordpress", "youtube"]);
  expect(JSON.stringify(fetcher.catalog())).not.toContain("secret");
  expect(createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "none" } }).plan(req)).toEqual([]);
  expect(createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "x,discourse" } }).plan(req).map(item => item.id)).toEqual(["discourse"]);
});

it("caches public records without sharing mutable copies and keeps quoted parent markup out of reply text", async () => {
  let now = 1000;
  const fetchImpl = vi.fn(forumFetch);
  const fetcher = createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "discourse" }, fetchImpl, now: () => now });
  const action = fetcher.plan(req)[0], signal = new AbortController().signal;
  const first = await fetcher.collect(action, signal);
  expect(first.status).toBe("live");
  expect(first.records[1].text).toBe(reply);
  expect(first.records[1].discussion?.parentText).toBe(parent);
  first.records[1].text = "mutated";
  const second = await fetcher.collect(action, signal);
  expect(second.status).toBe("cached");
  expect(second.records[1].text).toBe(reply);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  now += 600001;
  expect((await fetcher.collect(action, signal)).status).toBe("live");
  expect(fetchImpl).toHaveBeenCalledTimes(4);
});

it("honors API-envelope backoff across different queries and does not label a failure as cached success", async () => {
  let now = 1000;
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [], backoff: 120 }));
  const fetcher = createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "stackexchange" }, fetchImpl, now: () => now });
  const signal = new AbortController().signal;
  expect((await fetcher.collect({ id: "stackexchange", query: "gap year" }, signal)).status).toBe("rate_limited");
  now += 61000;
  expect((await fetcher.collect({ id: "stackexchange", query: "parenting" }, signal)).status).toBe("rate_limited");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  now += 60000;
  fetchImpl.mockResolvedValue(Response.json({ items: [] }));
  expect((await fetcher.collect({ id: "stackexchange", query: "parenting" }, signal)).status).toBe("live");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});

it("throttles failed identical collections for a minute and retries after expiry", async () => {
  let now = 1000;
  const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new Error("upstream"));
  const fetcher = createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "discourse" }, fetchImpl, now: () => now });
  const action = fetcher.plan(req)[0], signal = new AbortController().signal;
  expect((await fetcher.collect(action, signal)).status).toBe("unavailable");
  expect((await fetcher.collect(action, signal)).status).toBe("unavailable");
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  now += 60001;
  fetchImpl.mockImplementation(forumFetch);
  expect((await fetcher.collect(action, signal)).status).toBe("live");
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it.each(["search", "answers"])("retains collected evidence when %s requests backoff and suppresses subsequent calls", async stage => {
  const quote = "My relocation costs exceeded the savings I had set aside for the move.";
  const fetchImpl = vi.fn<typeof fetch>(async input => new URL(String(input)).pathname.endsWith("search/advanced")
    ? Response.json({ items: [{ question_id: 42, link: "https://expatriates.stackexchange.com/questions/42/moving", title: "Moving costs", body: quote }], ...(stage === "search" ? { backoff: 120 } : {}) })
    : Response.json({ items: [], backoff: 120 }));
  const agent = createResearchAgent({ community: createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "stackexchange" }, fetchImpl }),
    fetcher: createCollectionFetcher({ apiKey: "" }), selector: async (request, records) => ({ status: "ok", warnings: [], selections: [{ recordId: records[0].id, quote, side: request.side }] }) });
  const first = await agent.run(req), second = await agent.run(req);
  expect(first.cards[0].claim).toBe(quote);
  expect(second.cards[0].claim).toBe(quote);
  expect(first.diagnostics.tools).toContainEqual({ id: "stackexchange", status: "rate_limited" });
  expect(fetchImpl).toHaveBeenCalledTimes(stage === "search" ? 1 : 2);
});

it("applies source eligibility to legacy captures before selection", async () => {
  const selector = vi.fn();
  const agent = createResearchAgent({ community: false, selector, publicCaptures: [{ id: "capture", matches: () => true,
    read: async () => ({ status: "live", warnings: [], records: [communityRecord("wordpress", { url: "https://unregistered.example/article", title: "Moving", text: reply }, () => 0)] }) }] });
  expect((await agent.run({ ...req, tier: "quick" })).cards).toEqual([]);
  expect(selector).not.toHaveBeenCalled();
});

it("interleaves records before the common cap so one source cannot occupy every slot", () => {
  const report = (prefix: string): CollectionReport => ({ status: "live", warnings: [], records: Array.from({ length: 6 }, (_, i) =>
    communityRecord("discourse", { url: `https://community.nomadgate.com/t/${prefix}/${i}`, title: prefix, text: `${prefix}${i}` }, () => 0)) });
  expect(interleaveRecords([report("one"), report("two"), report("three")]).slice(0, 4).map(record => record.text)).toEqual(["one0", "two0", "three0", "one1"]);
});

it("shares collection across sides and rejects a parent quotation attributed to a reply", async () => {
  const fetchImpl = vi.fn(forumFetch);
  const community = createCommunityFetcher({ env: { RESEARCH_COMMUNITY_SOURCES: "discourse" }, fetchImpl });
  const agent = createResearchAgent({ community, fetcher: createCollectionFetcher({ apiKey: "" }), selector: async (request, records) => {
    const record = records.find(item => item.discussion?.kind === "reply")!;
    return { status: "ok", warnings: [], selections: [{ recordId: record.id, quote: parent, side: request.side },
      { recordId: record.id, quote: reply, side: request.side }] };
  } });
  const [yes, no] = await Promise.all([agent.run({ ...req, side: "yes" }), agent.run(req)]);
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  for (const result of [yes, no]) {
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0].claim).toBe(reply);
    expect(result.cards[0].evidence).toContain(`Parent context (not the quoted reply): ${parent}`);
    expect(result.cards[0].evidence).toContain("opinions");
    expect(result.diagnostics.warnings.join(" ")).toContain("Rejected");
  }
  expect(yes.cards[0].id).not.toBe(no.cards[0].id);
});

it("connects real POST handling to forum acquisition and provider selection without UI or voice", async () => {
  vi.resetModules();
  vi.stubEnv("RESEARCH_COMMUNITY_SOURCES", "discourse");
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "agnes");
  vi.stubEnv("AGNES_API_KEY", "fixture-model-key");
  vi.stubEnv("THUNDERBIT_API_KEY", "");
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.startsWith("https://community.nomadgate.com/")) {
      expect(url).not.toContain("private-name"); expect(url).not.toContain("93217");
      return forumFetch(input, init);
    }
    expect(url).toBe("https://apihub.agnes-ai.com/v1/chat/completions");
    const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
    const record = payload.records.find((item: { discussion?: { kind: string } }) => item.discussion?.kind === "reply");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{ recordId: record.id, quote: reply, side: "no" }] }) } }] });
  });
  vi.stubGlobal("fetch", fetchImpl);
  const { POST } = await import("../../app/api/research/route");
  const response = await POST(new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify(req) }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.fallback).toBe(false);
  expect(result.cards[0].source_url).toBe("https://community.nomadgate.com/t/42/2");
  expect(result.diagnostics.tools).toContainEqual({ id: "discourse", status: "live" });
  expect(fetchImpl).toHaveBeenCalledTimes(3);
});
