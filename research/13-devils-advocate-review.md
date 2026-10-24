# Devil's Advocate Review — Critical Fixes Before Building

> Two independent reviewers tore apart DESIGN.md and all research files. These are the findings, ranked by severity.

---

## SEVERITY: WILL CRASH / DEMO-BREAKING

### 1. `client.messages.parse()` does not exist in the Anthropic SDK
**File:** `research/10-monte-carlo-simulation.md:540`
**Problem:** The NLP extraction code uses `client.messages.parse(output_format=DecisionParameters)`. This method does not exist. The code will crash on first call.
**Fix:** Use `messages.create()` with a tool definition for structured output, or use the `instructor` library.

### 2. Voice cloning API method contradicts between files
**File 07** uses `el.voices.addFromFile()`. **File 08** uses `el.voices.ivc.create()`. One or both are wrong for the current SDK version.
**Fix:** Check the actual `@elevenlabs/elevenlabs-js` types before writing any cloning code. Pick one, update both files.

### 3. `audio_effects`, `textToDialogue`, and `text_to_voice.remix()` may not exist
**File 08** presents these as real SDK methods with code blocks. They may be beta/internal/fictional.
**Fix:** Verify against actual SDK type definitions before counting on them as fallbacks. If they don't exist, delete the code blocks so nobody wastes time.

### 4. Fixed random seed in Monte Carlo (`default_rng(42)`)
**File:** `research/10-monte-carlo-simulation.md:209`
**Problem:** Every simulation run produces identical results. Your "Monte Carlo simulation" is a lookup table.
**Fix:** Remove the seed for production. Mark it `# DEV ONLY` in the research file.

---

## SEVERITY: WILL CAUSE MAJOR PROBLEMS

### 5. TTS latency between debate turns = dead air
**Problem:** 9+ sequential TTS requests, each with 2-4s gap. "60-second debate" becomes 90-120 seconds of loading.
**Fix:** Pre-generate ALL debate audio before the courtroom appears. Fire all TTS requests in parallel during a loading screen. Only OBJECTION is real-time.

### 6. Prosecution vs Defense voice gap too small (stability 0.25 vs 0.35)
**Problem:** A 0.10 stability delta at low values is nearly indistinguishable, especially on laptop speakers in a noisy venue. Low stability (0.25) on a thin 30-second clone also risks mumbling/artifacts.
**Fix:** Widen to Prosecution 0.25, Defense **0.55**, Judge 0.80. Also add stereo panning (left/right/center) as a cheap distinguishability win. Don't go below 0.30 stability on a clone with less than 2 minutes of source audio.

### 7. OBJECTION flow is an 8-step chain with no fallback
**Problem:** Abort TTS → stop audio → record user → STT → Claude → generate response → stream TTS → resume. Any step fails = demo breaks.
**Fix:** Hardcode the demo's OBJECTION text and response as a deterministic fallback. Use the live flow if it works in rehearsal; swap to the fallback if not.

### 8. No simulation function exists for the demo scenario
**Problem:** Code has location/career/business/education simulators. "Quit quant job to play poker" doesn't fit any of them.
**Fix:** Write the poker-vs-quant simulation FIRST. Make the demo scenario bulletproof. Generic engine is a stretch goal.

### 9. Person C (Frontend) is doing 3 people's work
**Problem:** One person owns courtroom layout, sprite states, camera panning, typewriter text, health bar, screen effects, animations, AND onboarding/verdict/replay pages.
**Fix:** Cut: session replay, camera panning, action lines, health bar. Use CSS transforms for expressions (shake=sweating, scale-bounce=shocked). Colored silhouettes instead of AI avatars. Static courtroom layout only.

---

## SEVERITY: WILL WASTE TIME IF NOT ADDRESSED

### 10. ElevenLabs pricing may be outdated
**Problem:** "$1 first month" promo may no longer exist. Plans and credit amounts change frequently.
**Fix:** Verify pricing on elevenlabs.io/pricing before buying. Do this before the hackathon.

### 11. Freesound requires login to download
**Problem:** The URLs in `research/11-royalty-free-sfx.md` are web pages, not direct download links. Text blip IDs 752746 and 752747 are assumed to exist but unverified.
**Fix:** Manually download all 14 SFX files BEFORE the hackathon. Verify all three blip variant IDs exist. Put the files in the repo.

