# Ace Attorney Mechanics Research for Voice-Based Debate App

> Research compiled for hackathon: 3 AI versions of yourself argue about a life decision in Ace Attorney courtroom style.

---

## 1. Core Gameplay Mechanics

### The Trial Flow

Ace Attorney trials alternate between two phases:

1. **Investigation Phase** - gather evidence, talk to witnesses, examine crime scenes
2. **Courtroom Trial Phase** - cross-examine witnesses, present evidence, secure verdict

For our app, we skip investigation entirely. The "evidence" is the user's life context (their stated pros, cons, past experiences, values). The entire experience is the courtroom phase.

### Cross-Examination: The Core Loop

This is the mechanic that makes Ace Attorney work. Here is exactly how it flows:

1. **Witness gives testimony** - a series of 3-7 individual statements, displayed one at a time
2. **Player enters cross-examination mode** - they can navigate forward/backward through the statements
3. **For each statement, the player can:**
   - **PRESS** (triggered by "Hold It!") - ask the witness to elaborate. Sometimes reveals new information, sometimes the witness doubles down. Pressing is always safe (no penalty). New statements can be added to the testimony after pressing.
   - **PRESENT EVIDENCE** (triggered by "Take That!") - show a piece of evidence from the Court Record that contradicts the current statement. If correct, triggers a breakthrough. If wrong, triggers a penalty.
4. **When a contradiction is found** - the music shifts, the witness reacts, and a new line of questioning opens up
5. **Cycle repeats** - the witness revises their testimony or a new witness is called

**Key design insight:** The player always has a SAFE action (pressing) and a RISKY action (presenting evidence). This creates a natural tension ramp - you press to gather info, then present when you are confident.

### The Interjection System

Three interjections, each with a distinct purpose:

| Interjection | Who uses it | When | Visual |
|---|---|---|---|
| **"OBJECTION!"** | Defense attorney (Phoenix) | When presenting contradicting evidence or making a critical argument | Red speech bubble, dramatic zoom, character points forward |
| **"HOLD IT!"** | Defense attorney | When pressing a witness for more details | Green speech bubble, character leans forward with palm out |
| **"TAKE THAT!"** | Defense attorney | When presenting a specific piece of evidence | Blue speech bubble, character thrusts evidence forward |

**What makes them satisfying:**
- They INTERRUPT the current flow - the screen freezes, music cuts, and the interjection graphic fills the screen
- They are accompanied by a voice clip (originally recorded by the dev team themselves, not professional actors)
- They signal a shift in power dynamics - the defense is taking control of the narrative
- The brief pause before the argument lands creates anticipation
- Prosecutors also use "Objection!" to counter, creating back-and-forth volleys

### The Penalty System

- Player starts with 5 exclamation marks (later games use a health bar)
- Presenting WRONG evidence costs 1 mark (sometimes more for egregious mistakes)
- Pressing witnesses is ALWAYS FREE - no penalty
- Losing all marks = guilty verdict = game over (restart from last save)
- The judge verbally warns you when penalties are given: "That has nothing to do with the testimony!"
- Visual: marks flash and disappear, a sound effect plays

**Design insight for our app:** The penalty system creates stakes. Without it, players would just spam evidence. The adaptation for voice debate: the user gets limited "objection" tokens. Waste them on bad challenges and the judge rules against you.

### The Court Record (Evidence System)

- A sidebar/menu containing all collected evidence and character profiles
- Each piece of evidence has: a name, an image, and a description
- Players must SELECT the right evidence and PRESENT it against the right statement
- The satisfaction comes from connecting two pieces of information yourself

### The Judge's Role

- The judge is comedic, easily confused, but ultimately fair
- He sustains or overrules objections
- He gives penalties when the defense is wrong
- He calls for order when the gallery gets rowdy ("Order! Order!")
- He delivers the final verdict
- He serves as a PACING mechanism - he can slow down the action, summarize for the audience, or push things forward
- His reactions telegraph whether you are winning or losing

---

## 2. Visual Style Elements

### Character Sprites and Animation States

From the objection_engine source code, characters have these animation states:

