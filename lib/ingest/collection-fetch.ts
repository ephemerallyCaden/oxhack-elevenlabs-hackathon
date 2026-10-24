import { z } from "zod";
import { normalizeRecords, type CollectionRecord } from "./collection";

export const COLLECTION_SOURCES = {
  "ons-cpi": {
    title: "ONS UK consumer price inflation",
    url: "https://www.ons.gov.uk/economy/inflationandpriceindices/timeseries/d7g7/mm23",
  },
  "poker-paper": {
    title: "PLOS: Beyond Chance? The Persistence of Performance in Online Poker",
    url: "https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0115479",
  },
} as const;
export type CollectionReport = {
  status: "live" | "cached" | "unavailable" | "rate_limited" | "blocked" | "invalid" | "not_configured";
  records: CollectionRecord[];
  warnings: string[];
  retryAt?: string;
};
type Options = { fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number; apiKey?: string };
const onsSchema = z.object({
  description: z.object({ cdid: z.literal("D7G7"), unit: z.literal("%"), title: z.string(), releaseDate: z.string().datetime() }),
  months: z.array(z.object({ date: z.string(), value: z.string(), year: z.string(), month: z.string() })).min(1),
});
const distillSchema = z.object({
  success: z.literal(true),
  data: z.object({ url: z.string().optional(), markdown: z.string().trim().min(1),
    metadata: z.object({ title: z.string().optional(), sourceUrl: z.string().optional(), statusCode: z.number().optional() }).optional() }),
});
const searchEnvelope = z.object({ success: z.literal(true), data: z.object({
  results: z.array(z.unknown()).max(10),
}) });
const searchRow = z.object({ success: z.literal(true), url: z.string().max(4096),
  title: z.string().trim().min(1).max(500), markdown: z.string().trim().min(1).max(200000) });

/** Link validation only; returned links are not fetched by our server. */
export function isPublicSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port
      && /^[a-z0-9.-]+\.[a-z]{2,63}$/i.test(url.hostname)
      && !/(?:^|\.)(?:localhost|local|internal|invalid|test)$/i.test(url.hostname);
  } catch { return false; }
}

type ParsedCollection = CollectionRecord[] | { records: CollectionRecord[]; warnings: string[] };

async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  if (!response.body) throw new Error("Empty body");
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 512000) throw new Error("Body too large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { signal.removeEventListener("abort", cancel); cancel(); reader.releaseLock(); }
}

