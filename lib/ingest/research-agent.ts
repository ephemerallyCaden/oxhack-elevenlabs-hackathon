import { createHash } from "node:crypto";
import { normalizeRecords, type CollectionRecord } from "./collection";
import { createCollectionFetcher, isPublicSourceUrl, type CollectionReport } from "./collection-fetch";
import { planPublicResearch, passageSelectionsSchema, researchRequestSchema, type ResearchEvidenceCard, type TopicResearchRequest } from "./research-contract";
import { createResearchQueue, ResearchDeadlineError, withinDeadline } from "./research-control";
import { createPassageSelector, type PassageSelector } from "./research-selection";
import { createCommunityFetcher, interleaveRecords } from "./community-fetch";
import { allowedSourceRecord } from "./source-policy";
import { createWebSearch } from "./web-search";

export type PublicCaptureTool = {
  /** Unique identifier for one fixed public capture and extraction settings. */
  id: string;
  matches: (request: TopicResearchRequest) => boolean;
  read: (signal: AbortSignal) => Promise<CollectionReport>;
};
/** `no_support`: sources were retrieved, but no admissible passage supported the requested side. */
export type ResearchDiagnostics = { status: "ok" | "partial" | "no_support" | "unsupported" | "unavailable" | "not_configured" | "timeout" | "cancelled";
  tools: { id: string; status: CollectionReport["status"] }[]; warnings: string[]; acceptedCards: number };
export type TopicResearchResponse = { cards: ResearchEvidenceCard[]; fallback: boolean; diagnostics: ResearchDiagnostics };
type Options = { fetcher?: ReturnType<typeof createCollectionFetcher>; selector?: PassageSelector;
  publicCaptures?: PublicCaptureTool[]; quickMs?: number; deepMs?: number;
  community?: ReturnType<typeof createCommunityFetcher> | false;
  webSearch?: ReturnType<typeof createWebSearch> | false };
type Action = { id: string; key: string; read: PublicCaptureTool["read"]; budgetMs?: number };
const budget = (value: number | undefined, max: number) => Number.isFinite(value) ? Math.max(1, Math.min(value!, max)) : max;
const digest = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 20);

/** Small allowlisted research workflow, built on the existing collectors.
 * No shell, browser launcher, recursive agent or private-profile cache. */
