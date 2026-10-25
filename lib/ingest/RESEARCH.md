# Bounded topic research

This service extends `collection.ts` and `collection-fetch.ts`; its bounded JSON
reader and provider transport are shared in `model-client.ts`. Community adapters
use pinned Cheerio 1.2.0 for HTML parsing without executing page scripts. It feeds D's existing profile/debate engine through the shared
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
diagnostics adds status, per-tool outcomes and warnings. Status is `ok`, `partial`,
`no_support` (sources were retrieved, but no admissible passage supported the
requested side), `unsupported`, `unavailable`, `not_configured`, `timeout` or
`cancelled`. Valid requests with no
supported evidence return empty cards/fallback, never invented evidence. Invalid,
oversized or slow request bodies return 400. D's current transport-error handling
may still generate its own mocks on a 400; this service does not control that path.

Execution: validate → choose approved public acquisition/captures → share identical
acquisition → normalize original source records → one model passage selection →
check exact excerpts/record IDs/side → construct source-bound evidence cards.
`evidence` is the selected quotation and `claim` its first sentence; model output
cannot supply a URL, publisher, card ID or strength. Dates, coverage and source
limitations travel in a separate `provenance` field that the debate prompts and
the verdict screen do not print. Strength starts conservatively at 1. Matching a
quotation is not semantic fact verification.

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

- Quick: bounded Exa page search across registered public sources, relevant UK CPI
  through the existing ONS API, plus explicitly registered public captures.
  Search uses eighteen reviewed life-decision patterns, including employment,
  marriage, retirement, business, education and housing. Unrecognized wording
  still returns empty unless another source plan or capture covers it.
- Public web queries combine fixed decision/facet/region terms. Personal names,
  exact amounts and other free text are not interpolated. This expands coverage;
  it is not a general semantic planner. Search runs for both tiers and sides can
  share the same acquisition. UK/US recognition is limited and returned advice
  may be jurisdiction-specific; the selector must assess its relevance.
- Deep: the same paths plus optional Thunderbit Search for five decision
  categories: gap year, moving, dog ownership, leaving a job and buying a car.
  The overall question selects the category first; the topic is a fallback.
  Query dimensions use fixed vocabulary for costs, employment, wellbeing or
  outcomes; no names, exact personal amounts or raw transcript are interpolated.
  Region recognition and phrasing are limited; unfamiliar wording/geographies
  may lose context or be unsupported. This is not a general semantic planner.
- Thunderbit accepts successful Markdown results only. Snippets, failed rows and
  unsafe links are excluded; omitted counts/sample limits remain visible. The
  provider's per-result timeout is not an end-to-end promise: our acquisition is
  independently capped at five seconds. Thunderbit provider quality/latency is untested. All records, including search
  results and imported captures, must pass the exact source-host registry in
  `source-policy.ts`; general search cannot promote arbitrary returned sites.
- EasySpider remains an export importer. `publicCaptures` registers
  trusted server-side readers of fixed public captures; it is not an HTTP upload,
  arbitrary filesystem reader, browser launcher or private-user document cache.
- The bounded question/topic text DOES reach the selected model provider for passage relevance. Public
  search minimization does not imply local-only AI processing.

## Community acquisition

Deep requests also select up to three matching, configured community adapters.
Public queries use a separate short fixed vocabulary for gap years, relocation,
pets, career changes, cars, travel, parenting, education, housing, fitness and
hobbies. This is bounded category matching, not general semantic understanding;
some community adapters intentionally cover only a subset of those categories.

| ID | Source | Collection boundary |
|---|---|---|
| stackexchange | Life-topic Stack Exchange communities | One question, up to three answers and two comments |
| discourse | Nomad Gate | One international relocation topic and sampled replies |
| wordpress | Nomadic Matt | One travel article and up to five comments |
| telegram | Public Telegram previews discovered through Exa | Up to two channel previews; no discussion replies |
| youtube | YouTube Data API | One video, ten comment threads and up to two reply pages |
| x | X recent search API | Initial posts and up to two conversation searches |
| wikipedia | Wikipedia | Up to two introductory extracts |
| crossref | Crossref | Up to three supplied publication abstracts; no full-paper claim |

`RESEARCH_COMMUNITY_SOURCES=all` is the default: prefer up to two matching forum
adapters, one configured social adapter (YouTube/X before Telegram), then fill
remaining slots with reference adapters. An ordered comma-separated list chooses
source priority explicitly; `none` disables community acquisition. Unknown IDs
are not enabled. `GET /api/research/sources` lists public-search access mode and community capabilities and
configuration flags without credentials. API configuration is not proof of access.

YouTube requires `YOUTUBE_API_KEY`; X requires `X_BEARER_TOKEN`. Telegram discovery
uses Exa REST with `EXA_API_KEY`, otherwise the public Exa advanced MCP service; provider
access or discovery can still fail. It is not native global Telegram search.
The current allowlist is intentionally narrow; adding another site requires code
and access verification, not a user-supplied URL. EasySpider imports are checked
against the same source registry when used for evidence cards.

Round-robin source records enter the shared ten-record normalization cap so one
source cannot fill every slot. HTML is parsed once; already-plain text is preserved.
Recognizable quoted-parent HTML is removed from a reply's selectable text. Parent
context stays separate and is labelled in the final evidence card. A reply without
available parent context is omitted. This does not detect all plain-text quotation
conventions or establish independent factual truth. Source language is not gated.

