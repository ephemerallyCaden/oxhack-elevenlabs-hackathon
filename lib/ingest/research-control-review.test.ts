// @vitest-environment node

import assert from "node:assert/strict";
import { test } from "vitest";
import { createCollectionFetcher } from "./collection-fetch";
import { createResearchAgent } from "./research-agent";
import { createPassageSelector } from "./research-selection";
import { planPublicResearch, type TopicResearchRequest } from "./research-contract";

test("deep planning uses the topic when the overall question is generic", async () => {
  const request: TopicResearchRequest = {
    question: "What should I do next?",
    topic: {
      id: "gap-year-wellbeing",
      title: "Taking a gap year",
      question: "Could a gap year improve my happiness and wellbeing?",
    },
    side: "yes",
    tier: "deep",
  };
  const quote = "The study reports improved wellbeing among participants after a gap year.";
  let searchQuery = "";
  const fetcher = createCollectionFetcher({ apiKey: "fixture-key", fetchImpl: async (input, init) => {
    const url = String(input);
    if (url === "https://openapi.thunderbit.com/openapi/v1/search") {
      searchQuery = JSON.parse(String(init?.body)).query;
      return Response.json({ success: true, data: { results: [{
        success: true,
        url: "https://research.example.org/gap-year",
        title: "Gap year wellbeing study",
        markdown: `${quote} The sample was limited to survey respondents.`,
      }] } });
    }
    throw new Error(`Unexpected endpoint: ${url}`);
  } });
  const selector = createPassageSelector({ apiKey: "fixture-key", fetchImpl: async (_input, init) => {
    const payload = JSON.parse(String(init?.body));
    const selectionInput = JSON.parse(payload.messages[1].content);
    return Response.json({ choices: [{ message: { content: JSON.stringify({ selections: [{
      recordId: selectionInput.records[0].id,
      quote,
      side: selectionInput.request.side,
    }] }) } }] });
  } });
  const agent = createResearchAgent({ fetcher, selector });
  const result = await agent.run(request);

  assert.equal(searchQuery, "gap year outcomes wellbeing outcomes primary research official statistics");
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].claim, quote);
  assert.equal(result.cards[0].topic_id, request.topic.id);
});

test("the overall category wins over a conflicting topic and public queries contain no personal text", () => {
  const request: TopicResearchRequest = {
    question: "Should I leave my job at PrivateEmployerZ?",
    topic: { id: "moving-cost", title: "Moving costs", question: "Can I afford moving from PrivateAddressZ?" },
    side: "no", tier: "deep",
  };
  assert.deepEqual(planPublicResearch(request), {
    source: "search", query: "leaving employment career change costs financial risks primary research official statistics",
  });
  assert.deepEqual(planPublicResearch({ ...request, tier: "quick" }), { source: "none" });
});
