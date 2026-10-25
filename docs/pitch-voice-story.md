# Pitch script: the project and the voice pipeline

Presenter: Rand. About 2½-3 minutes. *(Italics = what to do, not what to say.)*

---

## 1. The hook (15s)

*(Face the judges.)*

> Everyone has a decision they keep putting off. Should I quit? Should I move? Should I do the master's?
> We built a courtroom where you put that decision on trial, and the only witnesses are **you, from the future.**

## 2. What it does (40s)

*(Start the demo on the home screen.)*

> You read one short paragraph out loud. From that, ElevenLabs **clones your voice**, and we pull out who you are: your age, your job, how much risk you like.
> You take a selfie, and your face goes onto every character.
> Then you ask your question.

*(Ask the question, or click a suggestion.)*

> The Judge sets the agenda. Then two versions of you argue it out, **in your own voice**:
> the best future you, at the moment that life is going best, and the worst future you, at the moment it's gone wrong.
> If one of them says something you disagree with, you hold Space and object, and they have to answer you.
> At the end, the Judge doesn't just say yes or no. They show you **where you land**, from "strong no" to "strong yes", and why.

## 3. The voice pipeline (75s), technical

*(Point at the screen while the characters talk.)*

> The whole idea depends on one thing: it has to sound like **you**, whoever you are and whatever your accent. Here's how the voice works.
>
> **Capture.** You read about a minute out loud. We record it **raw**: the browser's noise suppression, echo cancellation and auto-gain are switched off, because those filters flatten exactly the detail that carries an accent.
>
> **Clone and listen, in parallel.** That one recording goes two ways at once. ElevenLabs **Instant Voice Cloning** builds your voice in about ten seconds, and **Scribe v2** transcribes what you said, which Gemini turns into your profile.
>
> **Check before we trust it.** Every new clone has to say one word first. If ElevenLabs can't use it, the app tells you why. It never silently swaps in someone else's voice.
>
> **Keep your accent.** We tested more than twenty voice configurations and checked every clip by transcribing it back with Scribe. Two findings shaped the design: the faster models drift towards a generic American accent, and accent tags turn a real accent into a caricature. So every line uses the full **Eleven v4** model at maximum similarity, and we never add accent instructions to your clone. **Your accent comes only from your own recording.**
>
> **Three characters, one voice.** The Judge, the best you and the worst you are all your clone. They differ by **stability** (steady Judge, expressive you), by Eleven v4 **emotion tags** like *confident* or *scoffs*, which we verified are acted and not read aloud, and by **stereo position**: left, centre, right.
>
> **In sync and cheap to replay.** Every line comes back with per-character timestamps, so the text follows the voice exactly, and generated lines are cached, so replaying a trial costs zero credits.

*(If there's time:)*

> And your voice isn't kept: demo clones are deleted afterwards, and "Forget me" deletes yours at ElevenLabs straight away.

## 4. Close (20s)

> Five ElevenLabs products in one courtroom: voice cloning, Eleven v4 voices with emotion, Scribe speech-to-text, and sound effects and music we generated.
> And when it's over, you can save your trial and take it home on your phone. It's deleted after seven days.
>
> Your future is on trial. Want to take the stand?

*(Hand a judge the laptop.)*

---

## If a judge asks

| Question | Answer |
|---|---|
| "Is that really my voice?" | Yes: an instant clone from the paragraph you just read, made in about ten seconds |
| "Will it keep my accent?" | Yes. We use Eleven v4 at maximum similarity, record you without noise filtering, and never add accent instructions. The faster models drift towards an American accent, which is why we don't use them |
| "How do three characters sound different with one voice?" | Stability (0.4 / 0.6 / 0.8), Eleven v4 emotion tags, and left/centre/right stereo. Speed has no effect on v4; we tested it |
| "What if cloning fails?" | You see the reason on screen (for example "recording too short"), and the court uses a default voice. Nothing fails silently |
| "What do you keep?" | Nothing, unless you choose to. Saving your trial keeps the words for 7 days. Your voice clone is deleted after the demo |