### 12. OpenGameArt BGM tracks have names but no actual URLs
**Problem:** "Unsolved Investigation" and "First Light Particles" are titles, not links. Someone has to search for them.
**Fix:** Find and bookmark the actual download URLs before the hackathon.

### 13. Education simulation breakeven bug
**File:** `research/10-monte-carlo-simulation.md:395`
**Problem:** `np.argmax` on an all-False array returns 0, silently reporting "breakeven in year 0" for simulations that never break even.
**Fix:** Mask never-breakeven simulations before taking the median.

### 14. No CORS/networking plan for Next.js ↔ FastAPI
**Problem:** Two separate deploy targets (Vercel + Railway) with zero CORS or API auth configuration discussed.
**Fix:** Consider running Monte Carlo as a Next.js API route via Python subprocess (<100ms, doesn't need a persistent server). Or configure CORS + `NEXT_PUBLIC_API_URL` from Hour 0.

### 15. No error recovery for any API calls
**Problem:** Claude down? ElevenLabs slow? Supabase timeout? Zero fallback behavior specified.
**Fix:** Pre-cache the demo scenario end-to-end: debate scripts, TTS audio, simulation results. If any API takes >5s, swap in cached version.

### 16. Happiness simulation is hardcoded and arbitrary
**Problem:** Option A always gets `Beta(7,3)`, Option B always gets `Beta(6,4)`. The first option is ALWAYS happier regardless of what it actually is.
**Fix:** Either remove happiness from the simulation or acknowledge it as a placeholder that Claude fills based on context.

### 17. No discussion of how simulation results become debate arguments
**Problem:** Monte Carlo produces numbers. The courtroom needs narrative. How does "median wealth $340K, P25-P75 $210K-$480K" become a Prosecution speech? This glue layer is unspecified.
**Fix:** Add a Claude prompt that takes simulation JSON + decision context and generates per-character argument briefs with specific stats to cite.

### 18. Model ID inconsistency
**Problem:** File 08 recommends `eleven_v4_turbo`. File 10's code uses `eleven_v3` (which has no audio tag support).
**Fix:** Standardize on `eleven_v4_turbo` everywhere.

---

## SEVERITY: DESIGN IMPROVEMENTS

### 19. ElevenLabs feature count is inflated (claimed 6, actually 3)
**Real:** IVC, Streaming TTS, Scribe STT
**Padding:** Audio Tags (= text formatting in TTS), Voice Settings (= a parameter on TTS), Sound Effects (= Freesound, not ElevenLabs)
**Fix:** Be honest: "3 features deeply" is a stronger pitch than "6 features" that a judge can see through. Or actually generate some SFX via ElevenLabs API.

### 20. Debate is passive without more interaction
**Problem:** Only 3 OBJECTION tokens across 60 seconds. Otherwise user just listens.
**Fix:** Add "HOLD IT!" (elaborate) and "MOVE ON" (skip) buttons. Simple to implement, gives user agency.

### 21. Build the component event-driven from Day 1
**Problem:** If the courtroom component is built with ad-hoc state/useEffect chains, retrofitting for replay is a 3-4 hour refactor.
**Fix:** Define `DebateEvent` interface before writing any UI code. Both live and replay flows push events through the same queue. 1-2 hours upfront, saves 3-4 later.

### 22. Demo timeline is too tight
**Problem:** 4.5 minutes with zero loading time. Real demo = 5-5.5 minutes.
**Fix:** Cut the "show replay/comic export" segment. End on the verdict — triple gavel slam + probability split is a stronger ending anyway.

---

## Pre-Hackathon Checklist (Do BEFORE You Start Building)

- [ ] Verify ElevenLabs pricing and plan features at elevenlabs.io/pricing
- [ ] Verify current SDK method for voice cloning (check @elevenlabs/elevenlabs-js types)
- [ ] Verify `audio_effects` and `text_to_dialogue` exist in the SDK
- [ ] Verify ElevenLabs model ID `eleven_v4_turbo` is correct
- [ ] Clone presenter's voice in a quiet room, test all 3 stability configs
- [ ] Download all 14 SFX files from Freesound (requires account login)
- [ ] Find and download 3 BGM tracks from OpenGameArt with actual URLs
- [ ] Verify Freesound IDs 752746 and 752747 exist
- [ ] Put all audio assets in the repo
- [ ] Write the poker-vs-quant simulation function
- [ ] Pre-generate a complete demo debate (Claude scripts + TTS audio) as fallback
