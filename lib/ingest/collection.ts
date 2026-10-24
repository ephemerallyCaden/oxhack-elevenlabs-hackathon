import { createHash } from "node:crypto";
import { z } from "zod";

export type CollectionRecord = {
  id: string; sourceUrl: string; title: string; text: string;
  collector: "ons" | "easyspider" | "mediacrawler" | "thunderbit";
  capturedAt: string; captureMode: "live" | "import"; publishedAt?: string;
  limitations: string[]; verified: false;
};
export type NormalizationReport = { records: CollectionRecord[]; warnings: string[]; rejected: number; duplicates: number };
export type CollectorImport = {
  collector: "easyspider" | "mediacrawler"; payload: unknown;
  mapping?: { url: string; title: string; text: string }; capturedAt?: string;
};
const MAX_ROWS = 50;
const MAX_ROW = 40000;
const MAX_INPUT = 200000;
const MAX_RECORDS = 10;
const MAX_TEXT = 4000;
const truncatedText = "Source text was truncated to 4000 characters during normalization.";
const recordSchema = z.object({
  id: z.string().optional(), sourceUrl: z.string().trim().min(1).max(4096),
  title: z.string().trim().min(1), text: z.string().trim().min(1),
  collector: z.enum(["ons", "easyspider", "mediacrawler", "thunderbit"]),
  capturedAt: z.iso.datetime({ offset: true }), captureMode: z.enum(["live", "import"]),
  publishedAt: z.string().max(100).refine(value => Number.isFinite(Date.parse(value))).optional(),
  limitations: z.array(z.string().trim().max(800)).max(20).default([]),
});
const cleanText = (text: string) => text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
const emptyReport = (): NormalizationReport => ({ records: [], warnings: [], rejected: 0, duplicates: 0 });

function canonicalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return;
    url.hash = "";
    url.searchParams.sort();
    return url.toString();
  } catch { return; }
}

/** Bound input before mapping/normalizing. Counts include rows omitted for capacity. */
function boundedRows(payload: unknown): { rows: unknown[]; warnings: string[]; rejected: number } {
  const warnings: string[] = [];
  let rejected = 0;
  let candidates: unknown[];
  if (typeof payload === "string") {
    if (payload.length > MAX_INPUT) return { rows: [], warnings: ["Import exceeds the 200000-character input limit."], rejected: 1 };
    const input = payload.trim();
    try {
      if (input.startsWith("[")) {
        const decoded: unknown = JSON.parse(input);
        if (!Array.isArray(decoded)) throw new Error("Array required");
        candidates = decoded;
      } else {
        candidates = [];
        const lines = input.split(/\r?\n/).filter(line => line.trim());
        if (lines.length > MAX_ROWS) { rejected += lines.length - MAX_ROWS; warnings.push("Only the first 50 raw rows were considered."); }
        for (const line of lines.slice(0, MAX_ROWS)) {
          if (line.length > MAX_ROW) { rejected++; warnings.push("A JSONL row exceeds 40000 characters."); continue; }
          try { candidates.push(JSON.parse(line)); }
          catch { rejected++; warnings.push("A malformed JSONL row was rejected."); }
        }
      }
    } catch { return { rows: [], warnings: ["Import must be a JSON array or JSONL objects."], rejected: 1 }; }
  } else if (Array.isArray(payload)) candidates = payload;
  else return { rows: [], warnings: ["Import must be a JSON array or JSONL string."], rejected: 1 };
  if (candidates.length > MAX_ROWS) { rejected += candidates.length - MAX_ROWS; warnings.push("Only the first 50 raw rows were considered."); }
  const rows: unknown[] = [];
  let total = 0;
  for (const row of candidates.slice(0, MAX_ROWS)) {
    try {
      const serialized = JSON.stringify(row);
      if (!serialized || serialized.length > MAX_ROW) { rejected++; warnings.push("A raw row exceeds 40000 characters or is not JSON data."); continue; }
      total += serialized.length;
      if (total > MAX_INPUT) { rejected++; warnings.push("Rows exceeding the 200000-character total input limit were omitted."); continue; }
      rows.push(row);
    } catch { rejected++; warnings.push("A non-serializable raw row was rejected."); }
  }
  return { rows, warnings: [...new Set(warnings)], rejected };
}

