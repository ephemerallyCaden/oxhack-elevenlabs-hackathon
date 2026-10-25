// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import { createCollectionFetcher } from "./collection-fetch";

test("ONS evidence never pairs a value with a date that conflicts with its month and year", async () => {
  const fetcher = createCollectionFetcher({
    fetchImpl: async () => Response.json({
      description: {
        cdid: "D7G7",
        unit: "%",
        title: "CPI ANNUAL RATE 00: ALL ITEMS 2015=100",
        releaseDate: "2026-10-15T08:00:00.000Z",
      },
      months: [
        { date: "2030 MAR", value: "3.8", year: "2026", month: "October" },
      ],
    }),
  });

  const report = await fetcher.ons();

  assert.ok(
    report.status !== "live" || report.records.every(record => !record.text.includes("2030 MAR")),
    "a malformed ONS date must be rejected or derived from the validated year and month",
  );
});

test("ONS skips contradictory and unusable date labels without relabeling their values", async () => {
  const fetcher = createCollectionFetcher({ fetchImpl: async () => Response.json({
    description: { cdid: "D7G7", unit: "%", title: "CPI annual rate", releaseDate: "2026-10-15T08:00:00.000Z" },
    months: [
      { date: "2026 SEP", value: "2.7", year: "2026", month: "September" },
      { date: "2030 MAR", value: "3.8", year: "2026", month: "October" },
      { date: "unavailable", value: "4.1", year: "2026", month: "November" },
    ],
  }) });
  const report = await fetcher.ons();
  assert.equal(report.status, "live");
  assert.equal(report.records.length, 1);
  assert.match(report.records[0].text, /2\.7% for 2026 SEP/);
  assert.doesNotMatch(report.records[0].text, /3\.8|4\.1|2030/);
});
