import { z } from "zod";
import type { EvidenceCard, ResearchRequest } from "@/types";

// Validate the shared contract at the HTTP boundary without changing its owner.
export const researchRequestSchema = z.object({
  question: z.string().trim().min(1).max(4000),
  // Deep callers send the full Topic; discard unrelated fields instead of rejecting it.
  topic: z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    title: z.string().trim().min(1).max(200), question: z.string().trim().min(1).max(2000) }),
  side: z.enum(["yes", "no"]), tier: z.enum(["quick", "deep"]),
}).strict() satisfies z.ZodType<ResearchRequest>;
export type TopicResearchRequest = z.infer<typeof researchRequestSchema>;
export type ResearchEvidenceCard = EvidenceCard;
export const passageSelectionsSchema = z.object({ selections: z.array(z.object({
  recordId: z.string().max(150), quote: z.string().trim().min(20).max(700),
  side: z.enum(["yes", "no"]),
}).strict()).max(6) }).strict();
export type PassageSelection = z.infer<typeof passageSelectionsSchema>["selections"][number];

export type PublicResearchPlan = { source: "ons-cpi" | "search" | "none"; query?: string };
/** Match locally, emit only fixed public vocabulary. No free text is interpolated. */
export function planPublicResearch(req: TopicResearchRequest): PublicResearchPlan {
  const question = req.question.toLowerCase();
  const topic = `${req.topic.title} ${req.topic.question}`.toLowerCase();
  const uk = /\b(uk|united kingdom|britain|london|leeds|manchester|edinburgh)\b/.test(`${question} ${topic}`);
  if (uk && /\b(inflation|cpi|consumer prices)\b/.test(topic)) return { source: "ons-cpi" };
  if (req.tier === "quick") return { source: "none" };
  const categories: [RegExp, string][] = [
    [/\bgap year\b/, "gap year outcomes"],
    [/\b(move|moving|relocat\w*)\b/, "moving city outcomes"],
    [/\b(dog|puppy)\b/, "dog ownership"],
    [/\b(quit|leave|resign\w*)\b.*\b(job|work)\b/, "leaving employment career change"],
    [/\b(buy|buying|purchase)\b.*\bcar\b/, "car ownership"],
  ];
  const category = categories.find(([pattern]) => pattern.test(question))?.[1]
    ?? categories.find(([pattern]) => pattern.test(topic))?.[1];
  if (!category) return { source: "none" };
  const dimension = /\b(cost|money|afford|budget|rent|price)\b/.test(topic) ? "costs financial risks"
    : /\b(career|job|employment)\b/.test(topic) ? "employment outcomes"
      : /\b(happy|happiness|wellbeing|health)\b/.test(topic) ? "wellbeing outcomes" : "benefits risks long term outcomes";
  return { source: "search", query: `${uk ? "United Kingdom " : ""}${category} ${dimension} primary research official statistics` };
}
