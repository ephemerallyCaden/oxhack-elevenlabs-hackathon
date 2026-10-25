import { describe, expect, it, vi } from "vitest";
import { socialAdapters } from "./community-social";
import type { CommunityContext, CommunitySourceId } from "./community-types";

const adapter = (id: CommunitySourceId) => socialAdapters.find(item => item.id === id)!;
function context(env: CommunityContext["env"] = {}): CommunityContext {
  return { query: "gap year wellbeing", env, now: () => Date.parse("2026-10-25T00:00:00Z"), signal: new AbortController().signal,
    transport: { json: vi.fn(), text: vi.fn() } };
}
const preview = (channel: string) => `<div data-post="${channel}/42"><div class="tgme_widget_message_text">Taking a gap year helped me learn how to manage my time.<br>It also cost more than expected.</div><time datetime="2026-10-20T12:00:00Z"></time></div>`;

describe("bounded social adapters", () => {
  it.each(["json", "sse"])("discovers Telegram channels through %s MCP and preserves original post metadata", async format => {
    const ctx = context();
    const envelope = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: [
      "URL: https://t.me/s/TravelLife/42", "URL: https://t.me/s/ProgrammingTutorials", "URL: https://t.me.evil.example/s/FakeLife",
      "URL: https://t.me/s/CareerBreak", "URL: https://t.me/s/ThirdChannel", "URL: https://t.me/+privateInvite",
    ].join("\n") }] } });
    vi.mocked(ctx.transport.text).mockImplementation(async target => target.includes("mcp.exa.ai") ? (format === "json" ? envelope : `event: message\r\ndata: ${envelope}\r\n\r\n`) : preview(target.split("/").at(-1)!));
    const result = await adapter("telegram").collect(ctx);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toMatchObject({ sourceUrl: "https://t.me/TravelLife/42", publishedAt: "2026-10-20T12:00:00Z", discussion: { postId: "TravelLife/42", kind: "post" } });
    expect(ctx.transport.text).toHaveBeenCalledTimes(3);
    expect(ctx.transport.json).not.toHaveBeenCalled();
    expect(result.warnings.join(" ")).toContain("discussion replies");
    const request = JSON.parse(String(vi.mocked(ctx.transport.text).mock.calls[0][2]?.body));
    expect(request.params.arguments.query).toContain("site:t.me/s/");
  });

  it("uses keyed Exa without anonymous fallback and rejects failed MCP envelopes", async () => {
    const ctx = context({ EXA_API_KEY: "fixture-key" });
    vi.mocked(ctx.transport.json).mockResolvedValue({ results: [{ url: "https://t.me/s/TravelLife" }] });
    vi.mocked(ctx.transport.text).mockResolvedValue(preview("TravelLife"));
    expect((await adapter("telegram").collect(ctx)).records).toHaveLength(1);
    expect(vi.mocked(ctx.transport.json).mock.calls[0][0]).toBe("https://api.exa.ai/search");
    const anonymous = context();
    vi.mocked(anonymous.transport.text).mockResolvedValue(JSON.stringify({ result: { isError: true, content: [{ type: "text", text: "quota" }] } }));
    await expect(adapter("telegram").collect(anonymous)).rejects.toThrow("discovery service");
    expect(anonymous.transport.text).toHaveBeenCalledTimes(1);
  });

  it("retains accessible Telegram previews when another page is blocked", async () => {
    const ctx = context({ EXA_API_KEY: "fixture-key" });
    vi.mocked(ctx.transport.json).mockResolvedValue({ results: [{ url: "https://t.me/s/BlockedLife" }, { url: "https://t.me/s/TravelLife" }] });
    vi.mocked(ctx.transport.text).mockImplementation(async target => {
      if (target.endsWith("BlockedLife")) throw new Error("HTTP 403");
      return preview("TravelLife");
    });
    const result = await adapter("telegram").collect(ctx);
    expect(result.records).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("could not be read");
  });

  it("collects real YouTube replies with direct-parent context and a four-call ceiling", async () => {
    const ctx = context({ YOUTUBE_API_KEY: "fixture-key" });
    const comment = (id: string, parentId?: string) => ({ id, snippet: { textOriginal: parentId ? "I had a different experience because my savings ran out." : "My gap year helped me understand what I wanted to study.", parentId, publishedAt: "2026-10-20T12:00:00Z" } });
    vi.mocked(ctx.transport.json).mockImplementation(async target => {
      const parsed = new URL(target);
      expect(parsed.searchParams.has("relevanceLanguage")).toBe(false);
      if (parsed.pathname.endsWith("/search")) return { items: [{ id: { videoId: "abcdefghijk" }, snippet: { title: "Gap year discussion", description: "Do not use this as video transcript" } }] };
      if (parsed.pathname.endsWith("/commentThreads")) return { items: ["parent1", "parent2", "parent3"].map(id => ({ snippet: { videoId: "abcdefghijk", topLevelComment: comment(id), totalReplyCount: 7 }, replies: { comments: [comment(`${id}-r1`, id)] } })) };
      const parent = parsed.searchParams.get("parentId")!;
      return { items: [comment(`${parent}-r1`, parent), comment(`${parent}.reply2`, parent), comment("foreign-reply", "wrong-parent")], nextPageToken: "omitted" };
    });
    const result = await adapter("youtube").collect(ctx);
    expect(ctx.transport.json).toHaveBeenCalledTimes(4);
    expect(result.records).toHaveLength(8);
    const reply = result.records.find(record => record.discussion?.postId === "parent1.reply2");
    expect(reply?.discussion).toMatchObject({ parentId: "parent1", kind: "reply", parentText: "My gap year helped me understand what I wanted to study." });
    expect(reply?.sourceUrl).toBe("https://www.youtube.com/watch?v=abcdefghijk&lc=parent1.reply2");
    expect(result.records.some(record => record.text.includes("transcript"))).toBe(false);
    expect(result.records.some(record => record.discussion?.postId === "foreign-reply")).toBe(false);
  });

  it("does not call credentialed social services without their configured keys", async () => {
    const ctx = context();
    for (const source of ["youtube", "x"] as const) expect((await adapter(source).collect(ctx)).status).toBe("not_configured");
    expect(ctx.transport.json).not.toHaveBeenCalled();
  });

  it("preserves X conversation parents, rejects foreign conversations and caps searches", async () => {
    const ctx = context({ X_BEARER_TOKEN: "fixture-key" });
    vi.mocked(ctx.transport.json).mockImplementation(async (target, _signal, init) => {
      const parsed = new URL(target), query = parsed.searchParams.get("query")!;
      expect(parsed.hostname).toBe("api.x.com");
      expect(query).not.toMatch(/\blang:/);
      expect(parsed.searchParams.get("max_results")).toBe("10");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer fixture-key");
      if (!query.startsWith("conversation_id:")) return { data: ["10", "20", "30"].map(id => ({ id, conversation_id: id, lang: "es", text: "Me tomé un año libre y ahorré antes de viajar." })) };
      const conversation = query.match(/conversation_id:(\d+)/)![1];
      return { data: [
        { id: `${conversation}1`, conversation_id: conversation, lang: "es", text: "No estoy de acuerdo porque viajar puede ser caro.", referenced_tweets: [{ type: "replied_to", id: conversation }] },
        { id: `${conversation}2`, conversation_id: conversation, lang: "en", text: "I think the same thing happened to me.", referenced_tweets: [{ type: "replied_to", id: "999" }] },
        { id: `${conversation}3`, conversation_id: "444", lang: "en", text: "Unrelated conversation" },
      ], meta: { next_token: "omitted" } };
    });
    const result = await adapter("x").collect(ctx);
    expect(ctx.transport.json).toHaveBeenCalledTimes(3);
    expect(result.records).toHaveLength(6);
    expect(result.records[1].discussion).toMatchObject({ parentId: "10", parentText: "Me tomé un año libre y ahorré antes de viajar.", threadUrl: "https://x.com/i/web/status/10" });
    expect(result.records[2].discussion?.parentText).toBeUndefined();
    expect(result.records[2].limitations.join(" ")).toContain("direct parent was outside");
  });

  it("retains X roots after a reply error without exposing provider error bodies", async () => {
    const ctx = context({ X_BEARER_TOKEN: "fixture-key" });
    vi.mocked(ctx.transport.json).mockResolvedValueOnce({ data: [{ id: "10", conversation_id: "10", lang: "en", text: "I enjoyed taking time to travel before studying." }] }).mockRejectedValueOnce(new Error("sensitive upstream body"));
    const result = await adapter("x").collect(ctx);
    expect(result.records).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("conversation page was unavailable");
    expect(result.warnings.join(" ")).not.toContain("sensitive");
  });
});
