# Roulette

> *The Council of Future Selves — Bet on your future.*

## What It Is

A web app where you speak a life decision out loud. The app runs a Monte Carlo simulation on real data, then splits your future into 3 timelines. Each timeline is a version of you — speaking in your cloned voice — and they argue about your decision in an **Ace Attorney-style courtroom debate**. You can interrupt with "OBJECTION!" and they answer based on the simulated numbers.

Every life decision is a bet. Roulette uses Monte Carlo simulation — the technique named after the casino — to let your future selves argue the odds.

## The Experience (User Flow)

```
1. ONBOARD
   → Sign up (Supabase auth)
   → Record voice (30s script) → IVC clone → voice_id saved to profile
   → "What decision are you wrestling with?" (hold-to-talk)

2. SIMULATE
   → Claude extracts decision type + options + factors
   → Web search / data APIs pull real stats (salary, CoL, relationships, etc.)
   → Monte Carlo engine runs simulation (~3-5 seconds)
   → 3 timelines generated with probability distributions

3. DEBATE (The Main Event — ~60 seconds, extendable)
   → Ace Attorney courtroom appears
   → Three future selves (your cloned voice, 3 different deliveries):

   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  PROSECUTION │    │    JUDGE     │    │   DEFENSE    │
   │  (FOR change)│    │  (Mediator)  │    │(AGAINST chg) │
   │  Confident,  │    │  Calm,       │    │  Cautious,   │
   │  optimistic  │    │  authoritative│   │  empathetic  │
   └──────────────┘    └──────────────┘    └──────────────┘

   → Turn-based: Prosecution argues → Defense counters → Judge weighs in
   → User can press OBJECTION! button (hold-to-talk) to interject
   → Arguments cite real simulation data ("there's a 73% chance you'll...")
   → Ace Attorney effects: screen shake, interjection flashes, expression changes

4. VERDICT
   → Judge delivers ruling with gavel SFX
   → Shows probability split + key data points
   → "The court finds in favor of [Option A] with 62% confidence"
```

## The Three Selves

| Role | Archetype | Voice Config | Personality |
|---|---|---|---|
| **Prosecution** | Phoenix Wright | stability: 0.25, style: 0.55, speed: 1.08 | Argues FOR the change. Optimistic, cherry-picks upside data. Uses `[confident]`, `[excited]`, `[passionate]` |
| **Defense** | Miles Edgeworth | stability: 0.35, style: 0.40, speed: 0.93 | Argues AGAINST the change. Cautious, cites risk stats. Uses `[concerned]`, `[thoughtful]`, `[hesitant]` |
| **Judge** | The Judge | stability: 0.80, style: 0.15, speed: 0.97 | Mediates. Summarizes arguments, asks clarifying questions, delivers verdict. Uses `[calm]`, `[authoritative]`, `[measured]` |

All three use the **same voice clone** with different `voice_settings` per TTS request. No pitch shifting needed — the stability delta (0.25 vs 0.80) creates clearly distinct deliveries.

## Ace Attorney Mechanics (Adapted)

### Turn Structure
```
Round 1:
  Prosecution: Opening argument (15s) → cites data point
  Defense: Counter-argument (15s) → cites counter-data
  Judge: "Interesting. Does the defendant wish to respond?" (5s)
  [User OBJECTION window — 10s to press or skip]

Round 2:
  Repeat with deeper arguments, responding to user input if given

Round 3:
  Final statements → Judge delivers verdict
```

### User Interaction
- **OBJECTION! button** — hold-to-talk, interrupts current speaker
  - Screen flashes white, current TTS aborted via AbortController
  - User's question/challenge fed to Claude → relevant self responds
- **Limited objection tokens** (3 per debate) — waste them on bad challenges and the Judge deducts points: "That has nothing to do with the argument!"
- Press/skip if no objection → debate continues

