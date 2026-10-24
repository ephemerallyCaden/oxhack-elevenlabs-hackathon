import { describe, expect, it } from "vitest";
import { allowedEvidenceUrl, allowedSourceRecord, sourcePolicySummary } from "./source-policy";
import type { CollectionRecord } from "./collection";

describe("curated source eligibility", () => {
  it("accepts registered source hosts and exact community hosts", () => {
    for (const url of ["https://www.ons.gov.uk/story", "https://community.nomadgate.com/t/moving/42",
      "https://travel.stackexchange.com/questions/42", "https://t.me/TravelLife/42", "https://doi.org/10.1234/example"]) {
      expect(allowedEvidenceUrl(url)).toBe(true);
    }
  });

  it("rejects unregistered hosts, lookalikes and unsafe URLs", () => {
    for (const url of ["https://unregistered.example/story", "https://travel.stackexchange.com.evil.example/a/1",
      "https://extra.travel.stackexchange.com/a/1", "https://unregistered.stackexchange.com/a/1",
      "https://t.me.evil.example/TravelLife/42", "http://t.me/TravelLife/42", "https://user:pass@t.me/TravelLife/42",
      "https://t.me:444/TravelLife/42", "https://127.0.0.1/story"]) {
      expect(allowedEvidenceUrl(url)).toBe(false);
    }
  });

  it("checks source eligibility even when a record has a supported collector label", () => {
    const record: CollectionRecord = { id: "", collector: "easyspider", sourceUrl: "https://unregistered.example/story",
      title: "Taking a career break", text: "Taking a career break helped me spend more time with my family and think about my future.",
      capturedAt: "2026-10-25T00:00:00Z", captureMode: "import", limitations: [], verified: false };
    expect(allowedSourceRecord(record)).toBe(false);
    expect(allowedSourceRecord({ ...record, sourceUrl: "https://community.nomadgate.com/t/break/42" })).toBe(true);
  });

  it("keeps public summary focused on topic and evidence", () => {
    expect(Object.keys(sourcePolicySummary).sort()).toEqual(["evidence", "theme"]);
  });

  it.each(["Un viaje cambió mi vida.", "家族と過ごす時間を増やしました。", "Une pause m’a aidé."])("preserves source and parent text regardless of language: %s", text => {
    const record: CollectionRecord = { id: "", collector: "discourse", sourceUrl: "https://community.nomadgate.com/t/break/42/2",
      title: "Career break", text, capturedAt: "2026-10-25T00:00:00Z", captureMode: "live", limitations: [], verified: false,
      discussion: { threadUrl: "https://community.nomadgate.com/t/break/42", postId: "2", parentId: "1", parentText: text, kind: "reply", coverage: "Sample" } };
    expect(allowedSourceRecord(record)).toBe(true);
    expect(allowedSourceRecord({ ...record, text: " " })).toBe(false);
    expect(allowedSourceRecord({ ...record, discussion: { ...record.discussion!, parentText: " " } })).toBe(false);
  });
});
