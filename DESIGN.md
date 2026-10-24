# Roulette

> *The Council of Future Selves — Bet on your future.*

## What It Is

A web app where you speak a life decision out loud. The app runs a Monte Carlo simulation on real data, then splits your future into 3 timelines. Each timeline is a version of you — speaking in your cloned voice — and they argue about your decision in an **Ace Attorney-style courtroom debate**. You can interrupt them mid-argument, and they answer based on the simulated numbers.

Every life decision is a bet. Roulette uses Monte Carlo simulation — the technique named after the casino — to let your future selves argue the odds.

## Key Terminology

| Concept | Code/Backend | Visual/Frontend |
|---|---|---|
| User breaks into the debate | `interrupt` | "OBJECTION!", "HOLD IT!", "WAIT!" (randomized flavor text) |
| AI self breaks into another's turn | `interrupt` (type: `ai_interject`) | "STOP RIGHT THERE!", "OBJECTION!", "NOT SO FAST!" |
| User asks current speaker to elaborate | `interrupt` (type: `elaborate`) | "HOLD IT!" |
| User skips current speaker | `interrupt` (type: `skip`) | "MOVE ON!" |

The mechanic is always `interrupt`. The presentation varies. This avoids confusion when the AI selves also shout "OBJECTION!" as flavor text during their arguments.

## The Experience (User Flow)

```
1. ONBOARD (voice clone + profile in one step)
   → Sign up (Supabase auth)
   → "Read this script aloud" — the script IS the onboarding questions:

     "My name is [say your name]. I'm [your age] years old
      and I live in [your city]. I work as a [your job] and
      I'd say I'm the kind of person who [values freedom /
      plays it safe / chases the big win / follows their gut].
      If I had to describe my life philosophy in one sentence,
      it would be..."

   → This gives us:
     • 90+ seconds of varied speech → high quality IVC clone
     • Structured data via Scribe STT → Claude extracts name, age, city, job, personality
     • Unscripted final sentence → most natural speech sample for clone
     • Personality signal → shapes debate tone (risk-tolerant = bolder Prosecution)
   → "Now take a selfie" — webcam capture of user's face
     • Face cutout used as base for all 3 courtroom avatars
     • Edited into AA-style poses per character:
       - Prosecution: confident pointing pose, red tint
       - Defense: arms crossed skeptical pose, blue tint
       - Judge: stern/thoughtful pose, gold tint
     • Expression states via CSS transforms on the base image
       (shake=sweating, scale-bounce=shocked, desaturate=breakdown)
   → voice_id + user profile + avatar saved to Supabase
   → "What decision are you wrestling with?" (hold-to-talk)

2. SIMULATE
   → Claude extracts decision type + options + factors
   → Web search pulls real stats (salary, CoL, relationships, etc.)
   → Monte Carlo engine runs simulation (~3-5 seconds)
   → 3 timelines generated with probability distributions

3. PRE-GENERATE DEBATE (loading screen with Monte Carlo visualization)
   → Claude generates full 3-round debate script in one call
   → All TTS audio fired in parallel (9+ clips)
   → Debate is a choreographed playback, NOT sequential API calls
   → Total generation: ~8-15 seconds (hidden behind loading animation)

4. DEBATE (The Main Event — ~60 seconds, extendable)
   → Ace Attorney courtroom appears
   → Three future selves (your cloned voice, 3 different deliveries):

   ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
   │  PROSECUTION │    │    JUDGE     │    │   DEFENSE    │
   │  (FOR change)│    │  (Mediator)  │    │(AGAINST chg) │
   │  Confident,  │    │  Calm,       │    │  Cautious,   │
   │  optimistic  │    │  authoritative│   │  empathetic  │
   └──────────────┘    └──────────────┘    └──────────────┘

   → Turn-based: pre-generated audio plays in sequence
   → User has 3 buttons: INTERRUPT (hold-to-talk), HOLD IT (elaborate), MOVE ON (skip)
   → AI selves also interrupt each other ("STOP RIGHT THERE!" / "OBJECTION!")
   → Arguments cite real simulation data ("there's a 73% chance you'll...")
   → Ace Attorney effects: screen shake, interjection flashes, expression changes

5. VERDICT
   → Judge delivers ruling with gavel SFX
   → Always shows probability split + key data points
   → "The court finds in favor of [Option A] with 62% confidence"
```

## The Three Selves