### Ace Attorney Effects
| Effect | Implementation |
|---|---|
| "OBJECTION!" flash | White overlay + CSS shake + sound effect |
| "HOLD IT!" | Green flash, speaker pauses, elaborates |
| Character expressions | Sprite states: idle, talking, sweating, shocked, breakdown |
| Music shifts | Pursuit theme when scoring points, tension when losing |
| Gavel slam (verdict) | Triple slam SFX + screen shake |
| Text display | Character name + speech text scrolling at 33ms/char |

### Visual Style
- **Ace Attorney-inspired courtroom** with prosecution/defense desks + judge bench
- **Cutout-style avatars** of the user (generated or placeholder) with expression states
- Prosecution on left, Defense on right, Judge center-top
- Speech text box at bottom (AA-style) with character name
- Audio waveform or talking animation synced to TTS playback

## Data & Simulation Engine

### Decision Parsing (Claude)
User says: "Should I ask my flatmate out?"
Claude extracts:
```json
{
  "type": "relationship",
  "options": ["ask them out", "keep things as they are"],
  "factors": ["friendship_risk", "romantic_happiness", "living_situation", "social_circle"],
  "time_horizon_years": 5
}
```

### Data Sources (per decision type)
| Decision Type | Data Sources |
|---|---|
| Career/location | Numbeo API (CoL), BLS/ONS salary data, quality-of-life indices |
| Relationships | Marriage/divorce rates by age, cohabitation stats, loneliness studies |
| Education | Degree ROI data, salary premiums, completion rates |
| Business/startup | Startup survival rates, founder income distributions |
| Lifestyle | Expat happiness surveys, health impact data |

### Monte Carlo Simulation (Verified: 13.2ms for 5K iterations)
- Python (numpy) on FastAPI backend
- 5,000 iterations per timeline, 10-year projections — runs in **<15ms**
- Pre-embedded city data for 10 major cities (London, Sydney, NYC, Singapore, Berlin, Tokyo, SF, Toronto, Dubai, Amsterdam)
- Distribution choices:
  - Income: lognormal (right-skewed, always positive)
  - Happiness: beta (bounded 0-1)
  - Business survival: Bernoulli per year (77-81% yr1, 93-96% yr5+)
  - Investment returns: normal (mean 7%, std 15%)
  - Cost of living: lognormal with inflation uncertainty
- Output: per-timeline summary with median, P10, P90 confidence bands
- Each self gets a "brief" with the stats they should cite in their arguments

### Killer Stats for Debates (Real, Sourced)
- London is 29% more expensive than Sydney, but UK life expectancy is 1.8 years less than Australia
- Only 49.6% of businesses survive 5 years, but survivors have 93-96% annual survival
- Bachelor's degree = +59% earnings ($24,800/year more at median)
- Regular exercise adds 2-4 years to lifespan (30-35% mortality reduction)
- 44% of US marriages end in divorce, but first-5-year rates have halved since the 1990s

## Tech Stack

```
Frontend:     Next.js 14 + Tailwind + Framer Motion (AA animations)
Backend:      Python FastAPI (Monte Carlo + data scraping)
Voice:        ElevenLabs JS SDK (streaming TTS, IVC, Scribe STT)
LLM:          Claude (decision parsing, debate orchestration, argument generation)
Auth/DB:      Supabase (user profiles, voice_id storage)
SFX:          Pre-recorded CC0 (Freesound + OpenGameArt, see research/11)
Deploy:       Vercel (frontend) + Railway (Python backend)
Model:        eleven_v4_turbo (debate TTS), Flash v2.5 (dev/testing)
```

## ElevenLabs Features Used

| Feature | Usage |
|---|---|
| **Instant Voice Clone** | Clone user's voice during onboarding (30s recording) |
| **TTS + Audio Tags** | 3 distinct voice deliveries with `[confident]`, `[hesitant]`, `[calm]` etc. |
| **Streaming TTS** | Real-time debate — each turn streams as it's generated |
| **Scribe (STT)** | Transcribe user's decision input + OBJECTION! interjections |
| **Sound Effects** | Gavel slam, crowd murmur, objection sting (pre-recorded CC0, not generated) |
| **Voice Settings** | Per-request stability/style/speed to differentiate 3 selves |

**Total: 6 ElevenLabs features** — voice is the entire product. SFX are pre-recorded CC0 for reliability.

