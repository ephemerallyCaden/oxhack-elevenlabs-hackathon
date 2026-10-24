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
- Run build/test after changes. Fix what you break.
- Commit after every working feature. Small commits, clear messages.
- If unsure, ask. Don't assume and build the wrong thing.
- No abstractions for one-time code. Inline is fine for 24 hours.
- Skip error handling except on the demo path.

## Team
Four developers working in parallel on feature branches.
- Merge to `main` only when your feature works and builds.
- Coordinate with teammates before touching shared files.
- Each person owns their branch. Don't edit others' branches.
