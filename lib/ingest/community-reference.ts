import { z } from "zod";
import type { CommunityAdapter } from "./community-types";
import { communityRecord } from "./community-utils";

const wiki: CommunityAdapter = {
  id: "wikipedia", hosts: ["en.wikipedia.org"], configured: () => true, matches: () => true,
  capabilities: { discovery: "Wikipedia page search", replies: "Not a discussion source", pagination: "One page, up to two extracts" },
  async collect(ctx) {
    const params = new URLSearchParams({ action: "query", format: "json", formatversion: "2", generator: "search",
      gsrsearch: ctx.query, gsrlimit: "2", gsrnamespace: "0", prop: "extracts|info", inprop: "url", exintro: "1", explaintext: "1", exchars: "1200" });
    const data = z.object({ error: z.unknown().optional(), query: z.object({ pages: z.array(z.object({ pageid: z.number().int().positive(), title: z.string(), extract: z.string().optional(), fullurl: z.string().optional() })) }).optional() })
      .parse(await ctx.transport.json(`https://en.wikipedia.org/w/api.php?${params}`, ctx.signal));
    if (data.error) throw new Error("Reference API rejected the request.");
    const records = (data.query?.pages ?? []).slice(0, 2).flatMap(page => {
      if (!page.fullurl || !page.extract) return [];
      let url: URL; try { url = new URL(page.fullurl); } catch { return []; }
      if (url.origin !== "https://en.wikipedia.org" || !url.pathname.startsWith("/wiki/") || page.extract.length < 80) return [];
      return [communityRecord("wikipedia", { url: url.toString(), title: page.title, text: page.extract,
        limitations: ["Wikipedia introduction only; a secondary reference, not an independently checked original study. Follow its citations for stronger evidence."] }, ctx.now)];
    });
    return { status: "live", records, warnings: ["Only two reference introductions were considered."] };
  },
};
const crossref: CommunityAdapter = {
  id: "crossref", hosts: ["api.crossref.org"], configured: () => true, matches: () => true,
  capabilities: { discovery: "Publication metadata and supplied abstracts", replies: "Not a discussion source", pagination: "One page, at most three abstracts; title-only results omitted" },
  async collect(ctx) {
    const params = new URLSearchParams({ query: ctx.query, rows: "3", select: "DOI,title,abstract,published" });
    const data = z.object({ message: z.object({ items: z.array(z.object({ DOI: z.string(), title: z.array(z.string()).optional(),
      abstract: z.string().optional() })) }) }).parse(await ctx.transport.json(`https://api.crossref.org/works?${params}`, ctx.signal));
    const records = data.message.items.slice(0, 3).flatMap(item => {
      if (!item.abstract || !/^10\.\d{4,9}\/.+/.test(item.DOI)) return [];
      return [communityRecord("crossref", { url: `https://doi.org/${item.DOI.split("/").map(encodeURIComponent).join("/")}`, title: item.title?.[0] ?? "Publication abstract", text: item.abstract, textFormat: "html",
        limitations: ["Publisher-supplied abstract in Crossref metadata, not full paper access or a guarantee of peer review, methodology or currentness."] }, ctx.now)];
    });
    return { status: "live", records, warnings: [`${data.message.items.length - records.length} title-only or invalid publication entries omitted.`] };
  },
};
export const referenceAdapters: CommunityAdapter[] = [wiki, crossref];