## Demo Scenario (4-5 min, science fair style, pre-prepared)

**Decision:** "Should I quit my 6-figure quant job in London to become a professional poker player?"

### Why this scenario:
- Perfectly targets the OxHack demographic (finance/CS students who've considered this)
- **Monte Carlo double meaning is the punchline** — the simulation technique IS named after the casino
- Wild data contrast: quant salary £150K+ vs poker income distribution (bimodal: most lose money, top 1% make millions)
- Business survival stats apply: only 10-15% of professional poker players are profitable long-term
- The Ace Attorney format makes it hilarious — Future Poker You is sweating about variance while Future Quant You is smugly citing compound interest
- Real tension: the EV calculation isn't obvious — top poker players DO outearn quants

### Key debate moments:
- Prosecution (Poker You): "[confident] In 5 years I'm making $400K tax-free, working 20 hours a week from Lisbon. Your Monte Carlo simulation — ironic name by the way — shows a 23% chance I'm a millionaire."
- Defense (Quant You): "[measured] And a 61% chance you're broke. The simulation also shows you've burned through your savings by month 18. Also, have you ever actually been to Monte Carlo? I have. For a maths conference."
- Judge: "[calm] Order. The prosecution will refrain from making lifestyle comparisons. Let's look at the risk-adjusted returns."
- User OBJECTION: "But what about the quality of life difference?"

### Demo flow:
1. (30s) Show onboarding — voice already pre-cloned, stored in profile
2. (30s) Speak the decision, show simulation loading with Monte Carlo visualization
3. (2min) Courtroom debate plays — 3 rounds, pre-prepared scenario
4. (30s) User presses OBJECTION! — interjects with a question
5. (30s) Judge delivers verdict with gavel + probability split display
6. (30s) Show the replay/comic export, explain the tech

### Pre-demo prep:
- Voice pre-cloned and stored in Supabase profile
- Simulation data pre-cached (quant salary data, poker income distributions)
- Pre-generated backup audio clips in case API is slow
- Portable speaker for audio quality
- Rehearse the OBJECTION! moment — time the button press

## Team Split (4 people, 25 hours)

| Person | Role | Owns |
|---|---|---|
| **A** | Simulation + Data | Monte Carlo engine, data scraping, FastAPI backend |
| **B** | Voice Pipeline | ElevenLabs integration, 3-voice configs, streaming TTS, STT |
| **C** | Frontend + UX | Next.js, Ace Attorney UI, animations, courtroom layout |
| **D** | Debate Orchestration | Claude prompts, turn-based logic, argument generation, demo script |

### Milestones
- **Hour 4:** Voice clone working + basic TTS with 3 configs. Monte Carlo returning results.
- **Hour 10:** End-to-end: speak decision → simulation → first debate turn plays.
- **Hour 16:** Full debate loop with OBJECTION! support. AA visual effects.
- **Hour 20:** FEATURE FREEZE. Demo prep only.
- **Hour 23:** Full rehearsal with portable speaker.

## Open Decisions (Team Should Discuss)

### Decided
1. **Data fetching:** Web search for relevant data per question (Claude tool_use with web search). Teammate to own. Flexible for any decision type.
2. **Verdict:** Always show probability split. "The court finds in favor of poker with 38% confidence. The odds are against you — but then again, you're a gambler."
3. **Session replay:** Shareable replay link (`/replay/[id]`) — log debate events as JSON + save TTS audio to Supabase Storage, replay through the same courtroom component. Comic strip OG image auto-generates when link is shared on Twitter/Discord. See `research/12-session-replay.md`.
4. **SFX:** 14 CC0/CC-BY royalty-free sounds sourced from Freesound + OpenGameArt. Full starter kit with URLs in `research/11-royalty-free-sfx.md`.

### Still Open
1. **Avatar generation:** AI-generated from user photo vs placeholder AA-style cutouts with expression states?
2. **Replay format:** Comic strip export (fastest), audio-only replay, or full video recording?
3. **Web search provider:** Claude built-in web search, Tavily API, or Perplexity API?
