---
name: fix
description: Paste an error message or describe a bug. Traces the cause and fixes it.
---

# Fix

Fast bug squashing. Paste an error, stack trace, or describe what's wrong.

## Process

1. Parse the error. Identify the file and line number from the stack trace.
2. Read that file and its imports to understand the context.
3. Identify the root cause. Common hackathon bugs:
   - Missing import or wrong path
   - Undefined variable / typo in name
   - Wrong API response shape (check actual response vs what code expects)
   - Missing env variable (check .env.example)
   - Type mismatch between frontend and backend
   - Async/await missing
   - CORS / network error
4. If the bug is in logic a test can reach in seconds, add one test that reproduces it and run it. It must fail. Skip this for config, env, styling or dependency issues.
5. Fix the root cause. Change the minimum number of lines. Fix the code, not the test; if the test itself looks wrong, stop and say so.
6. Run `node plugins/auto-check/scripts/check.mjs` (or the commands in CLAUDE.md). The new test must now pass.
7. Report what was wrong, what you changed, and the test that guards it (or why there is none).
8. If checks fail with a new error, repeat from step 1. Max 3 cycles. Still failing: stop, report, and suggest `/reference-loop` for the specific error.

If the error is in a dependency or environment issue (not our code), say so and suggest the manual fix.

Do NOT refactor surrounding code. Do NOT add error handling beyond what's needed. Do NOT touch files unrelated to the bug.
