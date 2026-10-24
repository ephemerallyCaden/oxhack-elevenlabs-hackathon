# Bounded topic research

This service extends `collection.ts` and `collection-fetch.ts`; its bounded JSON
reader and provider transport are shared in `model-client.ts`. It adds no runtime
dependencies. It feeds D's existing profile/debate engine through the shared
research contract and does not require a preview UI.

## Contract and execution

`POST /api/research` accepts the current main request:

```json
{
  "question": "Should I take a gap year in the United Kingdom?",
  "topic": { "id": "topic-cost", "title": "Cost", "question": "What costs and financial risks matter?" },
  "side": "no",
  "tier": "deep"
}
```

It returns `{cards, fallback, diagnostics}`. The first two fields match main;
diagnostics adds status, per-tool outcomes and warnings. Valid requests with no
supported evidence return empty cards/fallback, never invented evidence. Invalid,
oversized or slow request bodies return 400. D's current transport-error handling
may still generate its own mocks on a 400; this service does not control that path.

Execution: validate → choose approved public acquisition/captures → share identical
acquisition → normalize original source records → one model passage selection →
check exact excerpts/record IDs/side → construct source-bound evidence cards.
The claim is the selected quotation; model output cannot supply a URL, publisher,
card ID or strength. All source limitations remain in evidence; strength starts
conservatively at 1. Matching a quotation is not semantic fact verification.

## Courtroom roles and evidence

Awckiu's engine has prosecution (YES), defense (NO) and a Judge. YES/NO refers to
the overall user question; the topic only narrows a facet, even when phrased as a
risk question. Both imagined future selves said YES, with best/worst outcomes;
their fictional experiences are not source facts. Two evidence sides feed the
opposing arguments, then D scores their exchange and produces the verdict.
There is no third Judge research side. A source may contain different supporting
passages for both sides; acquisition can be shared while card IDs remain distinct.
See the team's [engine handoff](../../docs/engine-handoff.md) for the surrounding flow.

## Coverage in this slice

- Quick: relevant UK CPI through the existing ONS API, plus explicitly registered
  public captures. Cold search is excluded; unsupported quick topics return empty.
- Deep: the same paths plus optional Thunderbit Search for five English decision
  categories: gap year, moving, dog ownership, leaving a job and buying a car.
  The overall question selects the category first; the topic is a fallback.
  Query dimensions use fixed vocabulary for costs, employment, wellbeing or
  outcomes; no names, exact personal amounts or raw transcript are interpolated.
  Region recognition and phrasing are limited; unfamiliar wording/geographies
  may lose context or be unsupported. This is not a general semantic planner.
- Search accepts successful Markdown results only. Snippets, failed rows and
  unsafe links are excluded; omitted counts/sample limits remain visible. The
  provider's per-result timeout is not an end-to-end promise: our acquisition is
  independently capped at five seconds. Real provider quality/latency is untested.
- EasySpider/MediaCrawler remain export importers. `publicCaptures` registers
  trusted server-side readers of fixed public captures; it is not an HTTP upload,
  arbitrary filesystem reader, browser launcher or private-user document cache.
- The bounded question/topic text DOES reach the selected model provider for passage relevance. Public
  search minimization does not imply local-only AI processing.

## Budgets and sharing

Quick is bounded by 5s and deep by 45s, including request-read time, queue wait,
acquisition and selection. Request bodies have a 16KB cap and 1s read deadline.
Acquisition and selection queues reserve capacity for quick work; cancelled queued
jobs never start. The same public acquisition can serve multiple sides/tiers, but
selection and card IDs remain request-specific. A cancelled caller does not cancel
another subscriber's job. No generated cards or personal requests are cached.

Collector success cache: up to 64 entries for one hour, preserving capture time;
failure results are not success-cached. Sharing/cache/queues are process-local.
Vercel cold starts and separate instances do not share them. A timeout limits the
response and signals cancellation; JavaScript cannot forcibly stop a transport
that ignores cancellation. Browser/platform workers belong outside this route.

## Local and Vercel runtime

- Node 24.x is declared in package/lock metadata. Use the existing scoped Node
  24.15 toolchain for local tests/build; system Node 22.14 has known test dependency
  issues. No dependency package was added by this slice.
- Next 16.4.3 with Cache Components uses Node by default. Do not add a route
  `runtime` export: this installed version rejects it with Cache Components.
- The route exports `maxDuration = 60`; internal deadlines remain shorter.
  `vercel.json` selects Next.js, `npm run build` and `.next` output.
- Server model selection: `RESEARCH_MODEL_PROVIDER=agnes` (default) or `gemini`.
  Set `AGNES_API_KEY` (also accepts `AGNES_API_KEY_1`) or `GEMINI_API_KEY` for the
  chosen provider. Keys never fall back across providers. `RESEARCH_MODEL` overrides
  the provider-specific `AGNES_MODEL` / `GEMINI_MODEL` default. See `.env.example`.
  `GEMINI_MODEL` is also used by the debate engine. Keep its compatible
  `gemini-3.6-flash` default there; use `RESEARCH_MODEL` to change only research.
- The selector and two-stage collection response share this configuration. Endpoint
  and wire options live only in `model-client.ts`; request input cannot choose them.
  Gemini uses Google's [OpenAI-compatible JSON API](https://ai.google.dev/gemini-api/docs/openai),
  with its own schema/reasoning settings. Unknown providers fail without a request.
  D's debate engine chooses Claude or Gemini separately. No hosted settings or
  keys are changed by this module.
- Optional `THUNDERBIT_API_KEY` enables supported deep search; missing model/search
  keys produce explicit diagnostics. No live Gemini acceptance is claimed.

The Vercel project must point to this Next app, rather than the older static
`public/index.html` demo. Repository configuration alone does not prove the hosted
root, alias, environment or function runtime is correct. Hosted acceptance remains
separate from local build and HTTP checks.

## Checks

Use Node 24.15+ and the existing checker:

```sh
npm ci
node plugins/auto-check/scripts/check.mjs
```

Tests call the libraries and real POST handler directly with external transports
replaced by fixtures. They cover deadline/queue behavior, shared acquisition,
provider isolation, exact quotations, malformed sources and missing-key results.
They require no preview UI or live provider credentials.

To use HTTP, run `npm run dev` and POST the JSON example above to `/api/research`.
Configure `THUNDERBIT_API_KEY` and the chosen model key for supported deep search.
Missing keys or insufficient evidence return an explicit empty/partial result.
The two-stage prose helper `generateCollectedResponse` remains a server-library
export; the courtroom owns the final answer and does not call that helper twice.

The Mac research handoff proposes Exa highlights as an additional acquisition
adapter. That remains a separate coverage/latency trial, not an active fallback.
No Gemini Google Search grounding, arbitrary page fetching or numeric-only fact
verification is used here. Exact source quotations are retained, and raw profile
fields are not added to the current research request.
