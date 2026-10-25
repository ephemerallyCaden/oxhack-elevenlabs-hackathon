import { describe, expect, it, vi } from "vitest";
import { forumAdapters } from "./community-forums";
import type { CommunityContext } from "./community-types";

function context(query: string, responses: unknown[]): CommunityContext {
  let index = 0;
  return { query, env: {}, signal: new AbortController().signal, now: () => Date.parse("2026-10-25T12:00:00Z"), transport: {
    json: vi.fn(async () => { const response = responses[index++]; if (response instanceof Error) throw response; return response; }),
    text: vi.fn(async () => ""),
  } };
}
const adapter = (id: string) => forumAdapters.find(item => item.id === id)!;
describe("curated forum APIs", () => {
  it("fetches a life-topic question, answers and comments with correct parents", async () => {
    const ctx = context("dog adoption wellbeing", [
      { items: [{ question_id: 10, link: "https://pets.stackexchange.com/questions/10/adoption", title: "Adopting a dog", body: "<p>Can I care for a dog?</p>", creation_date: 1704067200 }] },
      { items: [{ answer_id: 20, question_id: 10, body: "<p>Consider regular walks and veterinary costs.</p>", creation_date: 1704153600 }] },
      { items: [{ comment_id: 30, post_id: 10, body: "Do you have time every day?", creation_date: 1704240000 }] },
    ]);
    const result = await adapter("stackexchange").collect(ctx);
    expect(result.records).toHaveLength(3);
    expect(result.records.map(record => record.publishedAt)).toEqual(["2024-01-01T00:00:00.000Z", "2024-01-02T00:00:00.000Z", "2024-01-03T00:00:00.000Z"]);
    expect(result.records[1].discussion).toMatchObject({ parentId: "10", parentText: "Can I care for a dog?", kind: "reply" });
    expect(ctx.transport.json).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ctx.transport.json).mock.calls[0][0]).toContain("site=pets");
    expect(vi.mocked(ctx.transport.json).mock.calls[0][0]).not.toContain("wellbeing");
  });
  it("honors Stack Exchange backoff before fetching additional pages", async () => {
    const ctx = context("moving abroad", [{ items: [], backoff: 30 }]);
    expect(await adapter("stackexchange").collect(ctx)).toMatchObject({ status: "rate_limited", records: [], retryAt: "2026-10-25T12:00:30.000Z" });
    expect(ctx.transport.json).toHaveBeenCalledTimes(1);
  });
  it("does not accept a technical or attacker-owned question origin", async () => {
    const ctx = context("dog adoption", [{ items: [{ question_id: 1, link: "https://stackoverflow.com/questions/1", title: "Dog", body: "Dog" }] }]);
    await expect(adapter("stackexchange").collect(ctx)).rejects.toThrow("Unexpected community source URL");
    expect(forumAdapters.every(item => !item.matches("kernel programming tutorial"))).toBe(true);
  });
  it("retains a fetched original when reply access is denied, without another-source fallback", async () => {
    const ctx = context("job career", [{ items: [{ question_id: 1, link: "https://workplace.stackexchange.com/questions/1/job", title: "Job", body: "Should I leave this job?" }] }, new Error("403")]);
    const result = await adapter("stackexchange").collect(ctx);
    expect(result.records).toHaveLength(1);
    expect(result.warnings.join(" ")).toContain("could not be retrieved");
    expect(ctx.transport.json).toHaveBeenCalledTimes(2);
  });
  it("reads Discourse originals rather than search blurbs and omits orphan replies", async () => {
    const ctx = context("moving abroad", [{ topics: [{ id: 100, title: "Moving" }] }, { id: 100, title: "Moving", post_stream: { posts: [
      { id: 1, post_number: 1, cooked: "<p>Considering a move.</p>", created_at: "2024-01-01T00:00:00Z" },
      { id: 2, post_number: 2, cooked: "<p>Visit first.</p>", reply_to_post_number: 1, created_at: "2024-01-02T00:00:00Z" },
      { id: 3, post_number: 3, cooked: "Missing context", reply_to_post_number: 99 },
    ] } }]);
    const result = await adapter("discourse").collect(ctx);
    expect(result.records).toHaveLength(2);
    expect(result.records.map(record => record.publishedAt)).toEqual(["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z"]);
    expect(result.records[1].discussion).toMatchObject({ parentText: "Considering a move.", parentId: "1" });
    expect(result.warnings.join(" ")).toContain("unavailable parent");
    expect(ctx.transport.json).toHaveBeenCalledTimes(2);
  });
  it("loads WordPress comments with nested context and excludes mismatched posts", async () => {
    const ctx = context("gap year", [[{ id: 1, link: "https://www.nomadicmatt.com/gap-year/", title: { rendered: "Gap year" }, content: { rendered: "<p>Travel takes planning.</p>" }, date_gmt: "2024-01-01T00:00:00" }], [
      { id: 2, post: 1, parent: 0, link: "https://www.nomadicmatt.com/gap-year/#comment-2", content: { rendered: "Save first." }, date_gmt: "2024-01-02T00:00:00" },
      { id: 3, post: 1, parent: 2, link: "https://www.nomadicmatt.com/gap-year/#comment-3", content: { rendered: "A savings cushion helped me." } },
      { id: 4, post: 999, parent: 0, link: "https://www.nomadicmatt.com/other/", content: { rendered: "Unrelated" } },
    ]]);
    const result = await adapter("wordpress").collect(ctx);
    expect(result.records).toHaveLength(3);
    expect(result.records.map(record => record.publishedAt)).toEqual(["2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", undefined]);
    expect(result.records[2].discussion).toMatchObject({ parentId: "2", parentText: "Save first." });
    expect(ctx.transport.json).toHaveBeenCalledTimes(2);
  });
  it("does not turn gap-year or ordinary travel requests into relocation searches", async () => {
    const source = adapter("discourse");
    for (const query of ["gap year wellbeing", "travel budget", "backpacking abroad"]) {
      const ctx = context(query, []);
      expect(source.matches(query)).toBe(false);
      expect((await source.collect(ctx)).records).toEqual([]);
      expect(ctx.transport.json).not.toHaveBeenCalled();
    }
    expect(source.matches("international relocation wellbeing")).toBe(true);
    expect(source.matches("expatriate experiences")).toBe(true);
  });
  it("propagates cancellation instead of returning a partial success", async () => {
    const controller = new AbortController();
    const ctx = context("gap year", [[{ id: 1, link: "https://www.nomadicmatt.com/gap-year/", title: { rendered: "Gap year" }, content: { rendered: "Travel planning." } }]]);
    ctx.signal = controller.signal;
    vi.mocked(ctx.transport.json).mockImplementationOnce(async () => [{ id: 1, link: "https://www.nomadicmatt.com/gap-year/", title: { rendered: "Gap year" }, content: { rendered: "Travel planning." } }]).mockImplementationOnce(async () => { controller.abort(); throw new Error("aborted"); });
    await expect(adapter("wordpress").collect(ctx)).rejects.toThrow();
  });
});
