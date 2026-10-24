# Hackathon Template

Pre-configured Claude Code orchestration for a 4-person, 24-hour hackathon with ElevenLabs.

## Quick start

```bash
git clone [this-repo]
cd hackathon-template
cp .env.example .env
# Add your ELEVENLABS_API_KEY to .env
```

## First 30 minutes

1. Run `/spec` to turn your idea into a buildable spec
2. Choose your tech stack, fill in CLAUDE.md
3. Each teammate: `git checkout -b feature/[name]`
4. Start building

## What's included

```
.claude/
  settings.json            Auto-approved commands, desktop notifications
  agents/
    reviewer.md            Demo-focused code review (opus)
    explorer.md            Fast codebase search (haiku)
    test-runner.md         Build/test failure reporter (haiku)
    integrator.md          Branch merging assistant (sonnet)
  skills/
    spec/SKILL.md          /spec: idea -> SPEC.md via interview
    fix/SKILL.md           /fix: paste error, get fix
    verify/SKILL.md        /verify: build + types + lint + tests + diff review
    ship/SKILL.md          /ship: build, test, commit, push
    demo/SKILL.md          /demo: generate pitch script from codebase
CLAUDE.md                  Fill in at kickoff (with agent auto-routing rules)
HACKATHON.md               Timeline, tactics, ElevenLabs reference
```

## Workflow

```
/spec -> build features -> /fix when broken -> /verify before merge -> /ship -> /demo for the pitch
```

When a development problem needs outside evidence or reusable code, use
`/reference-loop <problem>` in Claude Code or `$reference-loop <problem>` in
Codex. It connects relevant sources and community replies to a bounded trial
and a saved decision, then returns to the feature or fix. See the
[team setup and usage guide](docs/reference-loop.md).

## Agent auto-routing

Claude uses agents proactively without being asked:
- After writing code: auto-runs `/verify`
- On build failure: auto-runs `/fix`
- Before commits: scans diff for debug code and secrets
- When exploring: uses the `explorer` agent

Read `HACKATHON.md` for the full playbook.
