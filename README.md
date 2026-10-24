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

1. Run `/spec` to turn your idea into a spec through an interview
2. Choose your tech stack and fill in CLAUDE.md
3. Each teammate checks out their own branch: `git checkout -b feature/[name]`
4. Start building

## What's included

```
.claude/
  settings.json        # Auto-approved commands, desktop notifications
  agents/
    reviewer.md        # Demo-focused code review (opus, read-only)
    explorer.md        # Fast codebase search (haiku, read-only)
    test-runner.md     # Build/test reporter (haiku, read-only)
    integrator.md      # Branch merging assistant (sonnet)
  skills/
    ship/SKILL.md      # /ship: build, test, commit, push
    spec/SKILL.md      # /spec: idea -> spec interview
CLAUDE.md              # Fill in at kickoff
HACKATHON.md           # Timeline, tactics, ElevenLabs reference
.env.example           # API keys template
```

## Commands

- `/spec` to write SPEC.md from an idea
- `/ship` to build, test, commit, push
- `/clear` between features (most important speed tactic)

Read `HACKATHON.md` for the full playbook.
