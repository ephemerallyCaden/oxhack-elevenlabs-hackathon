import { expect, it, vi } from "vitest";
import { referenceAdapters } from "./community-reference";

it("retains publication abstracts regardless of language metadata while omitting title-only records", async () => {
  const json = vi.fn().mockResolvedValue({ message: { items: [
    { DOI: "10.1234/example", title: ["Viajar y aprender"], abstract: "Un viaje puede cambiar nuestra perspectiva.", language: "es" },
    { DOI: "10.1234/missing", title: ["Only a title"], language: "en" },
  ] } });
  const result = await referenceAdapters.find(adapter => adapter.id === "crossref")!.collect({
    query: "travel wellbeing", signal: new AbortController().signal, env: {}, now: () => 0,
    transport: { json, text: vi.fn() },
  });
  expect(result.records).toHaveLength(1);
  expect(result.records[0].text).toBe("Un viaje puede cambiar nuestra perspectiva.");
  expect(result.warnings.join(" ")).toContain("1 title-only or invalid");
});

it("uses a supported extract size, skips missing extracts and rejects API errors", async () => {
  const json = vi.fn().mockResolvedValue({ query: { pages: [
    { pageid: 1, title: "Missing extract" },
    { pageid: 2, title: "Gap year", fullurl: "https://en.wikipedia.org/wiki/Gap_year", extract: "A gap year is a period of time away from formal study, often used for travel, work or volunteering." },
  ] } });
  const ctx = { query: "gap year", signal: new AbortController().signal, env: {}, now: () => 0, transport: { json, text: vi.fn() } };
  const adapter = referenceAdapters.find(item => item.id === "wikipedia")!;
  expect((await adapter.collect(ctx)).records).toHaveLength(1);
  expect(new URL(json.mock.calls[0][0]).searchParams.get("exchars")).toBe("1200");
  json.mockResolvedValue({ error: { code: "badvalue" } });
  await expect(adapter.collect(ctx)).rejects.toThrow("rejected");
});
