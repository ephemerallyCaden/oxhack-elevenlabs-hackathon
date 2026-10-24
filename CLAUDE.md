# [PROJECT NAME]

> [One sentence: what it does and who it's for]

## Stack
<!-- Fill in at kickoff -->
- Framework:
- UI:
- Database:
- External APIs: ElevenLabs (voice synthesis/cloning)
- Deploy target:

## Commands
<!-- Fill in once stack is chosen -->
- `[dev command]` to start dev server
- `[build command]` to build
- `[test command]` to run tests
- `[lint command]` to lint
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
<!-- Fill in after initial scaffolding -->
- Entry point:
- API routes:
- Components:

## ElevenLabs
- API key in `.env` as `ELEVENLABS_API_KEY`
- Docs: https://elevenlabs.io/docs/api-reference
- SDK: `pip install elevenlabs` or `npm install elevenlabs`

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
- When starting a new feature: read SPEC.md first to check scope and team ownership
- When exploring unfamiliar code: use the `explorer` agent, don't read files one by one

## Team
Four developers working in parallel on feature branches.
- Merge to `main` only when your feature works and builds.
- Coordinate with teammates before touching shared files.
- Each person owns their branch. Don't edit others' branches.