/** Whitelist public capture fields only; never fetch a record URL or treat its text as instructions. */
export function normalizeRecords(inputs: unknown[]): NormalizationReport {
  const bounded = boundedRows(inputs);
  const report = emptyReport();
  report.rejected = bounded.rejected;
  report.warnings.push(...bounded.warnings);
  const seen = new Set<string>();
  const ids = new Set<string>();
  for (const raw of bounded.rows) {
    const parsed = recordSchema.safeParse(raw);
    if (!parsed.success) { report.rejected++; report.warnings.push("A record with missing or invalid capture fields was rejected."); continue; }
    const item = parsed.data;
    const sourceUrl = canonicalUrl(item.sourceUrl);
    const fullText = cleanText(item.text);
    if (!sourceUrl || !fullText) { report.rejected++; report.warnings.push("A record needs nonempty text and an HTTP(S) URL without credentials."); continue; }
    const fingerprint = createHash("sha256").update(`${sourceUrl}\n${fullText}`).digest("hex");
    const suppliedId = item.id && /^record_[a-f0-9]{24}$/.test(item.id) ? item.id : undefined;
    // A prior normalization already discarded the suffix. Its identity label preserves versions
    // with identical excerpts; neither the label nor the truncation marker proves authenticity.
    const identity = suppliedId && item.limitations.includes(truncatedText)
      ? `${sourceUrl}\n${suppliedId}` : fingerprint;
    if (seen.has(identity)) { report.duplicates++; continue; }
    seen.add(identity);
    if (report.records.length >= MAX_RECORDS) { report.rejected++; report.warnings.push("Normalized output is limited to 10 records; additional records were omitted."); continue; }
    const derivedId = `record_${fingerprint.slice(0, 24)}`;
    // Preserve our bounded identity labels when an already-normalized excerpt is processed again.
    let id = suppliedId ?? derivedId;
    if (ids.has(id)) {
      id = derivedId;
      const prefix = createHash("sha256").update(`${fingerprint}:id-collision`).digest("hex").slice(0, 20);
      let counter = 0;
      while (ids.has(id)) id = `record_${prefix}${(counter++).toString(16).padStart(4, "0")}`;
      report.warnings.push("A repeated record ID was replaced with a unique content-derived ID.");
    }
    ids.add(id);
    const limitations = [...item.limitations];
    if (fullText.length > MAX_TEXT) { limitations.push(truncatedText); report.warnings.push(truncatedText); }
    if (item.title.length > 300) { limitations.push("Title was truncated to 300 characters during normalization."); report.warnings.push("An overlong title was truncated."); }
    report.records.push({ id, sourceUrl, title: item.title.slice(0, 300), text: fullText.slice(0, MAX_TEXT),
      collector: item.collector, capturedAt: item.capturedAt, captureMode: item.captureMode,
      ...(item.publishedAt ? { publishedAt: item.publishedAt } : {}), limitations: [...new Set(limitations)], verified: false });
  }
  report.warnings = [...new Set(report.warnings)];
  return report;
}

function unixTime(value: unknown, milliseconds: boolean): string | undefined {
  if (!(typeof value === "number" || typeof value === "string" && /^\d+$/.test(value))) return;
  const timestamp = Number(value) * (milliseconds ? 1 : 1000);
  if (!Number.isFinite(timestamp) || timestamp <= 0 || timestamp > 8640000000000000) return;
  return new Date(timestamp).toISOString();
}

