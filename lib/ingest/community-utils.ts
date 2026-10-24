import { load } from "cheerio";
import type { CommunityRecordFactory } from "./community-types";

/** Parse bounded markup without running scripts, loading resources or fetching links. */
export function htmlText(value: string, omitQuotes = false): string {
  const $ = load(value.slice(0, 200000), {}, false);
  $("script,style,iframe,noscript").remove();
  if (omitQuotes) $("aside.quote,blockquote,.gmail_quote").remove();
  $("br").replaceWith("\n");
  $("p,div,li,blockquote,h1,h2,h3").append("\n");
  return $.root().text().replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
}

export const communityRecord: CommunityRecordFactory = (source, input, now) => ({
  id: "", collector: source, sourceUrl: input.url, title: input.title.trim().slice(0, 300) || "Public source",
  text: (input.textFormat === "html" ? htmlText(input.text, input.kind === "reply") : input.text.trim()).slice(0, 12000), capturedAt: new Date(now()).toISOString(), captureMode: "live", verified: false,
  ...(input.publishedAt && Number.isFinite(Date.parse(input.publishedAt)) ? { publishedAt: input.publishedAt } : {}),
  limitations: ["Only a bounded public search sample was read; omitted posts, later edits and corrections may change its meaning.",
    ...(["stackexchange", "discourse", "telegram", "youtube", "x"].includes(source) || input.kind === "reply"
      ? ["Public user discussion: personal experiences or opinions, not representative statistics or independently verified facts."]
      : ["Publisher text or reference material; completeness, relevance and accuracy have not been independently verified."]),
    ...(input.kind === "reply" ? ["Parent context reflects the fetched version, not necessarily its wording when this reply was published."] : []),
    ...((input.parentText?.length ?? 0) > 1500 ? ["Parent context was shortened to 1500 characters; omitted qualifications may matter."] : []),
    ...(input.limitations ?? [])],
  ...(input.threadUrl && input.postId ? { discussion: {
    threadUrl: input.threadUrl, postId: input.postId, kind: input.kind ?? "post",
    ...(input.parentId ? { parentId: input.parentId } : {}),
    ...(input.parentText ? { parentText: input.parentText.trim().slice(0, 1500) } : {}),
    coverage: "A bounded portion of the discussion, not its complete history or all replies.",
  } } : {}),
});