- **`{character}-{emotion}-idle.gif`** - neutral stance, slight breathing animation
- **`{character}-{emotion}-talk.gif`** - mouth moves, gestures while speaking
- **`{character}-deskslam.gif`** - slams hands on desk (frustration/emphasis)

**Key emotions/expressions (per character):**
- Normal (default)
- Confident (smirking, arms crossed)
- Sweating (nervous, things going badly)
- Shocked (wide eyes, stepped back)
- Angry (teeth gritted, veins popping)
- Pointing (the iconic forward point, used with Objection)
- Breakdown (unique per character - the dramatic collapse when caught lying)

**Character sprite dimensions:** 256x192 pixels in the original games.

### Courtroom Layout

The courtroom has a fixed spatial layout with parallax camera panning:

```
+--------------------------------------------------+
|                    JUDGE                          |
|              (center, elevated)                   |
|                                                   |
|   DEFENSE            WITNESS         PROSECUTION  |
|   (left bench)     (center stand)   (right bench) |
|                                                   |
|              [GALLERY / AUDIENCE]                  |
+--------------------------------------------------+
```

**Camera positions (from objection_engine):**
- Left bench (defense): X=0
- Witness stand (center): X=411 (with parallax offset)
- Right bench (prosecution): X=758
- Judge chamber: separate Y position (Y=256)
- Total foreground width: 1296 pixels

**Camera movement:**
- PAN: 0.5-second smooth transition between positions (using lookup-table easing with 16 interpolation points)
- CUT: Instantaneous jump (used for dramatic effect)
- Pan probability follows a sigmoid function - more likely to pan when characters are nearby, more likely to cut for dramatic reveals

### Screen Effects

- **Flash:** White overlay (255,255,255) with configurable duration. Used for dramatic reveals and "Objection!" moments
- **Screen Shake:** Random angle offsets using `cos(angle)*magnitude, sin(angle)*magnitude` applied to both world and textbox layers independently. Used when evidence lands, witnesses break down, or gavel slams
- **Action Lines:** Animated scrolling background at 16px/frame. Scrolls LEFT for defense moments (Phoenix), RIGHT for prosecution moments (Edgeworth). Creates that dramatic "everything is moving" effect during key arguments
- **Dramatic Zoom:** Camera pushes in on the character making the argument

### Text Box System

- **Max line width:** 220 pixels
- **Max lines per page:** 3 (new page auto-triggered after)
- **Font sizes:** 16px dialogue, 12px nametag
- **Character name box:** Left-aligned segmented image with character name
- **Text scroll speed:** 1/30 second per character (default)
- **Punctuation pause:** 0.3-second halt on periods, commas, etc.
- **Between sentences:** blips stop, sprite returns to idle for 0.6 seconds
- **RTL language support:** mirrored arrow positioning

### UI Elements to Recreate