/** Import exports only. No EasySpider/MediaCrawler code, worker, cookies or login is executed. */
export function importCollectorExport(options: CollectorImport): NormalizationReport {
  const bounded = boundedRows(options.payload);
  const warnings = [...bounded.warnings];
  let rejected = bounded.rejected;
  const mapped: unknown[] = [];
  const importedAt = new Date().toISOString();
  const suppliedTime = options.capturedAt && z.iso.datetime({ offset: true }).safeParse(options.capturedAt).success ? options.capturedAt : undefined;
  if (options.capturedAt && !suppliedTime) warnings.push("Invalid supplied capture time; import-time labeling is used where no export timestamp exists.");
  const mapping = options.mapping ?? { url: "url", title: "title", text: "text" };
  if (!Object.values(mapping).every(value => typeof value === "string" && value.length > 0 && value.length <= 100)) {
    return { ...emptyReport(), rejected: bounded.rows.length + rejected, warnings: ["Column mapping needs nonempty url, title and text field names."] };
  }
  for (const raw of bounded.rows) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { rejected++; warnings.push("A non-object export row was rejected."); continue; }
    const row = raw as Record<string, unknown>;
    let sourceUrl: unknown, title: unknown, text: unknown, publishedAt: string | undefined;
    let capturedAt = suppliedTime ?? importedAt;
    const limitations = ["Imported export; the original page was not fetched or independently verified by this importer."];
    if (options.collector === "easyspider") {
      sourceUrl = row[mapping.url]; title = row[mapping.title]; text = row[mapping.text];
      limitations.push("Coverage depends on the EasySpider task's selected fields, selectors, pages and stopping conditions.");
      limitations.push("EasySpider numeric export can coerce a failed number parse to 0; exported numbers require checking against the source.");
      if (!suppliedTime) limitations.push("capturedAt is the import time; source capture time was not provided.");
    } else if (options.collector === "mediacrawler") {
      title = row.title;
      const id = typeof row.bvid === "string" && /^BV[A-Za-z0-9]+$/.test(row.bvid) ? row.bvid
        : /^(?:\d+)$/.test(String(row.video_id ?? "")) ? `av${row.video_id}` : undefined;
      sourceUrl = row.video_url ?? (id ? `https://www.bilibili.com/video/${id}` : undefined);
      const url = typeof sourceUrl === "string" ? canonicalUrl(sourceUrl) : undefined;
      if (!url || !["bilibili.com", "www.bilibili.com"].includes(new URL(url).hostname)
        || !/^\/video\/(?:BV[A-Za-z0-9]+|av\d+)\/?$/.test(new URL(url).pathname)
        || row.video_type !== undefined && row.video_type !== "video" || typeof title !== "string" || typeof row.desc !== "string") {
        rejected++; warnings.push("Only MediaCrawler Bilibili video exports with title and desc are supported; comments and other platforms were rejected."); continue;
      }
      text = `${title}\n\n${row.desc}`.trim();
      limitations.push("MediaCrawler Bilibili export truncates title and desc to 500 characters each; this record does not establish full-page or comment coverage.");
      if (!row.desc.trim()) limitations.push("The export has no description; only its video title is available.");
      const exportTime = unixTime(row.last_modify_ts, true);
      if (!suppliedTime && exportTime) {
        capturedAt = exportTime;
        limitations.push("capturedAt comes from last_modify_ts: export-normalization time, not a verified network retrieval instant.");
      } else if (!suppliedTime) limitations.push("capturedAt is the import time; source capture time was not provided.");
      publishedAt = unixTime(row.create_time, false);
    } else { rejected++; warnings.push("Unsupported collector export."); continue; }
    mapped.push({ sourceUrl, title, text, collector: options.collector, capturedAt, captureMode: "import", publishedAt, limitations, verified: false });
  }
  const normalized = normalizeRecords(mapped);
  return { ...normalized, rejected: normalized.rejected + rejected, warnings: [...new Set([...warnings, ...normalized.warnings])] };
}
