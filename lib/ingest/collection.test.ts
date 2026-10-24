// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import { importCollectorExport, normalizeRecords, type CollectionRecord } from "./collection";

const capturedAt = "2026-10-24T09:00:00.000Z";

function capture(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: "",
    sourceUrl: "https://example.org/story",
    title: "Public article",
    text: "A source excerpt.",
    collector: "easyspider",
    capturedAt,
    captureMode: "import",
    limitations: [],
    verified: false,
    ...overrides,
  };
}

test("normalization rejects unsafe or invalid rows, deduplicates identical content, keeps changed versions, and warns on truncation", () => {
  const report = normalizeRecords([
    capture({ sourceUrl: "https://example.org/story?b=2&a=1#section", text: "Same excerpt." }),
    capture({ sourceUrl: "https://example.org/story?a=1&b=2", text: "Same excerpt." }),
    capture({ sourceUrl: "https://example.org/story?a=1&b=2", text: "A changed version of the excerpt." }),
    capture({ sourceUrl: "https://user:password@example.org/private", text: "Should not be retained." }),
    capture({ capturedAt: "yesterday" }),
    capture({ sourceUrl: "https://example.org/long", text: "x".repeat(4500) }),
  ]);

  assert.equal(report.duplicates, 1);
  assert.equal(report.rejected, 2);
  assert.equal(report.records.length, 3);
  assert.equal(report.records[0].sourceUrl, "https://example.org/story?a=1&b=2");
  assert.notEqual(report.records[0].id, report.records[1].id);
  assert.ok(report.records.every(record => !record.sourceUrl.includes("password")));
  const long = report.records.find(record => record.sourceUrl.endsWith("/long"));
  assert.equal(long?.text.length, 4000);
  assert.ok(long?.limitations.some(limitation => /truncated to 4000/i.test(limitation)));
  assert.ok(report.warnings.some(warning => /truncated to 4000/i.test(warning)));
});

test("EasySpider custom mapping retains import time and refuses to coerce numeric text fields", () => {
  const payload = [
    { link: "https://example.org/valid", headline: "Mapped title", body_text: "Mapped public text." },
    { link: "https://example.org/coerced", headline: "Numeric body", body_text: 0 },
  ];
  const report = importCollectorExport({
    collector: "easyspider",
    payload: JSON.stringify(payload[0]) + "\n" + JSON.stringify(payload[1]),
    mapping: { url: "link", title: "headline", text: "body_text" },
    capturedAt,
  });

  assert.equal(report.records.length, 1);
  assert.equal(report.rejected, 1);
  assert.equal(report.records[0].sourceUrl, "https://example.org/valid");
  assert.equal(report.records[0].title, "Mapped title");
  assert.equal(report.records[0].text, "Mapped public text.");
  assert.equal(report.records[0].capturedAt, capturedAt);
  assert.equal(report.records[0].captureMode, "import");
  assert.ok(report.records[0].limitations.some(limitation => /numeric export can coerce/i.test(limitation)));
  assert.ok(!report.records.some(record => record.text === "0"));
});

test("MediaCrawler imports use explicit export timestamps and retain truncation caveats", () => {
  const createTime = 1761242400;
  const modifiedTime = 1761300000000;
  const report = importCollectorExport({
    collector: "mediacrawler",
    payload: [{
      video_id: "123456789",
      video_type: "video",
      title: "Poker stream discussion",
      desc: "d".repeat(4500),
      create_time: createTime,
      last_modify_ts: modifiedTime,
    }],
  });
  const [record] = report.records;

  assert.equal(report.rejected, 0);
  assert.equal(record.sourceUrl, "https://www.bilibili.com/video/av123456789");
  assert.equal(record.publishedAt, new Date(createTime * 1000).toISOString());
  assert.equal(record.capturedAt, new Date(modifiedTime).toISOString());
  assert.equal(record.text.length, 4000);
  assert.ok(record.limitations.some(limitation => /title and desc to 500 characters/i.test(limitation)));
  assert.ok(record.limitations.some(limitation => /truncated to 4000/i.test(limitation)));
  assert.ok(report.warnings.some(warning => /truncated to 4000/i.test(warning)));
  assert.equal(record.verified, false);
});
