import type { CommunityTransport } from "./community-types";
import { CommunityHttpError } from "./community-http";

export type ExaResult = { url: string; title: string; text: string; highlights: string[]; publishedAt?: string };
type SearchOptions = { query: string; domains: readonly string[]; apiKey?: string; transport: CommunityTransport; signal: AbortSignal };
type Row = Record<string, unknown>;

const REST_ENDPOINT = "https://api.exa.ai/search";
const MCP_ENDPOINT = "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa";
const MCP_TOOL = "web_search_advanced_exa";
const MAX_RESULTS = 4;
const PAGE_TEXT_CHARS = 16000;
const HIGHLIGHT_CHARS = 1800;
const PASSAGE_CHARS = 3200;
const PASSAGE_LEAD_CHARS = 300;
const MIN_ANCHOR_CHARS = 40;

const obj = (value: unknown): Row => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;
const unreadable = () => new Error("Public discovery returned an unreadable response.");

/** A bare JSON body is one candidate; a finite SSE body contributes each event's joined `data:` lines. */
function rpcCandidates(body: string): string[] {
  if (body.trim().startsWith("{")) return [body];
  return body.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/)
    .filter(line => line.startsWith("data:"))
    .map(line => line.slice("data:".length).trimStart())
    .join("\n"));
}

/** The advanced MCP tool returns structured results as JSON text inside a JSON-RPC envelope. */
function mcpResults(body: string): Row {
  for (const candidate of rpcCandidates(body).slice(0, 40)) {
    let envelope: Row;
    try { envelope = obj(JSON.parse(candidate)); } catch { continue; }
    const result = obj(envelope.result);
    if (envelope.error || result.isError) {
      // MCP can report quota exhaustion inside an HTTP 200 tool error.
      const message = (JSON.stringify(envelope.error ?? result.content) ?? "").slice(0, 5000);
      if (/rate[ -]?limit|quota|too many requests/i.test(message)) throw new CommunityHttpError(429);
      throw new Error("Public discovery service returned an error.");
    }
    if (!Array.isArray(result.content)) continue;
    for (const item of result.content.slice(0, 10)) {
      const content = obj(item);
      if (content.type !== "text" || typeof content.text !== "string") continue;
      try {
        const parsed = obj(JSON.parse(content.text));
        if (Array.isArray(parsed.results)) return parsed;
      } catch { /* A non-JSON notice is not source material. */ }
    }
  }
  throw unreadable();
}

function toResult(value: unknown): ExaResult {
  const row = obj(value);
  const publishedAt = str(row.publishedDate);
  return {
    url: str(row.url) ?? "",
    title: str(row.title)?.slice(0, 300) ?? "Public source",
    text: str(row.text)?.slice(0, PAGE_TEXT_CHARS) ?? "",
    highlights: Array.isArray(row.highlights) ? row.highlights.filter((item): item is string => typeof item === "string").slice(0, 5) : [],
    ...(publishedAt && Number.isFinite(Date.parse(publishedAt)) ? { publishedAt } : {}),
  };
}

/** One bounded search: keyed REST when an API key is configured, otherwise the public MCP tool.
 * A keyed failure is never retried anonymously. */
export async function searchExa(options: SearchOptions): Promise<ExaResult[]> {
  const { query, domains, transport, signal } = options;
  const common = { query, numResults: MAX_RESULTS, type: "lite", includeDomains: domains };
  const key = options.apiKey?.trim();
  const response = key
    ? await transport.json(REST_ENDPOINT, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key },
      body: JSON.stringify({ ...common, contents: { text: { maxCharacters: PAGE_TEXT_CHARS }, highlights: { maxCharacters: HIGHLIGHT_CHARS } } }),
    })
    : mcpResults(await transport.text(MCP_ENDPOINT, signal, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: {
        name: MCP_TOOL,
        arguments: { ...common, textMaxCharacters: PAGE_TEXT_CHARS, enableHighlights: true, highlightsMaxCharacters: HIGHLIGHT_CHARS },
      } }),
    }));
  const results = obj(response).results;
  if (!Array.isArray(results)) throw unreadable();
  return results.slice(0, MAX_RESULTS).map(toResult);
}

/** Highlights can join distant spans with ellipses. Use them only to locate a continuous
 * window in the page text; never quote the joined highlight or a generated summary. */
export function searchPassage(result: ExaResult): string {
  for (const highlight of result.highlights) {
    for (const part of highlight.split(/\.{3}|…/)) {
      const anchor = part.trim();
      if (anchor.length < MIN_ANCHOR_CHARS) continue;
      const index = result.text.indexOf(anchor);
      if (index < 0) continue;
      const start = Math.max(0, index - PASSAGE_LEAD_CHARS);
      return result.text.slice(start, start + PASSAGE_CHARS);
    }
  }
  return result.text.slice(0, PASSAGE_CHARS);
}
