import type { TopicResearchRequest } from "./research-contract";

type Vocabulary = [RegExp, string][];

// Only these reviewed terms leave the server as search queries. Names, amounts,
// addresses and unrecognized free text are never copied from the request.
const decisions: Vocabulary = [
  [/\bgap year\b/i, "gap year education career"],
  [/\b(?:quit|leave|leaving|resign\w*)\b.*\b(?:job|work|employment)\b|\bcareer change\b/i, "leaving employment career change"],
  [/\b(?:move|moving|moved|relocat\w*|emigrat\w*|expat\w*)\b/i, "relocation housing employment"],
  [/\b(?:marry|married|marriage|wedding)\b/i, "marriage financial responsibilities relationships"],
  [/\b(?:divorce|separat\w*|break up)\b/i, "relationship separation financial responsibilities"],
  [/\b(?:retire|retirement|retiring)\b/i, "retirement planning"],
  [/\b(?:start|starting|open|opening|run)\b.*\bbusiness\b|\bself[ -]?employ\w*\b/i, "starting a business self employment"],
  [/\b(?:remote work|work from home|working from home)\b/i, "working from home"],
  [/\bpart[ -]?time\b/i, "part time employment"],
  [/\b(?:dog|puppy|pet|cat)\b/i, "pet ownership responsibilities"],
  [/\b(?:buy|buying|purchase)\b.*\bcar\b/i, "car ownership costs"],
  [/\b(?:travel|backpack\w*)\b/i, "travel planning"],
  [/\b(?:parent\w*|child\w*|baby)\b/i, "parenting childcare responsibilities"],
  [/\b(?:university|college|degree)\b/i, "higher education employment outcomes"],
  [/\b(?:rent|house|housing|mortgage|apartment)\b/i, "housing renting buying"],
  [/\b(?:exercise|fitness|gym)\b/i, "physical activity wellbeing"],
  [/\b(?:hobby|hobbies|pottery)\b/i, "leisure activities wellbeing"],
  [/\bvolunteer\w*\b/i, "volunteering wellbeing employment"],
];
const regions: Vocabulary = [
  [/\b(?:uk|united kingdom|britain|london)\b/i, "United Kingdom"],
  [/\b(?:usa|united states|america)\b/i, "United States"],
];
const dimensions: Vocabulary = [
  [/\b(?:costs?|money|afford\w*|budget|rent|price|financ\w*|saving\w*)\b/i, "costs financial risks"],
  [/\b(?:career|job|employment)\b/i, "employment outcomes"],
  [/\b(?:happy|happiness|wellbeing|health|stress)\b/i, "wellbeing benefits risks"],
];
const DEFAULT_DIMENSION = "benefits risks considerations";

const lookup = (vocabulary: Vocabulary, text: string) => vocabulary.find(([pattern]) => pattern.test(text))?.[1];

/** The decision comes from the overall question first, then the topic; the facet comes from the topic. */
export function planWebQuery(req: TopicResearchRequest): string | undefined {
  const facet = `${req.topic.title} ${req.topic.question}`;
  const decision = lookup(decisions, req.question) ?? lookup(decisions, facet);
  if (!decision) return;
  const region = lookup(regions, `${req.question} ${facet}`);
  const dimension = lookup(dimensions, facet) ?? DEFAULT_DIMENSION;
  return [region, decision, dimension].filter(Boolean).join(" ");
}