/** Only fixed, reviewed source URLs. No arbitrary URL, browser, login or retry loop. */
export function createCollectionFetcher(options: Options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const cache = new Map<string, { expires: number; report: CollectionReport }>();
  const inFlight = new Map<string, Promise<CollectionReport>>();
  const cooldown = new Map<string, number>();
  const timeoutMs = Number.isFinite(options.timeoutMs) ? Math.max(1, Math.min(5000, options.timeoutMs!)) : 5000;
  async function acquire(key: string, url: string, init: RequestInit, parse: (raw: unknown) => ParsedCollection, group: string): Promise<CollectionReport> {
    if (typeof window !== "undefined") throw new Error("Collection must run on the server");
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return { ...structuredClone(cached.report), status: "cached",
      warnings: [...cached.report.warnings, "Using a warm-process snapshot; capture time is unchanged."] };
    const next = cooldown.get(group);
    if (next && next > now()) return { status: "rate_limited", records: [], retryAt: new Date(next).toISOString(), warnings: ["Source cooldown is active; no request sent."] };
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const work = async (): Promise<CollectionReport> => {
        const response = await fetchImpl(url, { ...init, redirect: "error", signal: controller.signal });
        if (!response.ok) {
          const raw = await boundedJson(response, controller.signal).catch(() => ({}));
          const parsed = z.object({ error: z.object({ code: z.string() }) }).safeParse(raw);
          const code = parsed.success ? parsed.data.error.code : "";
          const limited = response.status === 429 || code === "SCRAPE_TARGET_RATE_LIMITED";
          const blocked = response.status === 401 || response.status === 403 || code === "SCRAPE_TARGET_FORBIDDEN";
          if (limited) {
            const retry = response.headers.get("retry-after");
            const delay = retry && /^\d+(\.\d+)?$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry ?? "");
            const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
            const retryAt = Math.max(now() + 60000, Number.isFinite(delay) ? delay : 0, Number.isFinite(reset) ? reset : 0);
            cooldown.set(group, retryAt);
            return { status: "rate_limited", records: [], retryAt: new Date(retryAt).toISOString(), warnings: [code === "SCRAPE_TARGET_RATE_LIMITED" ? "Publisher rate limit reported by Thunderbit; no retry attempted." : "Provider/source rate limit; honor the reported retry time."] };
          }
          return { status: blocked ? "blocked" : "unavailable", records: [], warnings: [blocked
            ? "Access denied or authentication required; no alternate access method was attempted."
            : response.status === 402 ? "Thunderbit credits are unavailable." : "Source request failed; no live evidence collected."] };
        }
        const parsed = parse(await boundedJson(response, controller.signal));
        const normalized = normalizeRecords(Array.isArray(parsed) ? parsed : parsed.records);
        const warnings = [...(Array.isArray(parsed) ? [] : parsed.warnings), ...normalized.warnings];
        if (controller.signal.aborted) throw new Error("Deadline");
        if (!normalized.records.length) return { status: "invalid", records: [], warnings: ["Source response contained no usable records.", ...warnings] };
        const report: CollectionReport = { status: "live", records: normalized.records, warnings };
        cache.set(key, { expires: now() + 3600000, report: structuredClone(report) });
        while (cache.size > 64) cache.delete(cache.keys().next().value!);
        return report;
      };
      const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Deadline")); }, timeoutMs); });
      return await Promise.race([work(), deadline]);
    } catch {
      return { status: controller.signal.aborted ? "unavailable" : "invalid", records: [], warnings: [controller.signal.aborted
        ? "Collection exceeded the five-second budget; no live evidence returned."
        : "Source response or transport was unusable; no live evidence returned."] };
    } finally { clearTimeout(timer); }
  }
  // Only fixed public source/extraction settings share work. Each reader gets its own
  // copy; a caller timing out must not abort the collector's independently bounded job.
  async function run(key: string, url: string, init: RequestInit, parse: (raw: unknown) => ParsedCollection, group = key): Promise<CollectionReport> {
    let pending = inFlight.get(key);
    if (!pending) {
      if (inFlight.size >= 32) return { status: "unavailable", records: [], warnings: ["Collector capacity is full; no request started."] };
      pending = Promise.resolve().then(() => acquire(key, url, init, parse, group));
      inFlight.set(key, pending);
    }
    try { return structuredClone(await pending); }
    finally { if (inFlight.get(key) === pending) inFlight.delete(key); }
  }
  return {
    /** Deep-only discovery caller supplies a canonical public query, never a raw profile. */
    async search(query: string): Promise<CollectionReport> {
      if (!query.trim() || query.length > 500) return { status: "invalid", records: [], warnings: ["Invalid public search query."] };
      const apiKey = options.apiKey ?? process.env.THUNDERBIT_API_KEY;
      if (!apiKey) return { status: "not_configured", records: [], warnings: ["Thunderbit API key is not configured; no search request sent."] };
      return run(`thunderbit-search:${query}`, "https://openapi.thunderbit.com/openapi/v1/search", {
        method: "POST", redirect: "error", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 3, formats: ["markdown"], timeout: 5000 }),
      }, raw => {
        const rows = searchEnvelope.parse(raw).data.results;
        const accepted = rows.flatMap(row => {
          const parsed = searchRow.safeParse(row);
          return parsed.success && isPublicSourceUrl(parsed.data.url) ? [parsed.data] : [];
        });
        const coverage = `Search returned ${rows.length} rows; ${rows.length - accepted.length} failed or unusable rows were omitted.`;
        return { warnings: [coverage], records: accepted.map(row => ({ id: "", collector: "thunderbit" as const, sourceUrl: row.url,
          title: row.title, text: row.markdown, capturedAt: new Date(now()).toISOString(), captureMode: "live" as const, verified: false as const,
          limitations: [coverage,
            "Only a limited search sample was inspected; source completeness, region, currentness and meaning need review.",
            "Capture time is provider response time, not publication or measurement time. Search snippets were not used as evidence."] })) };
      }, "thunderbit");
    },
    async ons(): Promise<CollectionReport> {
      const source = COLLECTION_SOURCES["ons-cpi"];
      return run("ons-cpi", `${source.url}/data`, { headers: { "User-Agent": "RouletteDataLab/0.1", Accept: "application/json" } }, raw => {
        const data = onsSchema.parse(raw);
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const rows = data.months.map(row => ({ ...row, order: Number(row.year) * 12 + monthNames.indexOf(row.month) }))
          .filter(row => /^\d{4}$/.test(row.year) && monthNames.includes(row.month) && /^-?\d+(\.\d+)?$/.test(row.value))
          // Never attach a contradictory publisher date to an otherwise valid value.
          .filter(row => row.date === `${row.year} ${row.month.slice(0, 3).toUpperCase()}`)
          .sort((a, b) => b.order - a.order);
        const latest = rows[0];
        if (!latest || Number(latest.value) < -100 || Number(latest.value) > 100) throw new Error("Invalid CPI");
        return [{ id: "", collector: "ons", sourceUrl: source.url, title: data.description.title,
          text: `ONS series D7G7, UK all-items CPI annual rate: ${latest.value}% for ${latest.date}. This is the change over 12 months, observed in that month, not a forecast.`,
          capturedAt: new Date(now()).toISOString(), publishedAt: data.description.releaseDate, captureMode: "live", verified: false,
          limitations: ["UK aggregate inflation, not the user's personal spending or future inflation.", "Latest valid monthly observation in the downloaded series; human review pending.", "Source: Office for National Statistics, Open Government Licence v3.0."] }];
      });
    },
    async thunderbit(sourceId: keyof typeof COLLECTION_SOURCES): Promise<CollectionReport> {
      const source = COLLECTION_SOURCES[sourceId];
      if (!source) return { status: "invalid", records: [], warnings: ["Unknown registered source."] };
      const apiKey = options.apiKey ?? process.env.THUNDERBIT_API_KEY;
      if (!apiKey) return { status: "not_configured", records: [], warnings: ["Thunderbit API key is not configured; no request sent."] };
      return run(`thunderbit:${sourceId}`, "https://openapi.thunderbit.com/openapi/v1/distill", {
        method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.url, renderMode: "none", include: ["metadata"] }),
      }, raw => {
        const data = distillSchema.parse(raw).data;
        if (data.metadata?.statusCode && data.metadata.statusCode >= 400) throw new Error("Publisher failed");
        // A provider redirect is not permission to promote an unreviewed source.
        if ((data.url && data.url !== source.url) || (data.metadata?.sourceUrl && data.metadata.sourceUrl !== source.url)) throw new Error("Source changed");
        return [{ id: "", collector: "thunderbit", sourceUrl: source.url, title: data.metadata?.title ?? source.title,
          text: data.markdown, capturedAt: new Date(now()).toISOString(), captureMode: "live", verified: false,
          limitations: ["Thunderbit returned extracted text; source completeness and meaning are not verified.", "Capture time is provider response time; publisher fetch time and provider cache age are unknown."] }];
      }, "thunderbit");
    },
  };
}
