# lib/debate — owner: awckiu (D)

The trial engine. Design: `docs/design-core-loop.md`. Contract: `types.ts`.

| File | What |
|---|---|
| `orchestrator.ts` | Browser-side state machine: agenda → per-topic inner loop (2 YES/NO cycles, +1 per user interrupt, at most one AI cut-in per topic) → Judge scores → spectrum → verdict → transcript. Interrupts: a side must answer you; the Judge changes the agenda. |
| `useTrial.ts` | `useTrialState(orch)` React binding |
| `trial.ts` | Server-side Claude calls behind `app/api/trial/*` |
| `prompts.ts` | All prompts (generic: any "Should I …?") |
| `spectrum.ts` | Weights, topic balance, spectrum maths (pure, tested) |
| `transcript.ts` | Transcript + numbered sources |
| `mock.ts` | Decision-aware mocks: used when a key is missing or a call is slow |
| `fallback.ts` | `withFallback`, `postJson`, ids |

UI contract (C): render `state.scene` + `state.current`, play the line (`audioUrl`, or `durationMs` as a timer), call `orch.lineEnded(id)` when done. Hold-to-talk: `orch.beginInterrupt()` on press, `orch.endInterrupt(blob | text | null)` on release. Before the trial: `orch.start(question)`.

Calls other people's routes, with mock fallbacks: `POST /api/research` (A), `POST /api/voice/tts` + `/api/voice/stt` (B).

Try it: `npm run dev` → http://localhost:3000/dev/trial (works with no API keys).
