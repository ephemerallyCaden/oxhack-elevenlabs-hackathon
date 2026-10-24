# Pitch: the ElevenLabs part

> **Court of Future Selves.** You ask a life question out loud, and three future versions of you,
> speaking in *your own cloned voice*, argue it out in a courtroom using real facts, before a judge
> tells you where you land.

Owner: Rand (voice). Fits inside the main pitch (#29, awckiu). About 45 seconds on stage.

---

## The 30-second script

> "Everything you hear is ElevenLabs. When you first walk in, you read one short paragraph out loud.
> In about ten seconds, ElevenLabs **clones your voice** and **transcribes what you said** to build
> your profile. From then on, all three characters speak in *your* voice: the confident you, the
> cautious you and the judge. Each one gets its own delivery, using Eleven v4's emotion tags.
> When you shout 'objection', **Scribe** turns your words into text in about a second and a half,
> and the side you interrupted has to answer you. Even the gavel, the gasps and the music were
> generated with ElevenLabs. Five ElevenLabs products, one courtroom."

---

## The five features: what to point at, and when

| # | ElevenLabs feature | What it does in our app | Demo moment to point at |
|---|---|---|---|
| 1 | **Instant Voice Cloning** | Reading the onboarding script makes a clone of the user. The trial then speaks entirely in that voice | "That's *your* voice, from the future": the line plays right after onboarding |
| 2 | **Text to Speech: Eleven v4 + audio tags** | Three characters from **one** clone: different stability, emotion tags (`[confident]`, `[scoffs]`, `[calm]`) and left/right/centre stereo | YES sounds bold, NO sounds sceptical, the Judge sounds calm, and it's the same person |
| 3 | **Speech to Text: Scribe v2** | Turns the question, every interrupt and the onboarding recording into text (with key terms like "poker" and "quant") | Hold Space, object out loud, and the side you interrupted answers your point |
| 4 | **Sound Effects API** | 9 courtroom sounds: objection sting, gavel, spectrum needle, gasps, crowd murmur, text blip | The gavel when the Judge scores a topic, and the sting on an interrupt |
| 5 | **Music API** | 4 instrumental tracks: "the court prepares", the trial theme, the pursuit theme, the verdict fanfare | The music change at the verdict |

---

## Proof that we went deep (for questions, or one line in the pitch)

- **We tested what actually works, by machine.** We transcribed our own audio output to check emotion tags.
  - `eleven_flash_v2_5` **reads `[confident]` out loud**, so we use `eleven_v4`, which acts tags out.
  - All 11 tags we use are verified this way.
- **We fixed accent drift.** Instant clones of a British speaker drifted American.
  - We compared 16 variants: recording quality, model, similarity, tag strength.
  - Settled on the cleanest 2-minute stretch of a 20-minute recording, `eleven_v4` at maximum similarity, and a subtle `[slight British accent]` hint before each sentence, applied to the presenter voice only.
- **We found that `speed` has no effect on v4** (0.75× and 1.2× gave the same length). So the characters differ by stability, tags and stereo instead.
- **It's built for a live stage:**
  - A whole debate (12 lines, about 2 minutes of audio) is voiced in about 11 seconds, 4 lines at a time.
  - Replays come from a cache in about 70ms, for 0 credits.
  - Every call has a fallback, so the show never stops.
- **Privacy:** judges' clones are deleted after the demo (`scripts/delete-clones.mjs`).

---

## Likely judge questions

| Question | Answer |
|---|---|
| "Is that really my voice?" | Yes: an Instant Voice Clone from the paragraph you just read, made in about 10 seconds |
| "How do three characters sound different with one voice?" | Stability (0.4 / 0.6 / 0.8), Eleven v4 emotion tags, and stereo position. Speed doesn't work on v4; we tested it |
| "What about latency?" | Each line takes 1.5–12 seconds to generate on `eleven_v4`, so we voice the next lines while the current one plays. Interrupts transcribe in about 1.5 seconds |
| "Why not a Professional Voice Clone?" | We tried. It needs 30+ minutes of audio and hours of training, which is too slow for a live demo. Instant cloning gets most of the way in seconds |
| "What happens to my voice?" | It's deleted after the session |

---

## Before going on stage

- [ ] Onboarding is wired into the main flow, so a judge's voice can be cloned live (otherwise use `/dev/onboarding`)
- [ ] `ELEVENLABS_VOICE_ID` = presenter voice D in `.env.local`, and the live interrupt has been rehearsed
- [ ] Run the demo question once beforehand, so the presenter-voice lines are cached and play instantly
- [ ] After the demo: `node --env-file=.env.local scripts/delete-clones.mjs`
