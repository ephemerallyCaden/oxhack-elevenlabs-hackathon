import { z } from "zod";
import type { CollectionReport } from "./collection-fetch";
import type { CommunityAdapter, CommunityContext } from "./community-types";
import { communityRecord, htmlText } from "./community-utils";

const id = z.number().int().positive();
const body = z.string().min(1).max(200000);
const envelope = z.object({ items: z.array(z.unknown()), backoff: z.number().nonnegative().optional(), error_id: z.number().optional() });
const coverage = "Bounded first page of one selected discussion; replies are opinions, not representative evidence.";
const report = (): CollectionReport => ({ status: "live", records: [], warnings: [coverage] });
const routes: [RegExp, string, string][] = [
  [/\b(?:dog|pet|adopt)\b/i, "pets", "dog adoption"],
  [/\b(?:parent\w*|child\w*|baby)\b/i, "parenting", "parenting"],
  [/\b(?:moving|relocat|abroad|expat)/i, "expatriates", "moving abroad"],
  [/\b(?:job|career|quit|resign)/i, "workplace", "leaving job"],
  [/\b(?:gap year|university|college)/i, "academia", "gap year"],
  [/\b(?:travel|backpack)/i, "travel", "long term travel"],
];
const route = (query: string) => routes.find(([pattern]) => pattern.test(query));
const relocation = /\b(?:moving|relocat|expat|emigrat|immigrat)/i;
const timestamp = z.number().int().nonnegative().max(253402300799).optional();
const isoDate = (seconds: number | undefined) => seconds === undefined ? undefined : new Date(seconds * 1000).toISOString();
const wpDate = (value: string | null | undefined) => value && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}Z`)) ? `${value}Z` : undefined;
const travelBlog = /\b(?:gap year|travel|backpack)/i;
function sourceUrl(value: string, host: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== host || url.port || url.username || url.password) throw new Error("Unexpected community source URL");
  return url.toString();
}
function backoff(data: z.infer<typeof envelope>, result: CollectionReport, ctx: CommunityContext): boolean {
  if (data.backoff !== undefined) {
    result.status = "rate_limited";
    result.retryAt = new Date(ctx.now() + Math.min(data.backoff, 86400) * 1000).toISOString();
    result.warnings.push("Stack Exchange requested backoff; no further requests were made.");
    return true;
  }
  if (data.error_id !== undefined) throw new Error("Stack Exchange rejected the request");
  return false;
}
const stackexchange: CommunityAdapter = {
  id: "stackexchange", hosts: ["api.stackexchange.com"],
  capabilities: { discovery: "Fixed life-topic Stack Exchange sites", replies: "Up to three answers and two question comments", pagination: "One page per endpoint, three requests maximum" },
  matches: query => !!route(query), configured: () => true,
  async collect(ctx) {
    const result = report(); const selected = route(ctx.query);
    if (!selected) return result;
    const [, site, query] = selected; const host = `${site}.stackexchange.com`;
    const get = async (path: string, params: Record<string, string>) => {
      const search = new URLSearchParams({ site, filter: "withbody", ...params });
      return envelope.parse(await ctx.transport.json(`https://api.stackexchange.com/2.3/${path}?${search}`, ctx.signal));
    };
    const found = await get("search/advanced", { q: query, sort: "relevance", pagesize: "1" });
    const stopAfterQuestion = backoff(found, result, ctx);
    if (!found.items.length) return result;
    const question = z.object({ question_id: id, link: z.string(), title: body, body, creation_date: timestamp }).parse(found.items[0]);
    const url = sourceUrl(question.link, host); const title = htmlText(question.title);
    if (!new URL(url).pathname.startsWith(`/questions/${question.question_id}/`)) throw new Error("Unexpected Stack Exchange question link");
    const parentText = htmlText(question.body);
    result.records.push(communityRecord("stackexchange", { url, title, text: question.body, textFormat: "html", publishedAt: isoDate(question.creation_date), threadUrl: url, postId: String(question.question_id), kind: "post", limitations: ["Stack Exchange contributions retain their original attribution and license at the linked source."] }, ctx.now));
    if (stopAfterQuestion) return result;
    try {
      const answers = await get(`questions/${question.question_id}/answers`, { sort: "votes", order: "desc", pagesize: "3" });
      const stopAfterAnswers = backoff(answers, result, ctx);
      for (const raw of answers.items.slice(0, 3)) {
        const answer = z.object({ answer_id: id, question_id: id, body, creation_date: timestamp }).parse(raw);
        if (answer.question_id !== question.question_id) continue;
        result.records.push(communityRecord("stackexchange", { url: `https://${host}/a/${answer.answer_id}`, title, text: answer.body, textFormat: "html", publishedAt: isoDate(answer.creation_date), threadUrl: url, postId: String(answer.answer_id), parentId: String(question.question_id), parentText, kind: "reply" }, ctx.now));
      }
      if (stopAfterAnswers) return result;
      const comments = await get(`questions/${question.question_id}/comments`, { sort: "creation", order: "asc", pagesize: "2" });
      backoff(comments, result, ctx);
      for (const raw of comments.items.slice(0, 2)) {
        const comment = z.object({ comment_id: id, post_id: id, body, creation_date: timestamp }).parse(raw);
        if (comment.post_id !== question.question_id) continue;
        result.records.push(communityRecord("stackexchange", { url: `${url}#comment${comment.comment_id}_${question.question_id}`, title, text: comment.body, textFormat: "html", publishedAt: isoDate(comment.creation_date), threadUrl: url, postId: String(comment.comment_id), parentId: String(question.question_id), parentText, kind: "reply" }, ctx.now));
      }
    } catch (error) {
      ctx.signal.throwIfAborted();
      result.warnings.push("Some Stack Exchange replies could not be retrieved; only successfully fetched content is retained.");
      if (!result.records.length) throw error;
    }
    return result;
  },
};
const discourse: CommunityAdapter = {
  id: "discourse", hosts: ["community.nomadgate.com"],
  capabilities: { discovery: "Nomad Gate international relocation community search", replies: "Up to five replies with available parent context", pagination: "First topic page only, two requests maximum" },
  matches: query => relocation.test(query), configured: () => true,
  async collect(ctx) {
    const result = report(); if (!relocation.test(ctx.query)) return result;
    const origin = "https://community.nomadgate.com";
    const found = z.object({ topics: z.array(z.object({ id, title: body })) }).parse(await ctx.transport.json(`${origin}/search.json?q=${encodeURIComponent("moving abroad")}`, ctx.signal));
    const topic = found.topics[0]; if (!topic) return result;
    const postSchema = z.object({ id, topic_id: id.optional(), post_number: id, cooked: body, created_at: z.string().optional(), reply_to_post_number: id.nullable().optional() });
    const data = z.object({ id, title: body, post_stream: z.object({ posts: z.array(postSchema) }) }).parse(await ctx.transport.json(`${origin}/t/${topic.id}.json`, ctx.signal));
    if (data.id !== topic.id) throw new Error("Unexpected Discourse topic");
    const original = data.post_stream.posts.find(post => post.post_number === 1 && (post.topic_id === undefined || post.topic_id === topic.id));
    if (!original) { result.warnings.push("Original post missing; contextual replies omitted."); return result; }
    const threadUrl = `${origin}/t/${topic.id}`;
    for (const post of [original, ...data.post_stream.posts.filter(post => post.post_number !== 1)].slice(0, 6)) {
      if (post.topic_id !== undefined && post.topic_id !== topic.id) continue;
      const parent = post.post_number === 1 ? undefined : data.post_stream.posts.find(item => item.post_number === (post.reply_to_post_number ?? 1));
      if (post.post_number !== 1 && (!parent || (parent.topic_id !== undefined && parent.topic_id !== topic.id))) { result.warnings.push("A reply with unavailable parent context was omitted."); continue; }
      result.records.push(communityRecord("discourse", { url: `${threadUrl}/${post.post_number}`, title: data.title, text: post.cooked, textFormat: "html", publishedAt: post.created_at, limitations: ["International relocation community; experiences may not apply to domestic moves or your jurisdiction."], threadUrl, postId: String(post.id), parentId: parent ? String(parent.id) : undefined, parentText: parent ? htmlText(parent.cooked) : undefined, kind: parent ? "reply" : "post" }, ctx.now));
    }
    return result;
  },
};
const wordpress: CommunityAdapter = {
  id: "wordpress", hosts: ["www.nomadicmatt.com"],
  capabilities: { discovery: "Nomadic Matt travel posts", replies: "Up to five public comments with parent context", pagination: "One post and first comment page, two requests maximum" },
  matches: query => travelBlog.test(query), configured: () => true,
  async collect(ctx) {
    const result = report(); if (!travelBlog.test(ctx.query)) return result;
    const origin = "https://www.nomadicmatt.com";
    const rendered = z.object({ rendered: body });
    const search = /wellbeing|happiness|independen|solo/i.test(ctx.query) ? "travel alone" : "travel budget";
    const posts = z.array(z.object({ id, link: z.string(), title: rendered, content: rendered, date_gmt: z.string().nullable().optional() })).parse(await ctx.transport.json(`${origin}/wp-json/wp/v2/posts?search=${encodeURIComponent(search)}&search_columns[]=post_title&per_page=1&orderby=relevance&_fields=id,link,title,content,date_gmt`, ctx.signal));
    const post = posts[0]; if (!post) return result;
    const url = sourceUrl(post.link, "www.nomadicmatt.com"); const title = htmlText(post.title.rendered);
    result.records.push(communityRecord("wordpress", { url, title, text: post.content.rendered, textFormat: "html", publishedAt: wpDate(post.date_gmt), threadUrl: url, postId: String(post.id), kind: "post", limitations: ["Travel blog content may contain affiliate marketing or commercial recommendations."] }, ctx.now));
    try {
      const comments = z.array(z.object({ id, post: id, parent: z.number().int().nonnegative(), link: z.string(), content: rendered, date_gmt: z.string().nullable().optional() })).parse(await ctx.transport.json(`${origin}/wp-json/wp/v2/comments?post=${post.id}&per_page=5&order=asc&_fields=id,post,parent,link,content,date_gmt`, ctx.signal));
      for (const comment of comments.slice(0, 5)) {
        if (comment.post !== post.id) continue;
        const commentUrl = sourceUrl(comment.link, "www.nomadicmatt.com");
        if (new URL(commentUrl).pathname !== new URL(url).pathname || new URL(commentUrl).hash !== `#comment-${comment.id}`) { result.warnings.push("A comment link outside its selected post was omitted."); continue; }
        const parent = comment.parent ? comments.find(item => item.id === comment.parent && item.post === post.id) : undefined;
        if (comment.parent && !parent) { result.warnings.push("A comment with unavailable parent context was omitted."); continue; }
        result.records.push(communityRecord("wordpress", { url: commentUrl, title, text: comment.content.rendered, textFormat: "html", publishedAt: wpDate(comment.date_gmt), threadUrl: url, postId: String(comment.id), parentId: String(parent?.id ?? post.id), parentText: htmlText(parent?.content.rendered ?? post.content.rendered), kind: "reply" }, ctx.now));
      }
    } catch {
      ctx.signal.throwIfAborted();
      result.warnings.push("Public comments could not be retrieved; the original blog post is retained without assumed replies.");
    }
    return result;
  },
};
export const forumAdapters: CommunityAdapter[] = [stackexchange, discourse, wordpress];
