# Engine handoff: contracts and timing

What the trial engine (D) gives the UI, what it needs from research and voice, and how much time each step gets. Design: [`design-core-loop.md`](design-core-loop.md). Types: [`types.ts`](../types.ts). Engine: [`lib/debate/`](../lib/debate/).

Every call falls back to a mock built from the user's own question, so you can build against all of this with no API keys.

```
ask → preparing (cut-scene: agenda + personas + research)
    → per topic: intro → YES ↔ NO (2 cycles, +1 per user interrupt) → Judge scores → spectrum moves
    → verdict → transcript with sources
```

---

## For the UI (C · ephemerallyCaden)

The UI doesn't call the API routes itself. It creates one `TrialOrchestrator` in the browser, renders its state and tells it when a line has finished playing. `app/dev/trial/page.tsx` is a working reference for the whole contract.

### The four screens

| UI screen | `s.scene` | Text | Numbers |
|---|---|---|---|
| Prosecutor (best future you, YES) | `yes` | `s.current.text` | — |
| Defence (worst future you, NO) | `no` | `s.current.text` | — |
| Mediator (the Judge) | `judge` | `s.current.text` | `s.spectrum.value` (−100…+100) + `s.spectrum.label`; per topic `s.agenda[i].score.t`; at the end `s.verdict` |
| Interrupt | `witness` while `s.phase === 'listening'` | `s.interruptTarget` = who is being interrupted | — |

`cutscene` is the loading moment at the start. Show it as the mediator if you don't want a fifth screen. `witness` is also the scene when the user first asks their question.

### Methods

```ts
import { TrialOrchestrator } from '@/lib/debate/orchestrator';
import { useTrialState } from '@/lib/debate/useTrial';

const orch = useMemo(() => new TrialOrchestrator({ voiceId, profile }), []); // both from onboarding
const s = useTrialState(orch);            // re-renders on every state change

orch.start(question);                     // after the user asks "Should I …?"
orch.lineEnded(s.current.id);             // when the current line finished playing
orch.beginInterrupt();                    // hold-to-talk pressed → 'prosecution' | 'defense' | 'judge' | null
orch.endInterrupt(blobOrText);            // released: audio Blob or typed text; null = cancelled
```

### State (`s`)