export function createResearchAgent(options: Options = {}) {
  const fetcher = options.fetcher ?? createCollectionFetcher();
  const select = options.selector ?? createPassageSelector();
  const community = options.community === false ? undefined : options.community ?? createCommunityFetcher();
  const webSearch = options.webSearch === false ? undefined : options.webSearch ?? createWebSearch();
  const captures = options.publicCaptures ?? [];
  if (captures.length > 8 || new Set(captures.map(tool => tool.id)).size !== captures.length) throw new Error("Invalid public capture registry");
  const acquisitionQueue = createResearchQueue(3);
  const selectionQueue = createResearchQueue(2);
  const inFlight = new Map<string, { promise: Promise<CollectionReport>; promote: () => void; tier: "quick" | "deep" }>();

  function acquire(action: Action, tier: TopicResearchRequest["tier"]) {
    const existing = inFlight.get(action.key);
    if (existing) { if (tier === "quick") { existing.tier = "quick"; existing.promote(); } return existing.promise; }
    const job = { promise: Promise.resolve({} as CollectionReport), promote: () => {}, tier };
    job.promise = withinDeadline(signal => {
      const scheduled = acquisitionQueue.schedule(() => action.read(signal), job.tier, signal);
      job.promote = scheduled.promote;
      return scheduled.promise;
    }, action.budgetMs ?? 5000).catch((): CollectionReport => ({ status: "unavailable", records: [], warnings: ["Shared acquisition deadline/capacity exceeded."] }))
      .finally(() => { if (inFlight.get(action.key) === job) inFlight.delete(action.key); });
    inFlight.set(action.key, job);
    return job.promise;
  }

  return {
    async run(input: unknown, context: { signal?: AbortSignal; elapsedMs?: number } = {}): Promise<TopicResearchResponse> {
      if (typeof window !== "undefined") throw new Error("Research must run on the server");
      const req = researchRequestSchema.parse(input);
      const ms = budget(req.tier === "quick" ? options.quickMs : options.deepMs, req.tier === "quick" ? 5000 : 45000)
        - Math.max(0, context.elapsedMs ?? 0);
      const diagnostics: ResearchDiagnostics = { status: "unavailable", tools: [], warnings: [], acceptedCards: 0 };
      try {
        return await withinDeadline(async signal => {
          const plan = planPublicResearch(req);
          const actions: Action[] = captures.filter(tool => tool.matches(req)).slice(0, req.tier === "quick" ? 1 : 2)
            .map(tool => ({ id: tool.id, key: `capture:${tool.id}`, read: tool.read }));
          if (plan.source === "ons-cpi") actions.push({ id: "ons-cpi", key: "ons-cpi", read: () => fetcher.ons() });
          else if (plan.source === "search" && plan.query) {
            const query = plan.query;
            actions.push({ id: "thunderbit-search", key: `search:${query}`, read: () => fetcher.search(query) });
          }
          const webQuery = webSearch?.plan(req);
          if (webSearch && webQuery) {
            // Runs first: quick research must land its page excerpts during the opening cut-scene.
            actions.unshift({ id: "exa", key: `web:${webQuery}`, budgetMs: 2400, read: signal => webSearch.collect(webQuery, signal) });
          }
          for (const action of community?.plan(req) ?? []) {
            actions.push({ id: action.id, key: `community:${action.id}:${action.query}`, budgetMs: 20000,
              read: signal => community!.collect(action, signal) });
          }
          if (!actions.length) { diagnostics.status = "unsupported"; diagnostics.warnings.push("No approved source plan or public capture covers this topic/tier."); return finish([]); }
          // Sharing applies only to acquisition. Each request selects its own side and cards.
          const reports = await Promise.all(actions.map(action => acquire(action, req.tier)));
          signal.throwIfAborted();
          diagnostics.tools = actions.map((action, i) => ({ id: action.id, status: reports[i].status }));
          diagnostics.warnings.push(...reports.flatMap(report => report.warnings));
          const eligible = interleaveRecords(reports.filter(report => ["live", "cached", "rate_limited"].includes(report.status)));
          const allowed = eligible.filter(allowedSourceRecord);
          if (allowed.length !== eligible.length) diagnostics.warnings.push("Some source records failed source or discussion-context checks.");
          const normalized = normalizeRecords(allowed);
          diagnostics.warnings.push(...normalized.warnings);
          const records = normalized.records.filter(record => isPublicSourceUrl(record.sourceUrl));
          if (!records.length) {
            diagnostics.status = reports.some(report => report.status === "not_configured") ? "not_configured" : "unavailable";
            return finish([]);
          }
          const selected = await selectionQueue.schedule(() => select(req, structuredClone(records), signal), req.tier, signal).promise;
          signal.throwIfAborted();
          diagnostics.warnings.push(...selected.warnings);
          if (selected.status !== "ok") { diagnostics.status = selected.status === "not_configured" ? "not_configured" : "unavailable"; return finish([]); }
          const parsed = passageSelectionsSchema.safeParse({ selections: selected.selections });
          if (!parsed.success) { diagnostics.warnings.push("Invalid evidence selection shape."); return finish([]); }
          const byId = new Map(records.map(record => [record.id, record]));
          const seen = new Set<string>();
          const cards: ResearchEvidenceCard[] = [];
          for (const selection of parsed.data.selections) {
            // The model classifies passages without knowing the requested side.
            if (selection.side !== req.side) continue;
            const record = byId.get(selection.recordId);
            if (!record || !record.text.includes(selection.quote) || seen.has(record.sourceUrl)) {
              diagnostics.warnings.push("Rejected an unknown, unsupported or duplicate passage."); continue;
            }
            seen.add(record.sourceUrl);
            cards.push(makeCard(req, record, selection.quote));
            if (cards.length >= (req.tier === "quick" ? 3 : 6)) break;
          }
          diagnostics.status = cards.length >= (req.tier === "quick" ? 2 : 3) ? "ok" : cards.length ? "partial" : "no_support";
          if (!cards.length) diagnostics.warnings.push("Sources were retrieved, but no admissible passage supported the requested side.");
          diagnostics.warnings.push("Exact excerpt matching does not establish semantic relevance, support for a side, or independent factual verification.");
          signal.throwIfAborted();
          return finish(cards);
        }, ms, context.signal);
      } catch (error) {
        diagnostics.status = context.signal?.aborted ? "cancelled" : error instanceof ResearchDeadlineError ? "timeout" : "unavailable";
        diagnostics.warnings.push("The request failed or stopped before usable evidence was ready; no mock cards were created.");
        return finish([]);
      }
      function finish(cards: ResearchEvidenceCard[]): TopicResearchResponse {
        return { cards, fallback: cards.length === 0, diagnostics: { ...structuredClone(diagnostics),
          acceptedCards: cards.length, warnings: [...new Set(diagnostics.warnings)] } };
      }
    },
  };
}

const CLAIM_CHARS = 160;

/** The point in one line: the quote's first sentence, cut if it runs long. */
function shortClaim(quote: string): string {
  const sentence = /^[\s\S]*?[.!?](?=\s|$)/.exec(quote)?.[0] ?? quote;
  return sentence.length <= CLAIM_CHARS ? sentence : `${sentence.slice(0, CLAIM_CHARS - 1).trimEnd()}…`;
}

/** Extractive: the model cannot invent a claim, URL or strength. `evidence` is the verbatim passage,
 * readable as-is on the verdict screen; everything else about the record goes to `provenance`. */
function makeCard(req: TopicResearchRequest, record: CollectionRecord, quote: string): ResearchEvidenceCard {
  const source = new URL(record.sourceUrl);
  const discussion = record.discussion;
  return {
    id: `${req.topic.id}:${req.side}:${req.tier}:${digest(`${req.question}\n${req.topic.question}\n${record.id}\n${quote}`)}`,
    topic_id: req.topic.id, side: req.side, tier: req.tier,
    claim: shortClaim(quote),
    evidence: discussion ? `${quote} (personal account from an online discussion)` : quote,
    source_name: record.collector === "ons" ? "Office for National Statistics" : `${source.hostname} — ${record.title}`,
    source_url: record.sourceUrl,
    strength: 1, // conservative until source/claim quality is independently reviewed
    provenance: {
      capturedAt: record.capturedAt,
      ...(record.publishedAt ? { publishedAt: record.publishedAt } : {}),
      limitations: [...record.limitations, "Independent verification has not been performed."],
      ...(discussion ? { discussion: { coverage: discussion.coverage, kind: discussion.kind,
        ...(discussion.kind === "reply" && discussion.parentText ? { parentText: discussion.parentText } : {}) } } : {}),
    },
  };
}