| Role | Archetype | Voice Config | Personality |
|---|---|---|---|
| **Prosecution** | Phoenix Wright | stability: 0.25, similarity: 0.75, style: 0.55, speed: 1.10, speaker_boost: false | Argues FOR the change. Optimistic, cherry-picks upside. Uses `[confident]`, `[excited]`, `[passionate]`. Panned LEFT. |
| **Defense** | Miles Edgeworth | stability: **0.55**, similarity: 0.75, style: 0.40, speed: 0.88, speaker_boost: true | Argues AGAINST the change. Cautious, cites risk. Uses `[concerned]`, `[thoughtful]`, `[hesitant]`. Panned RIGHT. |
| **Judge** | The Judge | stability: 0.80, similarity: 0.80, style: 0.15, speed: 0.97, speaker_boost: true | Mediates. Summarizes, asks clarifying questions, delivers verdict. Uses `[calm]`, `[authoritative]`, `[measured]`. Panned CENTER. |

All three use the **same voice clone** with different `voice_settings` per TTS request.

**Differentiation strategy (layered):**
1. **Stability delta of 0.55** between Prosecution (0.25) and Judge (0.80) — clearly distinct
2. **Stability delta of 0.30** between Prosecution (0.25) and Defense (0.55) — noticeable
3. **Speed delta**: Prosecution speaks faster (1.10) than Defense (0.88) — 25% difference
4. **Stereo panning**: Prosecution LEFT, Defense RIGHT, Judge CENTER — spatial separation
5. **Audio tags**: Different emotional registers per character

**Important:** Do NOT set stability below 0.30 on a clone with less than 2 minutes of source audio — risks mumbling/artifacts. Record at least 90 seconds during onboarding for best results.

**Test the 3 configs with the real cloned voice in the first 4 hours.** If they're not distinct enough, use Voice Remix as a fallback.

## Interrupt System (Ace Attorney Mechanics)

### Turn Structure
```
Round 1:
  Prosecution: Opening argument (15s) → cites data point
  Defense: Counter-argument (15s) → cites counter-data
  Judge: "Interesting. Does the court wish to weigh in?" (5s)
  [User interrupt window — 10s to press or skip]

Round 2:
  AI selves may interrupt each other ("STOP RIGHT THERE!")
  Deeper arguments, responding to user input if given

Round 3:
  Final statements → Judge delivers verdict
```

### User Controls (3 buttons)

| Button | Backend type | Visual | Effect |
|---|---|---|---|
| **INTERRUPT** (hold-to-talk) | `interrupt.user_challenge` | "OBJECTION!" flash + screen shake | Aborts current audio. User speaks. Claude generates response. Only real-time TTS in the flow. |
| **HOLD IT** (tap) | `interrupt.elaborate` | "HOLD IT!" green flash | Current speaker elaborates on their last point. Pre-generated if possible. |
| **MOVE ON** (tap) | `interrupt.skip` | Gavel tap | Skips to next speaker. |

**Limited interrupt tokens:** 3 per debate. Wasting them on bad challenges → Judge: "That has nothing to do with the argument!"

### AI-to-AI Interrupts
The debate script from Claude can include `interrupt` events where one self cuts in on another:
```json
{ "type": "interrupt", "from": "defense", "flavor": "STOP RIGHT THERE!", "text": "The prosecution is ignoring the 61% failure rate..." }
```
These play the same flash/shake effects but are pre-generated (no latency).

### Interrupt Fallback (Demo Safety)
For the demo, pre-script the user's interrupt text and the AI response as a deterministic fallback:
- **If live flow works** in rehearsal → use it
- **If not** → hardcode "But what about quality of life?" + pre-generated response
- **Audience can't tell the difference**

### Ace Attorney Effects
| Effect | Implementation |
|---|---|
| Interrupt flash | White overlay + CSS shake + SFX sting (all interrupt types) |
| AI interject | Character-specific color flash (red/blue) + flavor text splash |
| Character expressions | CSS transforms: normal=still, sweating=shake anim, shocked=scale bounce, breakdown=tilt+desaturate |
| Music shifts | Pursuit theme when scoring points, tension when losing |
| Gavel slam (verdict) | Triple slam SFX + screen shake |
| Text display | Character name + speech text scrolling at 33ms/char with blip SFX |

### Visual Style
- **Static courtroom layout** — prosecution/defense desks + judge bench (no camera panning)
- **User's selfie cutout** edited into AA-style poses per character
  - Prosecution: confident/pointing, red tint, left side
  - Defense: arms crossed/skeptical, blue tint, right side
  - Judge: stern/thoughtful, gold tint, center-top
  - Expression states via CSS transforms on the base image
- Speech text box at bottom (AA-style) with character name
- Audio waveform or talking animation synced to TTS playback

## Data & Simulation Engine

