import type { CollectionReport } from "./collection-fetch";
import { normalizeRecords, type CollectionRecord } from "./collection";
import type { CommunityAdapter, CommunityContext, CommunitySourceId } from "./community-types";
import { forumAdapters } from "./community-forums";
import { socialAdapters } from "./community-social";
import { referenceAdapters } from "./community-reference";
import { CommunityHttpError, createCommunityTransport } from "./community-http";
import { allowedSourceRecord } from "./source-policy";
import { withinDeadline } from "./research-control";
import type { TopicResearchRequest } from "./research-contract";

const adapters = [...forumAdapters, ...socialAdapters, ...referenceAdapters];
type Options = { env?: CommunityContext["env"]; fetchImpl?: typeof fetch; now?: () => number };
export type CommunityAction = { id: CommunitySourceId; query: string };
const categories: [RegExp, string][] = [
  [/\bgap year\b/i, "gap year"], [/\b(move|moving|relocat\w*|expat\w*|emigrat\w*)\b/i, "moving abroad"],
  [/\b(dog|puppy|pet)\b/i, "dog adoption"],
  [/\b(?:quit|leave|leaving|resign\w*)\b.*\b(?:job|work)\b|\bcareer change\b/i, "leaving job"],
  [/\b(buy|buying|purchase)\b.*\bcar\b/i, "car ownership"],
  [/\b(travel|backpack\w*)\b/i, "travel budget"], [/\b(parent\w*|child\w*|baby)\b/i, "parenting"],
  [/\b(university|college|degree)\b/i, "university education"], [/\b(rent|house|housing|mortgage)\b/i, "housing costs"],
  [/\b(exercise|fitness|gym)\b/i, "exercise wellbeing"], [/\b(hobby|hobbies|pottery)\b/i, "hobbies wellbeing"],
];

/** Canonical public terms only: never interpolate a transcript, name or personal amount. */
export function planCommunityQuery(req: TopicResearchRequest): string | undefined {
  if (req.tier !== "deep") return;
  return categories.find(([pattern]) => pattern.test(req.question))?.[1]
    ?? categories.find(([pattern]) => pattern.test(`${req.topic.title} ${req.topic.question}`))?.[1];
}

/** Round-robin sources before normalization's ten-record cap. */
export function interleaveRecords(reports: CollectionReport[]): CollectionRecord[] {
  const rows: CollectionRecord[] = [];
  for (let index = 0; index < 10; index++) {
    for (const report of reports) {
      const record = report.records[index];
      if (record) rows.push(record);
    }
  }
  return rows;
}

export function createCommunityFetcher(options: Options = {}) {
  const env = options.env ?? process.env, now = options.now ?? Date.now;
  const hostCooldown = new Map<string, number>(), sourceCooldown = new Map<string, number>();
  const cache = new Map<string, { until: number; report: CollectionReport }>();
  const retry = new Map<string, { until: number; report: CollectionReport }>();
  function enabled(): CommunityAdapter[] {
    const configured = env.RESEARCH_COMMUNITY_SOURCES?.trim();
    if (!configured || configured === "all") return adapters;
    if (configured === "none") return [];
    return [...new Set(configured.split(",").map(id => id.trim()))].flatMap(id => adapters.filter(adapter => adapter.id === id));
  }
  function boundedSet(map: typeof cache, key: string, value: { until: number; report: CollectionReport }) {
    if (!map.has(key) && map.size >= 64) map.delete(map.keys().next().value!);
    map.set(key, value);
  }
  return {
    catalog() {
      const active = new Set(enabled().map(adapter => adapter.id));
      return adapters.map(adapter => ({ id: adapter.id, enabled: active.has(adapter.id),
        configured: adapter.configured(env), ...adapter.capabilities }));
    },
    plan(req: TopicResearchRequest): CommunityAction[] {
      const query = planCommunityQuery(req); if (!query) return [];
      const available = enabled().filter(adapter => adapter.configured(env) && adapter.matches(query));
      let selected = available;
      if (!env.RESEARCH_COMMUNITY_SOURCES?.trim() || env.RESEARCH_COMMUNITY_SOURCES.trim() === "all") {
        const forums = available.filter(adapter => forumAdapters.includes(adapter)).slice(0, 2);
        const social = available.filter(adapter => socialAdapters.includes(adapter)).sort((a, b) => Number(a.id === "telegram") - Number(b.id === "telegram")).slice(0, 1);
        selected = [...forums, ...social, ...available.filter(adapter => referenceAdapters.includes(adapter))];
      }
      return selected.slice(0, 3).map(adapter => ({ id: adapter.id, query }));
    },
    async collect(action: CommunityAction, signal: AbortSignal): Promise<CollectionReport> {
      signal.throwIfAborted();
      const adapter = enabled().find(item => item.id === action.id);
      if (!adapter || !adapter.configured(env)) return { status: "not_configured", records: [], warnings: ["Requested community source is disabled or not configured."] };
      const key = `${adapter.id}:${action.query}`;
      const saved = cache.get(key);
      if (saved && saved.until > now()) return { ...structuredClone(saved.report), status: "cached" };
      cache.delete(key);
      const failed = retry.get(key);
      const cooldown = sourceCooldown.get(adapter.id) ?? 0;
      if (cooldown > now()) return failed && failed.until > now() ? structuredClone(failed.report)
        : { status: "rate_limited", records: [], retryAt: new Date(cooldown).toISOString(), warnings: ["Source requested a collection cooldown."] };
      if (failed && failed.until > now()) return structuredClone(failed.report);
      retry.delete(key);
      let result: CollectionReport;
      try {
        result = await withinDeadline(bounded => adapter.collect({ query: action.query, signal: bounded, env, now,
          transport: createCommunityTransport({ hosts: adapter.hosts, fetchImpl: options.fetchImpl, now, cooldown: hostCooldown }) }), 16000, signal);
        signal.throwIfAborted();
        const normalized = normalizeRecords(result.records.filter(allowedSourceRecord));
        const omitted = result.records.length - normalized.records.length;
        result = { ...result, records: normalized.records, warnings: [...result.warnings, ...normalized.warnings,
          ...(omitted ? [`${omitted} source records omitted by source/context/normalization checks.`] : [])] };
      } catch (error) {
        signal.throwIfAborted();
        result = { status: error instanceof CommunityHttpError && error.status === 429 ? "rate_limited" : "unavailable", records: [],
          ...(error instanceof CommunityHttpError && error.retryAt ? { retryAt: error.retryAt } : {}),
          warnings: ["Community source collection failed or exceeded its budget."] };
      }
      if (result.retryAt && Number.isFinite(Date.parse(result.retryAt))) sourceCooldown.set(adapter.id, Math.min(now() + 86400000, Date.parse(result.retryAt)));
      if (result.status === "live") boundedSet(cache, key, { until: now() + 600000, report: structuredClone(result) });
      else boundedSet(retry, key, { until: Math.max(now() + 60000, sourceCooldown.get(adapter.id) ?? 0), report: structuredClone(result) });
      return result;
    },
  };
}
