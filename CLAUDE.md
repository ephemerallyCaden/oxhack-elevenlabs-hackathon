# Roulette — The Council of Future Selves

> Speak a life decision; a Monte Carlo simulation on real data splits your future into timelines, and three versions of you argue it out in an Ace Attorney-style courtroom in your cloned voice. Full design: `DESIGN.md`. Tasks: GitHub Project "Roulette — Hackathon Board".

## Stack
- Framework: Next.js 16 (App Router, TypeScript) — **read `AGENTS.md`**: Next 16 has breaking changes; check `node_modules/next/dist/docs/` before using Next APIs
- UI: Tailwind CSS 4 + Framer Motion
- Data ingestion: Gemini API (`@google/genai`) with Google Search grounding, in `lib/ingest/`
- Simulation: TypeScript Monte Carlo in `lib/sim/` (**not Python** — Vercel can't run a numpy subprocess)
- Debate writing: Claude (`@anthropic-ai/sdk`), structured output via `messages.create()` + tool use (`messages.parse()` does not exist)
- Voice: ElevenLabs (`@elevenlabs/elevenlabs-js`) — IVC clone, TTS with per-role voice_settings, Scribe STT
- Validation: zod
- Database: none for the demo (Supabase auth cut)
- Deploy target: Vercel

## Commands
- `npm run dev` to start dev server (http://localhost:3000; use `127.0.0.1:3000` for any ElevenLabs allowlist)
- `npm run build` to build
- `npm run lint` to lint
- `npm test` to run tests once (Vitest + Testing Library, jsdom; `npx vitest` to watch). Tests live next to code as `*.test.ts(x)` or in `__tests__/`
- Put the same commands in `.claude/auto-check.json` (`static`, `dynamic`, `tester.testCommand`).

## Automatic checks (auto-check plugin)
The `auto-check` plugin in `plugins/auto-check/` runs by itself when Claude finishes a turn that changed files:
1. Static: our diff checks (deleted or edited tests, API keys in code), then `static` commands (build/types/lint).
2. Tester: a separate Claude session that may only write test files adds the tests the change is missing.
3. Dynamic: `dynamic` commands (tests, smoke).
The first failure is handed back to you once; after that it is only reported. GitHub Actions runs static + dynamic on every push and PR to `main`. You don't need to write tests or run the full check before stopping: the plugin does both.

## Testing
- Fix the code, not the tests. Tests may come from the tester, written from the intended behaviour. If one looks wrong, stop and say so.
- Never weaken, skip or delete a test to get green.
- Bug fixes: reproduce the bug with a test first (see `/fix`).
- The tester's rules (what to test, what to skip, no fake tests) live in `plugins/auto-check/prompts/tester.md`.
- Before calling a demo feature done, make one real ElevenLabs call by hand and listen to it. No automated check can hear audio.

## Architecture
- Entry point: `app/page.tsx` (decision input) → `app/court/page.tsx` (courtroom) 
- API routes: `app/api/**/route.ts` — **use POST** for all API routes (Next 16 Cache Components prerenders GET handlers)
- Shared contracts: `types.ts` (owned by D) — `DebateEvent`, `SimResult`, `KeyFinding`, `DataPoint`, API shapes. Build against these; change them only by agreement.
- The courtroom is driven ONLY by a queue of `DebateEvent`s (live, cached fallback and replay all use the same player)

| Folder | Owner | What |
|---|---|---|
| `lib/sim/`, `lib/ingest/` | A — Dust-OP | Monte Carlo engine, Gemini data ingestion, data tables |
| `lib/voice/`, `lib/audio/` | B — randodeh | ElevenLabs TTS/STT/clone, Web Audio engine |
| `app/` pages, `components/` | C — ephemerallyCaden | Courtroom UI, loading screen, verdict, demo mode |
| `lib/debate/`, `types.ts` | D — awckiu | Claude prompts, orchestrator, interrupts, fallback |

## Mock-first rule (we may not have API keys yet)
- Every wrapper around an external API (Gemini, Claude, ElevenLabs) must **return mock/cached data when its key is missing** or the call takes > 5s. The app must always run end to end.
- Mocks live next to the code: `lib/sim/mock-result.json`, `lib/debate/mock-events.json`, etc.

## API keys
- In `.env.local` (gitignored): `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_BACKUP_VOICE_ID`
- Keys are server-only: read them in route handlers / server code, never in `"use client"` files or `NEXT_PUBLIC_*` vars.

## ElevenLabs
- Docs: https://elevenlabs.io/docs/api-reference
- **Verify model IDs and SDK method names against the installed SDK types before use** — research files contradict each other (see `research/13-devils-advocate-review.md`). Use the cheap/fast model for dev, the best model for the demo.
- Consume TTS streams immediately (don't hold a stream across `await`s — see `research/07`).

## Rules
- Read files before editing. Don't guess what exists.
- No features beyond what was asked. Hackathon scope is tight.
- Match existing patterns. Don't refactor adjacent code.
- Fix what you break: fix the code, not the tests (see "Testing").
- Commit after every working feature. Small commits, clear messages.
- If unsure, ask. Don't assume and build the wrong thing.
- No abstractions for one-time code. Inline is fine for 24 hours.
- Skip error handling except on the demo path.

## Context management
- When context feels long (50+ tool calls, or responses getting shorter): write your current plan to PLAN.md, then run `/compact`.
- Compact AFTER: finishing a research phase, fixing a bug, completing a feature.
- Do NOT compact DURING: active implementation, multi-file changes, debugging.
- After compacting: read PLAN.md and SPEC.md back to restore state.

## Agent auto-routing
Use these agents and skills proactively without being asked:
- Before merging: run `/verify` (the auto-check plugin already covers routine checks)
- When a build or test fails: run `/fix` with the error output
- Before committing: run `git diff` and scan for debug code, hardcoded secrets, console.logs
- When starting a new feature: read the GitHub issue for it (`gh issue view <n>`) and DESIGN.md to check scope and team ownership
- When exploring unfamiliar code: use the `explorer` agent, don't read files one by one

## Team
Four developers working in parallel on feature branches.
- Merge to `main` only when your feature works and builds.
- Coordinate with teammates before touching shared files.
- Each person owns their branch. Don't edit others' branches.
- Branches: `feature/sim`, `feature/voice`, `feature/frontend`, `feature/debate`. Stay inside your own folders (table above).
- D (awckiu) merges to `main` every 2-3 hours; feature freeze at H18.
