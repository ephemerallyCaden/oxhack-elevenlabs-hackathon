// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { searchExa, searchPassage } from "./exa-search";
import { planWebQuery } from "./public-query";
import { createWebSearch } from "./web-search";
import { createResearchAgent } from "./research-agent";
import type { TopicResearchRequest } from "./research-contract";

const req: TopicResearchRequest = { question: "Should I quit my job at SecretCompany with 123456 in savings?",
  topic: { id: "finances", title: "Costs", question: "What financial risks matter?" }, side: "no", tier: "quick" };
const quote = "Leaving your job without another income may mean you need to rely on savings for everyday expenses.";
const page = { url: "https://www.moneyhelper.org.uk/en/work/leaving-employment", title: "Leaving work", text: quote, publishedDate: "2026-01-01T00:00:00Z", highlights: [quote] };
const envelope = (results: unknown[]) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify({ results }) }] } });
const signal = () => new AbortController().signal;
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("public query minimization", () => {
  it("recognizes decisions and facets without forwarding personal text or a requested side", () => {
    expect(planWebQuery(req)).toBe("leaving employment career change costs financial risks");
    expect(planWebQuery({ ...req, side: "yes", tier: "deep" })).toBe(planWebQuery(req));
    expect(planWebQuery({ ...req, question: "Should I marry Alex in London?" })).toBe("United Kingdom marriage financial responsibilities relationships costs financial risks");
    expect(planWebQuery({ ...req, question: "Should I retire in the United States?" })).toContain("United States retirement planning");
    expect(planWebQuery({ ...req, question: "Should I try quux?" })).toBeUndefined();
    expect(planWebQuery({ ...req, question: "Should I watch a movie?" })).toBeUndefined();
  });
});