## Budgets and sharing

Quick is bounded by 5s and deep by 45s, including request-read time, queue wait,
acquisition and selection. Request bodies have a 16KB cap and 1s read deadline.
Acquisition and selection queues reserve capacity for quick work; cancelled queued
jobs never start. The same public acquisition can serve multiple sides/tiers, but
selection and card IDs remain request-specific. A cancelled caller does not cancel
another subscriber's job. No generated cards or personal requests are cached.
The selector classifies passage direction with the requested side omitted from
its model payload, then the agent keeps only the requested side. Quick selection
asks for at most two passages and caps model output at 800 tokens. This reduces
pressure to relabel risks as benefits; semantic direction still needs evaluation
and is not guaranteed by exact text matching.

Collector success cache: up to 64 entries for one hour, preserving capture time;
failure results are not success-cached. Community success cache is separately
bounded to 64 entries for ten minutes, preserving capture time. Failed identical
collections have a separate 64-entry retry throttle (one minute); API backoff and
HTTP 429 cooldowns persist across jobs. Already fetched records remain usable when
later collection is rate-limited, with the rate-limit diagnostics retained.

Public web search makes one Exa request, capped at 2.2 seconds (2.4 seconds
including acquisition queue time) to leave part of the quick budget for selection.
It requests at most four pages, retains a continuous excerpt of up to 3,200
characters per page, and uses a 64-entry cache (ten minutes with records, one
minute without). HTTP 429 host cooldown spans queries. Cache and sharing are
process-local. A slow model, busy queue or failed search can still yield an empty
response within the five-second limit; useful cards are not guaranteed.

Highlights locate excerpts in returned page text. Highlights alone, generated
summaries, unregistered hosts and unsafe links cannot become evidence. Search
returns provider-captured material; this route does not independently fetch each
original page. The preserved limitations state that distinction. Domain identity
does not upgrade confidence. A keyed Exa failure never silently retries anonymously.

Each community job has at most four HTTP calls, each bounded to four seconds and
512 KB; total collection is capped at 16 seconds and acquisition including queue
wait at 20 seconds. HTTP redirects and unregistered endpoint hosts are rejected.
The global quick/deep deadlines still apply. Sharing/cache/queues are process-local.
Vercel cold starts and separate instances do not share them. A timeout limits the
response and signals cancellation; JavaScript cannot forcibly stop a transport
that ignores cancellation. Browser/platform workers belong outside this route.

## Local and Vercel runtime

- Node 24.x is declared in package/lock metadata. Use the existing scoped Node
  24.15 toolchain for local tests/build; system Node 22.14 has known test dependency
  issues. Cheerio is the sole added direct runtime dependency.
- Next 16.4.3 with Cache Components uses Node by default. Do not add a route
  `runtime` export: this installed version rejects it with Cache Components.
- The route exports `maxDuration = 60`; internal deadlines remain shorter.
  `vercel.json` selects Next.js, `npm run build` and `.next` output.
- Server model selection: `RESEARCH_MODEL_PROVIDER=agnes` (default), `gemini`, `groq`,
  `openrouter`, or `openai` for any other OpenAI-compatible server. Named providers need
  their key (`AGNES_API_KEY` / `AGNES_API_KEY_1`, `GEMINI_API_KEY`, `GROQ_API_KEY`,
  `OPENROUTER_API_KEY`); `openai` needs `RESEARCH_MODEL_BASE_URL` (https; API root or full
  chat-completions URL), `RESEARCH_MODEL_API_KEY` and `RESEARCH_MODEL`. Keys never fall back
  across providers. `RESEARCH_MODEL` overrides the provider default (`AGNES_MODEL`,
  `GEMINI_MODEL`, `GROQ_RESEARCH_MODEL`, `OPENROUTER_RESEARCH_MODEL`). The endpoint is
  never taken from a request body. See `.env.example`.
  `GEMINI_MODEL` is also used by the debate engine. Keep its compatible
  `gemini-3.6-flash` default there; use `RESEARCH_MODEL` to change only research.
- The passage selector reads this configuration. Endpoint and wire options live
  only in `model-client.ts`; request input cannot choose them.
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
Configure the chosen model key for evidence selection. `THUNDERBIT_API_KEY` adds
optional search; public community adapters do not require that key.
Missing keys or insufficient evidence return an explicit empty/partial result.

`RESEARCH_WEB_SEARCH=none` disables public web search; `exa` is the default.
An optional `EXA_API_KEY` selects REST; otherwise public MCP access is used.
The [Exa search API](https://exa.ai/docs/reference/search) and
[advanced MCP tool](https://exa.ai/docs/get-started/exa-mcp) supply page text.
The same client also handles Telegram discovery. No Gemini Google Search grounding
or arbitrary page fetching is used. The research request does not include raw profile fields.

Fixture tests cover orchestration, HTTP limits, cooldowns, source selection,
quoted-parent separation, opaque comment IDs, language-neutral content handling,
and the real POST handler with external network/model transports replaced.
Live runtime evidence is recorded separately from fixtures. Keyed provider access,
quotas and protected cloud previews require their own acceptance checks.
