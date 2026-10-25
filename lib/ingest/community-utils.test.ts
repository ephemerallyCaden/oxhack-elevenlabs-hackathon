import { expect, it } from "vitest";
import { communityRecord } from "./community-utils";

it("preserves literal markup-like text in plain posts, titles and parent context", () => {
  const text = "Moving was <not> the right choice for me & my family.";
  for (const collector of ["x", "youtube", "wikipedia", "telegram"] as const) {
    const record = communityRecord(collector, { url: "https://x.com/i/web/status/1", title: text, text,
      threadUrl: "https://x.com/i/web/status/1", postId: "2", parentId: "1", parentText: text, kind: "reply" }, () => 0);
    expect(record.text).toBe(text);
    expect(record.title).toBe(text);
    expect(record.discussion?.parentText).toBe(text);
  }
});

it("parses HTML exactly once and omits quoted parents from a reply's selectable body", () => {
  const record = communityRecord("discourse", { url: "https://community.nomadgate.com/t/1/2", title: "Moving",
    text: '<aside class="quote"><blockquote>Parent claim</blockquote></aside><p>I &lt;disagree&gt; with that.</p>', textFormat: "html", kind: "reply" }, () => 0);
  expect(record.text).toBe("I <disagree> with that.");
});
