# Using reference-loop in this repository

Reference-loop helps a coding agent turn a specific development problem into a
supported implementation decision: find relevant sources, read discussion and
corrections, map reusable code to the need, try the useful part, and save the
decision and next action. It is useful when an approach is unclear or a fix is
not working. Ordinary edits with an understood solution can proceed directly.

The coding agent runs the loop with its available tools. The included scripts
collect and retrieve evidence; they do not run a model or keep working in the
background. This is the research and reuse component of the wider project
lifecycle. Task ownership, PR review, integration and product acceptance still
use the team's project process.

Claude Code reads the small entry under `.claude/skills/reference-loop`, then
reads the shared procedure. Its explicit repeat/stop rules route failed trials
back to adaptation or research and end a round when the needed result is reached
or progress is blocked. This runs within the active conversation; it does not
require Claude's built-in `/loop` command or install a recurring task.

## Fit with this hackathon's existing skills

- Use `/spec` to define the demo and feature ownership.
- Use `/fix` for a concrete bug and `/unstick` when attempts keep failing.
- Use `reference-loop` when progress needs external evidence, a dependency
  investigation or a reusable implementation. Bring back the source context,
  proposed adaptation and a useful trial result, then continue the feature.
- Use the existing project review and delivery process when the feature is ready.
  Invoking this research skill does not publish code or trigger `/ship`.

These other slash commands are the repository's Claude Code skills. Adding
reference-loop gives Codex this shared research procedure; it does not port all
the repository's Claude agents, hooks or other skills to Codex. This repository
still has placeholder stack and build commands in CLAUDE.md. Fill those through
the project's kickoff process before expecting a real product build or trial.

## Add these files to a project

Copy these three paths into the root of the destination Git checkout, preserving
their contents and any existing unrelated files:

```text
.agents/skills/reference-loop/       Shared procedure, helpers and source adapters
.claude/skills/reference-loop/       Claude Code entry into the same procedure
docs/reference-loop.md              This team guide
```

If the destination already has either skill folder, compare and merge it instead
of overwriting it. These are ordinary files: commit them on a task branch and
open a PR using the repository's existing contribution process. Review the diff,
then merge; teammates receive the same version when they pull. No link installer
or change to AGENTS.md is required. Dot-prefixed folders may be hidden by a file
browser, so include both explicitly when copying or adding files to Git.

Maintain the procedure under `.agents/skills/reference-loop`. The Claude entry
points to it so the two clients do not accumulate separate workflow rules. Both
locations follow their clients' documented repository skill discovery:
[Codex](https://learn.chatgpt.com/docs/build-skills#where-to-save-skills) and
[Claude Code](https://code.claude.com/docs/en/skills#choose-where-skills-load).

## Use it on a real task

Open the repository in a local Codex or Claude Code session and invoke:

```text
Codex:       $reference-loop Investigate why streamed speech starts late in our demo.
Claude Code: /reference-loop Investigate why streamed speech starts late in our demo.
```

Include the affected feature, observed behavior and relevant runtime/version
when known. The agent should inspect project context, search existing results,
read useful sources and their replies, choose a bounded next step, and perform
an authorized trial. It should explain what worked and what remains uncertain.

For example, the result may identify playback buffering as the cause, cite
applicable discussion, map the proposed change to the project's code, and
measure whether the target demo starts playing speech sooner. This is an example
of the desired output, not a claim that this product issue was tested.

If the entry is missing, restart the client from the checkout. If a personal
skill also has this name, select the repository version in Codex; Claude Code's
personal entry can take precedence. An explicit fallback in either client is:

```text
Read .agents/skills/reference-loop/SKILL.md in this repository and follow it
for this task: [problem or existing task folder].
```

## What each developer needs

| Capability | Requirement |
| --- | --- |
| Follow the procedure and use available research tools | A working coding client with access to this checkout |
| Save, search, read and resume evidence with the bundled helpers | Node.js 22+; no npm install needed |
| Collect GitHub issue conversations | Node.js and the `gh` CLI with the required read access |
| Collect a public Bilibili sample | Node.js and access to its public HTTP endpoints |
| Add public Telegram previews and RSS/Atom tools | Optional setup below, separately on each device/client |

Existing search/browser tools remain useful. A committed skill cannot supply
missing client credentials or source access. The two clients share the procedure
and task files; they may have different tools and must report those limits.

For the optional public source connectors, first have Python 3.13, Git, uv and
the selected client's CLI available. From the repository root, run one of these
commands with that Python interpreter (on Windows, `py -3.13` can replace
`python3.13`):

```text
python3.13 .agents/skills/reference-loop/telegram/setup.py --client codex
python3.13 .agents/skills/reference-loop/telegram/setup.py --client claude
```

The setup downloads pinned dependencies outside the repository and registers
`reference-telegram-public` and `reference-feeds` for the selected local client.
It uses this checkout's adapter paths, so keep the checkout at a stable location.
If the same connector name already points elsewhere, setup preserves it and
reports the conflict; inspect that entry instead of blindly replacing it. An
existing working connector can be used without reinstalling it. Open a fresh
client session to check actual tool availability and a relevant source read.

Public Telegram previews require no account login and have bounded coverage;
they do not include private history or discussion replies. Feeds discover topics,
not complete comment threads. The separate account adapter requires local login
and is optional. Read [source coverage](../.agents/skills/reference-loop/references/source-tools.md)
before relying on a source. Commit code and suitable task results, never account
sessions, credentials or a developer's client configuration.

## Continue as a team or on another device

Use the project's existing task location. When a persistent investigation helps,
the agent creates a TASK.md, saves relevant evidence and writes RESULT.md with
the decision, actual trial, responsible writer and next action. No empty forms
are needed for stages the task did not use.

Share the appropriate task files with the code branch, keeping any sensitive
raw evidence outside the repository and recording that limitation. The receiver
pulls the branch, reads TASK.md and RESULT.md, then resumes with:

```text
node .agents/skills/reference-loop/loop.mjs resume <task-directory>
```

One person owns the next action; another can review the decision and code in the
PR. Revise the decision or return to research when new evidence or an actual
trial shows a problem. Stop when the needed result is sufficient. This is a
bounded loop driven by the current task, not an endless mandatory checklist.

## Readiness

This repository package is based on the existing local skill and helpers. The
packaging check exercised task creation, evidence import, discussion context,
search and resumption after relocation on Windows. That is helper portability
evidence, not a native Claude Code, macOS or complete project acceptance result.
Source access can change, and setup alone does not prove a connector works on a
teammate's device. The first real task should establish its own useful result.
