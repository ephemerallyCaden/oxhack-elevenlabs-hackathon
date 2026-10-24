# auto-check

Runs by itself when Claude finishes a turn that changed code. Nobody has to remember a skill.

1. **Static:** built-in diff checks (deleted or edited tests, API keys in code), then your `static` commands.
2. **Tester:** a separate Claude session (`prompts/tester.md`) that may only write files matching
   `testGlobs`. It adds the tests the change is missing and leaves a test failing when the code is wrong.
3. **Dynamic:** your `dynamic` commands (tests, smoke run).

A failure is handed back to the coding session once (`/fix` rules). After that it is only reported to you.
Turns that only touched docs, or made no edits, are skipped. CI runs `scripts/check.mjs --ci` (static +
dynamic, no tester).

## Install
- This repo enables it in `.claude/settings.json`. Teammates get it after the branch is merged to `main` and they
  accept the folder trust prompt. If Claude says the plugin "isn't installed", run
  `claude plugin install auto-check@oxhack-tools --scope project`.
- Other projects: `/plugin install auto-check --marketplace ephemerallyCaden/oxhack-elevenlabs-hackathon`
- From a local checkout (try it out): `claude --plugin-dir plugins/auto-check`

## Limits
- The tester's file limit is enforced by Claude Code permissions, but only for its edit tools. A test file that
  itself writes elsewhere when it runs is not blocked. That would take an OS sandbox, which this plugin doesn't add.
- The tester runs as `claude -p --safe-mode`, so it uses your normal login and no plugins or hooks.

## Configure: `.claude/auto-check.json` in the project
```json
{
  "static":  [["build", "npm run build"], ["types", "npx tsc --noEmit"], ["lint", "npm run lint"]],
  "dynamic": [["tests", "npm test"]],
  "setup":   ["npm ci"],
  "testGlobs": ["tests/**", "**/*.test.*", "**/*.spec.*", "**/test_*.py", "**/*_test.py"],
  "tester": { "enabled": true, "testCommand": "npm test", "model": "sonnet", "maxBudgetUsd": 1, "timeoutSec": 300 }
}
```
With nothing configured the hook says "⚠ … not configured" rather than reporting a pass.

## Cost
The tester runs only on turns that changed non-test source files, and never on the hand-back round.
Each run is capped by `maxBudgetUsd` and `timeoutSec`. Set `"enabled": false` to keep checks without the tester.
