import { load } from "cheerio";
import type { CollectionReport } from "./collection-fetch";
import type { CommunityAdapter, CommunityRecordInput } from "./community-types";
import { communityRecord, htmlText } from "./community-utils";
import { searchExa } from "./exa-search";

type Row = Record<string, unknown>;
const obj = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.slice(0, 30).map(obj) : [];
const str = (value: unknown): string => typeof value === "string" ? value : "";
const id = (value: unknown): string => /^[A-Za-z0-9_-]{1,150}$/.test(str(value)) ? str(value) : "";
const opinion = "Public community opinion, not a verified fact or representative sample.";
const finish = (records: CollectionReport["records"], warnings: string[]): CollectionReport => ({ status: "live", records, warnings });
const missing = (name: string): CollectionReport => ({ status: "not_configured", records: [], warnings: [`${name} is not configured.`] });
const url = (base: string, params: Record<string, string>) => `${base}?${new URLSearchParams(params)}`;

function channelFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.hostname !== "t.me" || parsed.port || parsed.username || parsed.password) return null;
    const match = /^\/s\/([A-Za-z][A-Za-z0-9_]{3,31})(?:\/\d+)?\/?$/.exec(parsed.pathname);
    if (!match || /linux|programming|coding|developer|hacker|crypto|web3/i.test(match[1])) return null;
    return match[1];
  } catch { return null; }
}

const telegram: CommunityAdapter = {
  id: "telegram", hosts: ["api.exa.ai", "mcp.exa.ai", "t.me"],
  capabilities: { discovery: "Exa web index discovers public channel previews; not native global Telegram search", replies: "No discussion replies", pagination: "At most two preview pages; no history pagination" },
  matches: () => true, configured: () => true,
  async collect(ctx) {
    const query = `${ctx.query} life experience site:t.me/s/`;
    const results = await searchExa({ query, domains: ["t.me"], apiKey: ctx.env.EXA_API_KEY,
      transport: ctx.transport, signal: ctx.signal });
    const links = results.map(result => result.url);
    const channels = [...new Set(links.map(channelFromUrl).filter((name): name is string => !!name))].slice(0, 2);
    const records: CollectionReport["records"] = [];
    const warnings = ["Web-index discovery and at most two public Telegram previews only; private posts, media, discussion replies and older history are omitted."];
    for (const channel of channels) {
      try {
        const $ = load(await ctx.transport.text(`https://t.me/s/${channel}`, ctx.signal));
        const seen = new Set<string>();
        $("[data-post]").slice(-10).each((_, node) => {
          const post = $(node).attr("data-post") ?? "";
          if (!new RegExp(`^${channel}/\\d+$`, "i").test(post) || seen.has(post)) return;
          seen.add(post);
          const text = htmlText($(node).find(".tgme_widget_message_text").html() ?? "");
          if (!text) return;
          records.push(communityRecord("telegram", { url: `https://t.me/${post}`, title: `Public channel @${channel}`, text,
            postId: post, threadUrl: `https://t.me/${post}`, publishedAt: $(node).find("time").attr("datetime"), kind: "post", limitations: [opinion, warnings[0]] }, ctx.now));
        });
      } catch { ctx.signal.throwIfAborted(); warnings.push("A discovered Telegram preview could not be read; coverage is incomplete."); }
    }
    return finish(records, warnings);
  },
};

function youtubeComment(row: Row, videoId: string, title: string, parent?: CommunityRecordInput): CommunityRecordInput | null {
  const snippet = obj(row.snippet), rawId = str(row.id);
  const postId = rawId.length > 0 && rawId.length <= 150 && !/[\s\u0000-\u001f\u007f]/.test(rawId) ? rawId : "";
  if (!postId || (parent && str(snippet.parentId) !== parent.postId)) return null;
  const text = str(snippet.textOriginal) || str(snippet.textDisplay);
  if (!text.trim()) return null;
  return { url: url("https://www.youtube.com/watch", { v: videoId, lc: postId }), title, text,
    publishedAt: str(snippet.publishedAt), threadUrl: `https://www.youtube.com/watch?v=${videoId}`,
    postId, parentId: parent?.postId, parentText: parent?.text, kind: parent ? "reply" : "post",
    limitations: [opinion, "Video comments only; no video transcript or audiovisual content was collected.",
      ...(!str(snippet.textOriginal) ? ["Provider display text was supplied; link labels or formatting may differ from the original comment."] : [])] };
}

