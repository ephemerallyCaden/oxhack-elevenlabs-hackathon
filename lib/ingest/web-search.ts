import { normalizeRecords } from "./collection";
import type { CollectionReport } from "./collection-fetch";
import { CommunityHttpError, createCommunityTransport } from "./community-http";
import { searchExa, searchPassage, type ExaResult } from "./exa-search";
import { planWebQuery } from "./public-query";
import type { TopicResearchRequest } from "./research-contract";
import { withinDeadline } from "./research-control";
import { allowedEvidenceUrl, publicSearchHosts } from "./source-policy";

type Options = { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; now?: () => number };

const EXA_HOSTS = ["api.exa.ai", "mcp.exa.ai"];
// One request, capped so that most of the five-second quick budget is left for passage selection.
const SEARCH_MS = 2200;
const CACHE_ENTRIES = 64;
const CACHE_WITH_RECORDS_MS = 600000;
const CACHE_EMPTY_MS = 60000;
// Keyed access has no such limits. Keyless mcp.exa.ai allows 2 tool calls per second and 50 per
// day per IP, so space keyless calls out and treat its 429 as a short pause rather than a minute.
const KEYLESS_GAP_MS = 500;
const KEYLESS_BACKOFF_MS = 2000;
const KEYED_BACKOFF_MS = 60000;
const LIMITATIONS = [
  "Search-provider page excerpt; the original page was not independently fetched or verified.",
  "Only a bounded continuous excerpt is available; omitted page context may qualify this passage. Jurisdiction and dates may differ from the user's situation.",
];
const UNAVAILABLE = "Public web search was unavailable, rate-limited or exceeded its acquisition budget.";

/** The provider was asked for registered domains only; check again before any text becomes a record. */
const registered = (result: ExaResult) =>
  allowedEvidenceUrl(result.url) && publicSearchHosts.includes(new URL(result.url).hostname) && result.text.trim() !== "";

/** Bounded Exa search over the registered public hosts, shared by quick and deep research. */
export function createWebSearch(options: Options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const cooldown = new Map<string, number>();
  const cache = new Map<string, { until: number; report: CollectionReport }>();
  const enabled = () => env.RESEARCH_WEB_SEARCH?.trim() !== "none";
  const apiKey = () => env.EXA_API_KEY?.trim() || undefined;
  const backoffMs = () => apiKey() ? KEYED_BACKOFF_MS : KEYLESS_BACKOFF_MS;
  let nextKeylessStart = 0;

  /** Keyless calls start at most every KEYLESS_GAP_MS; a cancelled caller stops waiting. */
  async function pace(signal: AbortSignal): Promise<void> {
    if (apiKey()) return;
    const wait = nextKeylessStart - now();
    nextKeylessStart = Math.max(now(), nextKeylessStart) + KEYLESS_GAP_MS;
    if (wait <= 0) return;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { signal.removeEventListener("abort", stop); resolve(); }, wait);
      const stop = () => { clearTimeout(timer); reject(signal.reason ?? new Error("Search cancelled while pacing")); };
      signal.addEventListener("abort", stop, { once: true });
    });
  }

  async function search(query: string, signal: AbortSignal): Promise<CollectionReport> {
    await pace(signal);
    const transport = createCommunityTransport({ hosts: EXA_HOSTS, fetchImpl: options.fetchImpl, now, cooldown, minCooldownMs: backoffMs() });
    const results = await withinDeadline(
      bounded => searchExa({ query, domains: publicSearchHosts, apiKey: apiKey(), transport, signal: bounded }), SEARCH_MS, signal);
    signal.throwIfAborted();
    const capturedAt = new Date(now()).toISOString();
    const accepted = results.filter(registered);
    const normalized = normalizeRecords(accepted.map(result => ({
      sourceUrl: result.url, title: result.title || "Public source", text: searchPassage(result),
      collector: "exa", capturedAt, captureMode: "live", publishedAt: result.publishedAt, limitations: LIMITATIONS,
    })));
    return { status: "live", records: normalized.records, warnings: [
      ...normalized.warnings,
      ...(accepted.length !== results.length ? ["Search results without registered URLs or page text were omitted."] : []),
      "Search index coverage and freshness are limited; a domain does not establish factual correctness.",
    ] };
  }

  function failure(error: unknown): CollectionReport {
    if (!(error instanceof CommunityHttpError) || error.status !== 429) return { status: "unavailable", records: [], warnings: [UNAVAILABLE] };
    // A quota error inside an HTTP 200 MCP envelope carries no Retry-After, so set the host cooldown here.
    const retryAt = error.retryAt ?? new Date(now() + backoffMs()).toISOString();
    cooldown.set(apiKey() ? "api.exa.ai" : "mcp.exa.ai", Date.parse(retryAt));
    return { status: "rate_limited", records: [], retryAt, warnings: [UNAVAILABLE] };
  }

  return {
    catalog: () => ({
      id: "exa", enabled: enabled(), access: apiKey() ? "keyed" : "public",
      discovery: "Bounded search of registered public sources; access and results are not guaranteed", domains: publicSearchHosts,
    }),
    plan: (req: TopicResearchRequest) => enabled() ? planWebQuery(req) : undefined,
    async collect(query: string, signal: AbortSignal): Promise<CollectionReport> {
      signal.throwIfAborted();
      if (!enabled()) return { status: "not_configured", records: [], warnings: ["Public web search is disabled."] };
      const saved = cache.get(query);
      if (saved && saved.until > now()) {
        return { ...structuredClone(saved.report), status: saved.report.status === "live" ? "cached" : saved.report.status };
      }
      cache.delete(query);
      let report: CollectionReport;
      try {
        report = await search(query, signal);
      } catch (error) {
        signal.throwIfAborted();
        report = failure(error);
      }
      signal.throwIfAborted();
      if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
      cache.set(query, { until: now() + (report.records.length ? CACHE_WITH_RECORDS_MS : CACHE_EMPTY_MS), report: structuredClone(report) });
      return report;
    },
  };
}