1. **Text box** with character name label (bottom of screen)
2. **Court Record button** (evidence sidebar)
3. **Health/penalty bar** (top of screen)
4. **"Press" and "Present" buttons** during cross-examination
5. **Interjection splash screen** ("OBJECTION!" fills the screen)
6. **Witness testimony indicator** (which statement number you're on)

---

## 3. Sound Design

### The Iconic Audio Elements

**Voice clips:**
- "Objection!" - shouted by defense and prosecution. Originally recorded by the dev team (director Shu Takumi voiced Phoenix, composer Sugimori voiced von Karma, Iwamoto voiced Edgeworth)
- "Hold It!" - softer, more inquisitive tone
- "Take That!" - sharp, accusatory tone

**Music system (from objection_engine):**
- Two mood states: `relaxed` and `tense`
- Music loads from `{music_code}/relaxed` and `{music_code}/tense` folders
- Tracks loop with `loop_until_truncated`
- Track selection is randomized within the mood category

**Key music themes and when they play:**

| Theme | Mood | When it plays |
|---|---|---|
| **Cross-Examination ~ Moderate** | Neutral | Default during testimony/cross-examination |
| **Cross-Examination ~ Allegro** | Tense | When testimony gets heated, contradictions emerging |
| **Pursuit ~ Cornered** | Triumphant/Intense | THE iconic theme. Plays when you've caught the witness in a lie and are pressing your advantage. This is the "I'm winning" music. Most recognizable track in the series |
| **Objection!** | Determined | Phoenix Wright's personal theme. Plays during key arguments by the defense |
| **Suspense** | Dread | When things are going badly for the defense |
| **Courtroom Lounge** | Calm | Before proceedings, during recesses |
| **Announce the Truth** | Revelatory | When a major truth is being unveiled |
| **Won the Case** | Victory | After a not-guilty verdict |
| **Guilty Love** (prosecution theme) | Antagonistic | When the prosecutor is making strong arguments |

**Sound effects:**
- `sfx-evidenceshoop.wav` - evidence presentation whoosh
- `sfx-pichoop.wav` - page advance / minor UI interaction
- `sfx-blipfemale.wav` / `sfx-blipmale.wav` - text scroll sound (gendered), 0.06s loop delay
- Gavel slam - judge's gavel, used for order and verdicts
- Crowd murmur - gallery reacting to revelations
- Desk slam audio - with timing offset (Phoenix at +0.15s, Edgeworth at +0.25s)

**The composer's philosophy:** Masakazu Sugimori designed the Objection theme to deliver "the strongest, 'Aren't I the coolest?' impression" despite its brevity. He drew from jazz fusion, classical, J-pop, 80s pop, and rock, aiming for "music that had the chords of fusion music, but the rhythm of techno music."

---

## 4. Adaptation for 3-Character Voice Debate

### Character Mapping

| Ace Attorney Role | Our App Role | Personality | Voice Direction (ElevenLabs) |
|---|---|---|---|
| Prosecutor (Edgeworth) | **Future Self A** - argues FOR the decision | Confident, data-driven, assertive. "This is clearly the right choice." | Deeper voice, measured pace, slightly dramatic |
| Defense Attorney (Phoenix) | **Future Self B** - argues AGAINST the decision | Passionate, empathetic, worried. "But have you considered..." | Warmer voice, more emotional range, occasional urgency |
| Judge | **Future Self C** - mediates and decides | Calm, thoughtful, occasionally confused. Summarizes both sides. | Authoritative but gentle, slower pace |
| Player (Phoenix in original) | **The User** - can interject | Real person, their actual voice via hold-to-talk | N/A - actual user voice |

### Turn-Based Flow with Voice AI

**Phase 1: Opening Statements (60 seconds)**
```
Judge: "Court is now in session for the trial of [USER'S DECISION]."
Judge: "The prosecution may make their opening statement."
Prosecution (Future A): [30-second argument FOR the decision]
Judge: "The defense may respond."
Defense (Future B): [30-second argument AGAINST the decision]
```

**Phase 2: Testimony & Cross-Examination (the core loop)**
```
1. Prosecution presents testimony (3-5 statements about why the decision is good)
   - Each statement displayed individually with text + voice

2. Defense cross-examines:
   - Can PRESS any statement (asks for elaboration - always safe)
   - Can PRESENT EVIDENCE (challenge with a pointed question - risky)

3. User can INTERJECT at any time:
   - Hold-to-talk button activates "OBJECTION!" mode
   - User speaks their challenge
   - Judge evaluates: sustain (point for user) or overrule (penalty)

4. Roles swap: Defense presents testimony, Prosecution cross-examines

5. After 2-3 rounds, Judge deliberates and delivers verdict
```

**Phase 3: Verdict**
```
Judge: Summarizes key points from both sides
Judge: Delivers verdict with reasoning
All three futures: Final brief statement to the user
```

### User Interaction Points

1. **"OBJECTION!" button** (hold-to-talk)
   - Available at any time during testimony
   - User gets 3-5 objection tokens (the penalty system)
   - Good objections earn points, bad ones cost tokens
   - AI Judge evaluates whether the objection is valid

2. **"Present Evidence" prompts**
   - At key moments, the app asks: "Do you want to challenge this point?"
   - User can speak their challenge or tap to skip
   - This is equivalent to the "present evidence" mechanic

3. **Quick reactions** (tap, no voice needed)
   - "HOLD IT!" - ask the current speaker to elaborate
   - "I AGREE" - signal agreement with a point
   - "MOVE ON" - skip to next statement

### Handling Voice AI Timing

**The critical challenge:** Ace Attorney's pacing relies on precise timing. Voice AI introduces latency.

**Solutions:**
1. **Pre-generate AI responses** - when Prosecution is speaking, Defense response is already generating in background
2. **Use ElevenLabs streaming** - start playing audio as it generates, reducing perceived latency
3. **Fill gaps with animations** - desk slams, camera pans, judge reactions, and crowd murmurs buy 1-2 seconds naturally
4. **Typewriter text display** - show text character-by-character (1/30s per char) while voice plays, matching Ace Attorney style
5. **Dramatic pauses are FEATURES** - the original game has dramatic pauses. Use AI latency as intentional dramatic timing

### When to Trigger Each Dramatic Element

| Trigger | Visual Effect | Sound Effect |
|---|---|---|
| User says "OBJECTION!" | Screen flash, zoom to user avatar, "OBJECTION!" text | Objection voice clip + slam sound |
| AI catches a contradiction | Screen shake, action lines on speaker | Pursuit ~ Cornered music starts |
| Penalty (bad objection) | Health bar decreases, judge looks stern | Penalty buzzer, gavel slam |
| Good objection sustained | Flash, zoom to judge | Gavel slam, crowd murmur |
| Key argument lands | Action lines, desk slam animation | Desk slam sfx, music intensifies |
| Witness/speaker breakdown | Character sprite changes to "sweating"/"shocked" | Suspense music |
| Verdict delivered | Full-screen flash, gavel animation | Triple gavel slam, verdict music |

---

## 5. What Makes Ace Attorney Viral / Meme-Worthy

### The Objection Meme
- The "Objection!" pose (pointing forward with speech bubble) is one of gaming's most recognizable memes
- Visual clarity: the pose, text, and sound are all immediately identifiable even out of context
- The format is endlessly remixable - anyone can be "objecting" to anything
- The bold graphic design (large text, stark colors) reads well even as a tiny thumbnail

### Dramatic Reveals / Breakdown Animations
- When a witness is caught in a lie, they have unique breakdown animations:
  - Sweating profusely
  - Hair literally falling apart
  - Mask cracking
  - Full-body convulsions
  - Some breakdowns are absurdly over-the-top (a character's entire wig flies off)
- These are DEEPLY satisfying because the player EARNED the breakdown through deduction
- The escalation from "confident witness" to "sweating" to "full breakdown" is visually dramatic

### The Music Shift
- The transition from tense cross-examination music to "Pursuit ~ Cornered" (the "I'm winning" theme) is one of gaming's greatest dopamine hits
- It signals to the player: "You found it. Now press your advantage."
- Players viscerally associate this music with triumph
- The music ESCALATES within the pursuit theme itself - it builds and builds

### Unexpected Humor in Serious Moments
- The judge being comically dense: "Hmm, I see... actually I don't see at all!"
- Phoenix's inner monologue contradicting his confident exterior
- Absurd evidence (a parrot is called as a witness in one case)
- Character name puns (every single character name is a pun)
- The tonal whiplash between murder investigation and comedy keeps players engaged

### Why This Format Works for Social/Viral Content
- **Objection.lol** - fan site that lets anyone create Ace Attorney courtroom scenes, widely used for meme content
- **AI Debate videos** - format of AI characters debating in Ace Attorney style already exists and gets engagement
- **The format is inherently adversarial** - debates have clear sides, which drives engagement
- **The visual language is universal** - even people who never played know "OBJECTION!"
- **Short, clippable moments** - individual objections and breakdowns are 5-15 second clips perfect for social media

---

## 6. Existing Fan Projects & Prior Art

### objection.lol
- Web-based Ace Attorney scene maker
- Users can create custom courtroom scenes with game characters
- Includes sprites, backgrounds, sound effects, and music
- Widely used for meme content creation
- **Relevance:** Our app is essentially a real-time, AI-powered version of this

### objection_engine (GitHub: LuisMayo/objection_engine)
- **Python library** that turns comment chains into Ace Attorney video scenes
- Tech: Python 3.8+, FFmpeg, OpenCV, HuggingFace for sentiment analysis
- Generates video output with character animations, dialogue, sound effects
- Used to power Twitter, Telegram, and Discord bots
- **Relevance:** Most directly useful codebase. We could use similar asset structure and rendering logic but swap video generation for real-time web rendering

### Judgementia (GitHub: hamad-alharmi/judgementia)
- "AI-powered real-time multiplayer courtroom debate game"
- Tech: Next.js 14, TypeScript, Tailwind CSS, Supabase, Google Gemini API
- Multiplayer via Supabase Realtime, AI judge via Gemini
- **Relevance:** Closest existing project to our concept. Different in that it's multiplayer (human vs human + AI judge) rather than AI vs AI with human interjection

### AgenticAttorney (GitHub topic)
- AutoGen-based Ace Attorney style debate generator
- Uses multi-agent framework for orchestrating debate
- Python-based
- **Relevance:** Demonstrates the multi-agent debate approach, though text-only

### Objection-AI
- TypeScript client bridging Gemini AI with objection.lol-style interfaces
- **Relevance:** Shows the AI + Ace Attorney visual integration pattern

---

## 7. Technical Implementation Recommendations

### For the Hackathon (24 hours)

**Minimum Viable Ace Attorney Experience:**

1. **Visual (CSS/Canvas):**
   - 3 character positions (left/center/right) with simple sprite swaps
   - Text box at bottom with typewriter effect (1/30s per char)
   - "OBJECTION!" splash screen (full-screen text + flash)
   - Health bar (5 dots)
   - Minimal: just use colored rectangles for character positions, focus on text + sound

2. **Audio (ElevenLabs):**
   - 3 distinct voices for the 3 AI characters
   - Pre-generate the "OBJECTION!" / "HOLD IT!" clips for each character
   - Text blip sounds during text display (use web audio API)
   - Background music: use royalty-free pursuit/courtroom music (don't use actual game music)

3. **Interaction:**
   - Big red "OBJECTION!" button (hold-to-talk)
   - "Press" button (safe, asks for elaboration)
   - Swipe/tap through testimony statements

4. **AI Flow:**
   - Claude/GPT generates the debate content for all 3 characters
   - Structure: generate testimony as array of statements
   - Generate responses to pressing/objections dynamically
   - ElevenLabs converts text to distinct character voices
   - Stream audio to reduce latency

### Asset Sources (for hackathon, personal/educational use)
- objection_engine has open-source sprite and sound assets
- objection.lol's sprites are ripped from the original games (use only for demo, not production)
- For production: create original character sprites in a similar style, or use a more abstract visual representation

### Key Timing Values (from objection_engine source)
- Text speed: 1/30 second per character
- Punctuation pause: 0.3 seconds
- Between-sentence pause: 0.6 seconds
- Camera pan duration: 0.5 seconds
- Desk slam duration: 0.8 seconds
- Desk slam audio offset: 0.15s (defense), 0.25s (prosecution)
- Text blip loop: 0.06 seconds
- Flash duration: configurable (typically 0.3-0.5 seconds)

---

## 8. The "Magic Moments" to Nail

If you only get 5 things right, make it these:

1. **The "OBJECTION!" moment** - screen flash, bold text, voice clip, brief silence, then the argument. This is the money shot. The 1-second pause after "OBJECTION!" before the argument starts is critical.

2. **The music shift** - when the user makes a good objection, shift from neutral/tense music to an intense "pursuit" style track. This single audio cue creates more emotional impact than any visual effect.

3. **The testimony breakdown** - individual statements the user can navigate through and challenge. Don't present arguments as walls of text. Break them into 3-5 discrete statements.

4. **The character reactions** - when one side scores a point, the other side's character should visibly react (expression change + brief animation). The visual feedback of your opponent "sweating" is deeply satisfying.

5. **The judge's verdict** - the final ruling should feel earned and dramatic. Triple gavel slam, verdict text on screen, brief silence, then the reasoning.