const youtube: CommunityAdapter = {
  id: "youtube", hosts: ["www.googleapis.com"],
  capabilities: { discovery: "Official video search", replies: "Top-level comments and up to two reply pages", pagination: "One video, ten threads and up to two reply pages; at most four API calls" },
  matches: () => true, configured: env => !!env.YOUTUBE_API_KEY?.trim(),
  async collect(ctx) {
    const key = ctx.env.YOUTUBE_API_KEY?.trim();
    if (!key) return missing("YOUTUBE_API_KEY");
    const api = async (method: string, params: Record<string, string>) => {
      const result = obj(await ctx.transport.json(url(`https://www.googleapis.com/youtube/v3/${method}`, { ...params, key }), ctx.signal));
      if (result.error || !Array.isArray(result.items)) throw new Error("YouTube returned an unreadable response.");
      return result;
    };
    const search = await api("search", { part: "snippet", type: "video", q: ctx.query, safeSearch: "strict", maxResults: "1" });
    const video = rows(search.items)[0], videoId = id(obj(video?.id).videoId);
    const warnings = ["Bounded YouTube search and comments; rankings are not representative sampling. Unfetched comment pages are omitted."];
    if (!videoId || videoId.length !== 11) return finish([], warnings);
    const title = htmlText(str(obj(video.snippet).title)) || "YouTube discussion";
    const threads = await api("commentThreads", { part: "snippet,replies", videoId, maxResults: "10", textFormat: "plainText", order: "relevance" });
    const records: CollectionReport["records"] = [], pending: CommunityRecordInput[] = [];
    const seen = new Set<string>();
    const add = (input: CommunityRecordInput | null) => {
      if (input && !seen.has(input.postId!)) { seen.add(input.postId!); records.push(communityRecord("youtube", input, ctx.now)); }
    };
    for (const thread of rows(threads.items).slice(0, 10)) {
      const snippet = obj(thread.snippet);
      if (snippet.videoId && snippet.videoId !== videoId) continue;
      const parent = youtubeComment(obj(snippet.topLevelComment), videoId, title);
      if (!parent) continue;
      add(parent);
      const embedded = rows(obj(thread.replies).comments).slice(0, 5);
      for (const reply of embedded) add(youtubeComment(reply, videoId, title, parent));
      if (Number(snippet.totalReplyCount) > embedded.length) pending.push(parent);
    }
    for (const parent of pending.slice(0, 2)) {
      try {
        const replyPage = await api("comments", { part: "snippet", parentId: parent.postId!, maxResults: "10", textFormat: "plainText" });
        for (const reply of rows(replyPage.items).slice(0, 10)) add(youtubeComment(reply, videoId, title, parent));
      } catch { ctx.signal.throwIfAborted(); warnings.push("A YouTube reply page was unavailable; already fetched comments were retained."); }
    }
    return finish(records, warnings);
  },
};

const numericId = (value: unknown) => /^\d{1,25}$/.test(str(value)) ? str(value) : "";
const x: CommunityAdapter = {
  id: "x", hosts: ["api.x.com"],
  capabilities: { discovery: "Official recent post search", replies: "Conversation searches preserve reply IDs and available parent text", pagination: "One discovery page and at most two conversation pages; recent window only" },
  matches: () => true, configured: env => !!env.X_BEARER_TOKEN?.trim(),
  async collect(ctx) {
    const key = ctx.env.X_BEARER_TOKEN?.trim();
    if (!key) return missing("X_BEARER_TOKEN");
    const search = async (query: string) => {
      const result = obj(await ctx.transport.json(url("https://api.x.com/2/tweets/search/recent", {
        query, max_results: "10", "tweet.fields": "created_at,conversation_id,referenced_tweets", expansions: "referenced_tweets.id",
      }), ctx.signal, { headers: { Authorization: `Bearer ${key}` } }));
      if (!Array.isArray(result.data) && obj(result.meta).result_count !== 0) throw new Error("X returned an unreadable response.");
      return result;
    };
    const result = await search(`${ctx.query} -is:retweet -is:reply`);
    const records: CollectionReport["records"] = [], warnings = ["X recent-search window and at most two conversations only; posts are opinions, older and unfetched replies are omitted."];
    const roots = rows(result.data).filter(row => numericId(row.id) && !rows(row.referenced_tweets).some(ref => ref.type === "replied_to")).slice(0, 2);
    const seen = new Set<string>();
    const add = (post: Row, conversation: string, context: Map<string, Row>) => {
      const postId = numericId(post.id), parentId = numericId(rows(post.referenced_tweets).find(ref => ref.type === "replied_to")?.id);
      if (!postId || seen.has(postId) || !str(post.text)) return;
      seen.add(postId);
      records.push(communityRecord("x", { url: `https://x.com/i/web/status/${postId}`, title: "X public discussion", text: str(post.text),
        postId, threadUrl: `https://x.com/i/web/status/${conversation}`, publishedAt: str(post.created_at),
        parentId: parentId || undefined, parentText: parentId ? str(context.get(parentId)?.text) || undefined : undefined,
        kind: parentId ? "reply" : "post", limitations: [opinion, warnings[0], ...(parentId && !context.has(parentId) ? ["The direct parent was outside the fetched sample; do not infer its content."] : [])] }, ctx.now));
    };
    for (const root of roots) {
      const conversation = numericId(root.conversation_id) || numericId(root.id);
      const context = new Map<string, Row>([[numericId(root.id), root]]);
      add(root, conversation, context);
      try {
        const page = await search(`conversation_id:${conversation} is:reply -is:retweet`);
        const replies = rows(page.data).filter(row => numericId(row.conversation_id) === conversation);
        for (const post of [...rows(obj(page.includes).tweets), ...replies]) if (numericId(post.id)) context.set(numericId(post.id), post);
        for (const post of replies) add(post, conversation, context);
      } catch { ctx.signal.throwIfAborted(); warnings.push("An X conversation page was unavailable; the fetched root post was retained."); }
    }
    return finish(records, warnings);
  },
};

export const socialAdapters: CommunityAdapter[] = [telegram, youtube, x];