### Decision Parsing (Claude)
User says: "Should I quit my quant job to become a poker player?"
Claude extracts via `messages.create()` with tool use (NOT `messages.parse()` — that doesn't exist):
```json
{
  "type": "career_gambling",
  "options": ["become a poker player", "stay in quant"],
  "factors": ["income_volatility", "lifestyle", "savings_runway", "career_growth"],
  "time_horizon_years": 5
}
```

### Data Fetching
Web search via Claude tool_use for relevant stats per question. Teammate to own. Falls back to pre-embedded lookup tables for common categories (10 major cities, salary data, relationship stats).

### Monte Carlo Simulation (Verified: 13.2ms for 5K iterations)
- Python (numpy) — can run as Next.js API route via subprocess (eliminates separate backend + CORS)
- 5,000 iterations per timeline — runs in **<15ms**
- **Demo scenario (poker vs quant) written FIRST** — custom simulation function, not generic
- Pre-embedded city data for 10 major cities as fallback
- Distribution choices:
  - Income: lognormal (right-skewed, always positive)
  - Happiness: beta (bounded 0-1) — **parameters set by Claude from context, not hardcoded**
  - Business/poker survival: Bernoulli per year
  - Investment returns: normal (mean 7%, std 15%)
  - Cost of living: lognormal with inflation uncertainty
- **No fixed random seed in production** (remove `default_rng(42)` — dev only)
- Output: per-timeline summary with median, P10, P90 confidence bands

### Simulation → Debate Arguments (Glue Layer)
Claude prompt takes simulation JSON + decision context and generates per-character argument briefs:
```
Given this simulation output:
- Poker: median income £45K, P10 -£30K, P90 £280K, survival rate 39% at 5 years
- Quant: median income £185K, P10 £140K, P90 £260K, growth rate 8%/yr

Generate argument briefs for:
- Prosecution (FOR poker): 3 key stats to cite, emotional angle, one killer line
- Defense (AGAINST poker): 3 key stats to cite, risk angle, one killer line
- Judge: 2 questions to ask, the fairest summary of both sides
```

### Killer Stats for Debates (Real, Sourced)
- London is 29% more expensive than Sydney, but UK life expectancy is 1.8 years less than Australia
- Only 49.6% of businesses survive 5 years, but survivors have 93-96% annual survival
- Bachelor's degree = +59% earnings ($24,800/year more at median)
- Regular exercise adds 2-4 years to lifespan (30-35% mortality reduction)
- 44% of US marriages end in divorce, but first-5-year rates have halved since the 1990s

## Tech Stack

```
Frontend:     Next.js 14 + Tailwind + Framer Motion (AA animations)
Backend:      Next.js API routes (Monte Carlo via Python subprocess — no separate server)
Voice:        ElevenLabs JS SDK (TTS, IVC, Scribe STT) via signed token endpoint
LLM:          Claude (decision parsing, debate generation, argument briefs)
Auth/DB:      Supabase (user profiles, voice_id storage, debate replays)
SFX:          Pre-recorded CC0 (Freesound + OpenGameArt, see research/11)
Deploy:       Vercel
Model:        eleven_v4_turbo (debate TTS), Flash v2.5 (dev/testing)
```

**Architecture note:** ElevenLabs called from browser via signed token endpoint (Next.js API route generates short-lived token → client uses JS SDK directly). No audio proxying through server.

**Error recovery:** Every external API call has a pre-cached fallback for the demo scenario. Claude scripts, TTS audio, simulation results — all pre-generated. If any API takes >5s, swap in cached version.

## ElevenLabs Features Used

| Feature | Usage |
|---|---|
| **Instant Voice Clone** | Clone user's voice during onboarding (30s+ recording) |
| **Streaming TTS + Audio Tags** | 3 distinct voice deliveries with `[confident]`, `[hesitant]`, `[calm]` etc. Per-request voice_settings for stability/style/speed differentiation |
| **Scribe (STT)** | Transcribe user's decision input + interrupt interjections |

**Honest count: 3 ElevenLabs features used deeply.** They form the entire backbone of the experience. SFX are pre-recorded CC0 for demo reliability.

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
- Defense interrupts Prosecution: **"STOP RIGHT THERE!** You're quoting the P90. The median poker player makes £12K. That's less than minimum wage."
- Judge: "[calm] Order. The prosecution will refrain from making lifestyle comparisons. Let's look at the risk-adjusted returns."
- User INTERRUPT: "But what about the quality of life difference?"

### Demo flow:
1. (30s) Show onboarding — voice already pre-cloned, stored in profile
2. (30s) Speak the decision, show simulation loading with Monte Carlo visualization
3. (2min) Courtroom debate plays — 3 rounds, pre-generated audio sequence
4. (30s) User presses INTERRUPT — interjects with a question (live or fallback)
5. (30s) Judge delivers verdict with gavel + probability split display

### Pre-demo prep:
- [ ] Voice pre-cloned in quiet room, 90s+ recording, stored in Supabase
- [ ] All 3 voice configs tested and confirmed distinct
- [ ] Poker vs quant simulation function written and tested
- [ ] Full demo debate pre-generated as fallback (Claude scripts + TTS audio)
- [ ] Simulation data pre-cached (quant salary data, poker income distributions)
- [ ] All SFX + BGM files downloaded and in repo
- [ ] Portable speaker for audio quality
- [ ] Interrupt moment rehearsed and timed
- [ ] Backup library voice_id set in env var in case clone is unusable

## Team Split (4 people, 25 hours)

| Person | Role | Owns |
|---|---|---|
| **A** | Simulation + Data | Poker-vs-quant sim (first!), generic sim engine, web search integration |
| **B** | Voice Pipeline | ElevenLabs token endpoint, 3-voice configs, TTS parallel generation, STT, onboarding recording UI |
| **C** | Frontend + UX | Static courtroom layout, text typewriter, interrupt flash/shake, colored silhouettes, CSS expressions |
| **D** | Debate Orchestration | Claude prompts (decision parsing, debate generation, argument briefs, interrupt responses), event-driven state machine, demo script |

### Milestones (tightened)
- **Hour 4:** Voice clone working + 3 configs tested and distinct. Poker sim returning results. Courtroom static layout rendered.
- **Hour 8:** End-to-end: speak decision → simulation → first debate turn plays with audio. **If this isn't working by Hour 8, start cutting scope.**
- **Hour 14:** Full debate loop with INTERRUPT support. Typewriter text + flash effects.
- **Hour 18:** FEATURE FREEZE. Only bug fixes, demo prep, pre-caching.
- **Hour 22:** Full rehearsal with portable speaker. Time the demo.

### Scope Cut List (if behind schedule)
Cut in this order:
1. Session replay / comic export (cut first)
2. HOLD IT / MOVE ON buttons (keep only INTERRUPT)
3. AI-to-AI interrupts (make debate purely turn-based)
4. Onboarding recording UI (use pre-cloned voice only)
5. Live interrupt (use hardcoded fallback)
6. Web search for data (use pre-embedded data only)

## Event-Driven Architecture

Build the courtroom component event-driven from Day 1. Both live debate and replay push events through the same queue.

```typescript
// The universal event type — ALL courtroom state flows through this
interface DebateEvent {
  id: string;
  timestamp: number;
  type: 'speech' | 'interrupt' | 'effect' | 'music_change' | 'expression_change' | 'verdict';
  speaker?: 'prosecution' | 'defense' | 'judge' | 'user';
  text?: string;
  audioUrl?: string;
  interrupt_type?: 'user_challenge' | 'elaborate' | 'skip' | 'ai_interject';
  interrupt_flavor?: string;  // "OBJECTION!", "STOP RIGHT THERE!", "HOLD IT!", etc.
  effect?: 'flash_white' | 'flash_red' | 'flash_blue' | 'shake' | 'gavel';
  expression?: 'idle' | 'talking' | 'sweating' | 'shocked' | 'confident' | 'breakdown';
}

// Live debate: events pushed by orchestrator
// Replay: events loaded from Supabase and played back
// Same courtroom component renders both
```

## Decided

1. **Data fetching:** Web search per question via Claude tool_use. Pre-embedded tables as fallback.
2. **Verdict:** Always shows probability split.
3. **Session replay:** Event log JSON + audio in Supabase Storage. Replay via same component. Stretch goal.
4. **SFX:** Pre-recorded CC0 from Freesound + OpenGameArt. Downloaded before hackathon.
5. **Avatars:** User's selfie captured during onboarding, cutout into AA-style poses per character. CSS transforms for expression states.
6. **Backend:** Next.js API routes only. Monte Carlo via Python subprocess. No separate FastAPI server.
7. **Interrupt naming:** Backend always uses `interrupt`. Frontend varies flavor text per context.

## Pre-Hackathon Checklist

- [ ] Verify ElevenLabs pricing at elevenlabs.io/pricing
- [ ] Verify SDK method for voice cloning (check `@elevenlabs/elevenlabs-js` types)
- [ ] Verify model ID `eleven_v4_turbo` is current
- [ ] Clone presenter's voice in quiet room (90s+ recording)
- [ ] Test all 3 voice configs with the real clone — confirm distinct
- [ ] Download all 14 SFX files from Freesound (requires free account login)
- [ ] Verify Freesound IDs 752746 and 752747 exist
- [ ] Find and download 3 BGM tracks from OpenGameArt with actual URLs
- [ ] Put all audio assets in the repo
- [ ] Write poker-vs-quant simulation function
- [ ] Pre-generate complete demo debate as fallback (Claude scripts + TTS audio)
- [ ] Set up Supabase project with auth + user profiles table