describe("Exa transport and source boundaries", () => {
  it.each(["json", "sse"])("reads structured %s and rejects invented, unsafe and summary-only records", async format => {
    const body = envelope([page, { ...page, url: "https://www.moneyhelper.org.uk.evil.example/x" },
      { ...page, url: "https://www.gov.uk/x", text: undefined, summary: quote }, { ...page, url: "http://www.gov.uk/x" }]);
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const call = JSON.parse(String(init?.body));
      expect(call.params.name).toBe("web_search_advanced_exa");
      expect(call.params.arguments).toMatchObject({ type: "lite", numResults: 4, includeDomains: expect.arrayContaining(["www.moneyhelper.org.uk"]) });
      expect(String(init?.body)).not.toContain("SecretCompany");
      expect(init?.redirect).toBe("error");
      return new Response(format === "json" ? body : `event: message\r\ndata: ${body}\r\n\r\n`);
    });
    const search = createWebSearch({ env: {}, fetchImpl });
    const first = await search.collect(search.plan(req)!, signal());
    expect(first.status).toBe("live");
    expect(first.records).toHaveLength(1);
    expect(first.records[0]).toMatchObject({ sourceUrl: page.url, text: quote, publishedAt: page.publishedDate, verified: false });
    first.records[0].text = "changed by caller";
    const second = await search.collect(search.plan(req)!, signal());
    expect(second.status).toBe("cached");
    expect(second.records[0].text).toBe(quote);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not turn separated highlights into a continuous source quote", () => {
    const first = "One continuous passage describes the financial responsibilities of leaving employment.";
    const last = "A distant passage describes a different situation and should not be joined to the first.";
    const text = `${"Navigation ".repeat(400)}${first}${"Unrelated intervening text. ".repeat(300)}${last}`;
    const result = searchPassage({ ...page, text, highlights: [`${first}\n...\n${last}`] });
    expect(result).toContain(first);
    expect(result).not.toContain(last);
    expect(text.includes(result)).toBe(true);
    expect(searchPassage({ ...page, text: "", highlights: [quote] })).toBe("");
  });

  it("uses the selected keyed service without a second anonymous attempt", async () => {
    const transport = { json: vi.fn(async () => { throw new Error("private upstream error"); }), text: vi.fn() };
    await expect(searchExa({ query: "retirement planning", domains: ["www.gov.uk"], apiKey: "fixture", transport, signal: signal() })).rejects.toThrow();
    expect(transport.json).toHaveBeenCalledTimes(1);
    expect(transport.text).not.toHaveBeenCalled();
  });

  it.each([{ error: { code: -1 } }, { result: { isError: true } }, { result: { content: [{ type: "text", text: "unstructured article summary" }] } }])("handles malformed and failed tools without promoting text to evidence", async body => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(body));
    const search = createWebSearch({ env: {}, fetchImpl });
    const result = await search.collect("retirement planning", signal());
    expect(result.status).toBe("unavailable");
    expect(result.records).toEqual([]);
    await search.collect("retirement planning", signal());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("honors HTTP backoff across different queries and resumes after it expires", async () => {
    let now = Date.now();
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("quota", { status: 429, headers: { "retry-after": "120" } }))
      .mockImplementation(async () => new Response(envelope([page])));
    const search = createWebSearch({ env: {}, fetchImpl, now: () => now });
    expect((await search.collect("first", signal())).status).toBe("rate_limited");
    expect((await search.collect("second", signal())).status).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 121000;
    expect((await search.collect("second", signal())).status).toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("bounds slow searches and does not cache records delivered after cancellation", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    const fetchImpl = vi.fn<typeof fetch>(() => new Promise(resolve => { release = resolve; }));
    const search = createWebSearch({ env: {}, fetchImpl });
    const pending = search.collect("slow search", signal());
    await vi.advanceTimersByTimeAsync(2201);
    expect((await pending).status).toBe("unavailable");
    release(new Response(envelope([page])));
    await vi.advanceTimersByTimeAsync(0);
    expect((await search.collect("slow search", signal())).records).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("backs off across queries when MCP reports quota exhaustion inside HTTP 200", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => Response.json({ result: { isError: true, content: [{ type: "text", text: "Public MCP rate limit reached." }] } }));
    const search = createWebSearch({ env: {}, fetchImpl });
    expect((await search.collect("first", signal())).status).toBe("rate_limited");
    expect((await search.collect("different", signal())).status).toBe("rate_limited");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("leaves disabled and unrecognized requests explicit without network traffic", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const disabled = createWebSearch({ env: { RESEARCH_WEB_SEARCH: "none" }, fetchImpl });
    expect(disabled.plan(req)).toBeUndefined();
    expect((await disabled.collect("career", signal())).status).toBe("not_configured");
    const agent = createResearchAgent({ community: false, webSearch: createWebSearch({ env: {}, fetchImpl }) });
    const result = await agent.run({ ...req, question: "Should I choose quux?" });
    expect(result.diagnostics.status).toBe("unsupported");
    expect(result.cards).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

it("shares quick/deep acquisition while selecting each side independently", async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(envelope([page])));
  const agent = createResearchAgent({ community: false, webSearch: createWebSearch({ env: {}, fetchImpl }),
    selector: async (request, records) => ({ status: "ok", warnings: [], selections: [{ recordId: records[0].id, quote, side: request.side }] }) });
  // Marriage has no legacy Thunderbit plan, so this isolates shared web acquisition.
  const input = { ...req, question: "Should I get married?" };
  const [yes, no, deep] = await Promise.all([agent.run({ ...input, side: "yes" }), agent.run(input), agent.run({ ...input, tier: "deep" })]);
  expect(fetchImpl).toHaveBeenCalledTimes(1);
  expect(yes.cards[0].side).toBe("yes");
  expect(no.cards[0].side).toBe("no");
  expect(deep.cards[0].tier).toBe("deep");
  expect(yes.cards[0].id).not.toBe(no.cards[0].id);
});

it("distinguishes retrieved material without requested-side support from failed retrieval", async () => {
  const agent = createResearchAgent({ community: false, webSearch: createWebSearch({ env: {}, fetchImpl: async () => new Response(envelope([page])) }),
    selector: async (_req, records) => ({ status: "ok", warnings: [], selections: [{ recordId: records[0].id, quote, side: "no" }] }) });
  const result = await agent.run({ ...req, side: "yes" });
  expect(result.cards).toEqual([]);
  expect(result.fallback).toBe(true);
  expect(result.diagnostics.status).toBe("no_support");
  expect(result.diagnostics.tools).toContainEqual({ id: "exa", status: "live" });
  expect(result.diagnostics.warnings).toContain("Sources were retrieved, but no admissible passage supported the requested side.");
});

it("connects actual POST orchestration to web search, the configured model and source-bound cards", async () => {
  vi.resetModules();
  vi.stubEnv("RESEARCH_WEB_SEARCH", "exa"); vi.stubEnv("EXA_API_KEY", "");
  vi.stubEnv("RESEARCH_COMMUNITY_SOURCES", "none");
  vi.stubEnv("RESEARCH_MODEL_PROVIDER", "gemini"); vi.stubEnv("GEMINI_API_KEY", "fixture");
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input).includes("mcp.exa.ai")) return new Response(envelope([page]));
    expect(String(input)).toContain("generativelanguage.googleapis.com");
    const body = JSON.parse(String(init?.body));
    expect(body.max_tokens).toBe(800);
    const payload = JSON.parse(body.messages[1].content);
    expect(payload.request).not.toHaveProperty("side");
    return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [
      { recordId: payload.records[0].id, quote, side: "no" },
      { recordId: payload.records[0].id, quote: "Invented unsupported quotation, omitted by the boundary.", side: "no" },
    ] }) } }] });
  });
  vi.stubGlobal("fetch", fetchImpl);
  const { POST } = await import("../../app/api/research/route");
  const result = await (await POST(new Request("http://localhost/api/research", { method: "POST", body: JSON.stringify(req) }))).json();
  expect(result.fallback).toBe(false);
  expect(result.cards).toHaveLength(1);
  expect(result.cards[0]).toMatchObject({ claim: quote, source_url: page.url, strength: 1, side: "no", tier: "quick" });
  expect(result.cards[0].evidence).toBe(quote);
  expect(result.cards[0].provenance).toMatchObject({ publishedAt: page.publishedDate });
  expect(result.cards[0].provenance.limitations.join(" ")).toContain("not independently fetched or verified");
  expect(fetchImpl).toHaveBeenCalledTimes(2);
});