| Field | What to do with it |
|---|---|
| `phase` | `ask` · `preparing` (cut-scene) · `speaking` · `listening` (user is interrupting) · `thinking` (show `status`) · `done` |
| `scene` | `yes`, `no`, `judge` (close-ups), `witness` (zoom-out, all three face the user), `cutscene` |
| `current` | The line on screen: `speaker`, `text` (show this), `audioUrl` (play it), `durationMs` (timer when there's no audio), `kind`, `cites` |
| `current.kind` | `argument`, `answer` (replying to the user), `cut_in` (YES/NO interrupting each other: give it the splash), `resume`, plus the Judge's `opening`, `intro`, `score`, `agenda_change`, `verdict` |
| `canInterrupt` | Enable the INTERRUPT control only when true |
| `interruptTarget` | Who is being interrupted (while `listening`). YES/NO must answer the user; the Judge treats it as adding or removing a topic. |
| `status` | Loading text for `preparing` / `thinking`, e.g. "The defense prepares…" |
| `profile` | Who's asking (from onboarding): name, age, situation, location |
| `personas` | `yes` / `no`: best and worst future you, with `age`, `when` ("1 year from now"), `snapshot`, mood. Set during the cut-scene. |
| `agenda` | Topics: `title`, `importance` (0–1, weights sum to 1), `status` (pending/active/done/removed), `added_by`, `score.t` (−1…+1) |
| `activeTopicId` · `cycle` · `totalCycles` | Current topic; show "cycle `cycle`/`totalCycles`". 2 per topic, +1 each time the user interrupts YES or NO. |
| `spectrum` | `value` −100…+100 and `label` (Strong no … Strong yes); moves after each topic is scored |
| `verdict` | At the end: `spectrum`, `explanation`, `breakdown[]` per topic (title, weight, t, deciding_argument, added_by) |
| `result` | The transcript: `lines[]` + numbered `sources[]`. Footnotes per line: `footnotes(result, line)` from `lib/debate/transcript.ts` |
| `fallbacks` | Which calls used mock data. Dev overlay only; hide it in the demo. |

### Server routes behind it

For reference only: the orchestrator calls these. All are `POST` with JSON; the request and response types are in `types.ts`.

| Route | Does |
|---|---|
| `/api/trial/agenda` | Question + profile → 1–4 weighted topics, the Judge's opening and one intro per topic |
| `/api/trial/personas` | Question + profile → best (YES) and worst (NO) future you |
| `/api/trial/argue` | One YES or NO line on a topic, citing evidence cards (or answering the user's interrupt; may include an AI cut-in) |
| `/api/trial/score-argument` | Background: one line → pros/cons ledger entry |
| `/api/trial/score-topic` | Ledger → topic score (−1…+1) and the Judge's ruling line |
| `/api/trial/judge-interrupt` | User interrupted the Judge → add or remove a topic |
| `/api/trial/verdict` | Final explanation and line; the spectrum itself is computed in code |

---

## Needed from research (A · Dust-OP · issue #5)

One endpoint. For each topic the engine asks twice, once for YES and once for NO: a **quick** pass before the topic is debated, and a **deep** pass in the background whose cards are used in later turns. The debaters may only state facts that come from these cards, and every card becomes a numbered source in the transcript.

```jsonc
POST /api/research
{
  "question": "Should I take a gap year before university?",
  "topic": { "id": "topic-1", "title": "Cost and money",
             "question": "What does a gap year cost, and can you afford it?" },
  "side": "no",                 // "yes" = evidence FOR doing it, "no" = AGAINST
  "tier": "quick"               // "quick" or "deep"
}

// → 200
{
  "cards": [
    {
      "id": "topic-1-no-quick-1",
      "topic_id": "topic-1",
      "side": "no",
      "claim": "A gap year usually costs more than it earns",
      "evidence": "[one concrete fact with its number, from the source]",
      "source_name": "[publisher or site name]",
      "source_url": "https://…",
      "strength": 4,
      "tier": "quick"
    }
  ],
  "fallback": false
}
```

| Field | Rule |
|---|---|
| `id` | Unique across the whole trial, e.g. `${topic_id}-${side}-${tier}-${n}` |
| `topic_id` · `side` · `tier` | Copied from the request |
| `claim` | The point it supports, phrased for an argument (one sentence) |
| `evidence` | The fact itself, with a number where possible. Never invented. |
| `source_name` · `source_url` | A real page that contains the fact. An empty `source_url` means "mock" to the engine. |
| `strength` | 1–5: how specific, credible and on-topic it is |

- **Any question:** career, study, travel, money, pets, relationships. Nothing is specific to one demo.
- **No key or an error:** return `{ "cards": [], "fallback": true }` or a non-200. The engine then uses labelled mock cards and tells the debaters not to invent numbers.
- **Time limits:** see the timing budget below.

---

## Used from voice (B · randodeh)

| Route | Contract |
|---|---|
| `POST /api/voice/tts` | `{ text, speaker, voiceId? }` → `{ audioUrl, durationMs, fallback }`. Called once per line; the next line is voiced while the current one plays. |
| `POST /api/voice/stt` | multipart `audio` → `{ transcript, fallback }`. Used for the question and for every interrupt. |

---

## Timing budget

The trial should feel like watching a film: no waiting after the first second. Only the start is on the critical path. After that, every slow step runs while something else plays, and each line is written and voiced while the previous one is playing.

### The first 30 seconds

| t (s) | On screen | In the background |
|---|---|---|
| 0 | User finishes asking | STT (≤ 2s) |
| 1–7 | Cut-scene: "ALL RISE", pre-recorded filler audio | Agenda + Judge lines (≤ 5s) and personas (≤ 5s), in parallel |
| ~5 | Cut-scene | Voice the opening + topic 1 intro (≤ 2s); quick research for topic 1; deep research for every topic |
| 7–17 | Judge's opening (~10s) | Topic 1 quick cards land (≤ 5s), then YES's first argument is written and voiced (≤ 6s) |
| 17–25 | Topic 1 intro (~8s) | Spare time |
| 25+ | YES ↔ NO | Each next line is prepared during the current one (~10–15s each) |

The user hears sound about a second after asking, and the first argument starts with no gap.

### Budgets per step

The timeouts are in [`lib/debate/timeouts.ts`](../lib/debate/timeouts.ts). The route gives up first (`server`) and returns its mock; the browser waits slightly longer (`client`).

| Step | Budget (p90) | Timeout → fallback | Must beat |
|---|---|---|---|
| STT (question / interrupt) | 2s | 8s → typed input | — |
| Agenda + intros | 5s | 8s → mock agenda | End of the cut-scene filler (~7s) |
| Personas | 5s | 8s → mock personas | Same; runs in parallel with the agenda |
| TTS per line | 2s | 7s → text only | The end of the line before it |
| **Quick research** (per topic, per side) | **5s, 2–3 cards** | 6s → mock cards | Topic 1 only: before YES's first argument is written (~t = 10). Topics 2+: no pressure. |
| **Deep research** (per topic, per side) | **45s, 3–6 cards** | 50s → skipped | Topic 1: lands around cycle 2. Topics 2+: ready long before their intro, since a topic lasts ~80s. |
| Next argument (written + voiced) | 6s | 8s → mock line | The line playing now (~10–15s) |
| Ledger scoring (background) | 6s | 7s → mock | The end of the topic |
| Topic score + Judge's ruling | 5s | 8s → ledger maths | The end of the topic's last line |
| Interrupt reply | STT 2s + 5s + TTS 2s | → generic Judge reply | Covered by a pre-voiced "The court considers your objection…" |
| Verdict | 6s | 9s → template | Covered by the last ruling + "The court retires…" |

### What this means for each person

- **Research (A):** quick research is the only research on the critical path, and only for topic 1. Use one query per side and no follow-up searches. Deep research gets ~45s and should go for quality: primary sources, real numbers. Up to 16 research calls start at once (2 sides × 2 tiers × up to 4 topics), so check the Gemini rate limits or queue the deep calls.
- **Voice (B):** pre-recorded filler clips are needed for the cut-scene ("All rise…"), "The court considers your objection…" and "The court retires to consider its verdict…". They can come from the B9 sound effects.
- **Engine (D):** to hold this timeline, the opening should play as soon as the agenda arrives (research is awaited only before YES's first argument); the topic score and the Judge's next lines should be prepared while the previous line plays; and the filler clips should play at the three waiting moments above.
- **Length:** about 80s per topic (intro, 4 arguments, a cut-in, the ruling). 4 topics ≈ 5.5 minutes, longer than the pitch, so the demo should cap at 2–3 topics (≈ 3 minutes).
