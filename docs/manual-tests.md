# Manual test plan

Automated tests can't hear the voices or judge the timing, so walk through these by hand before the demo. Do them in order: Pass 1 is the demo itself.

## Before you start

| What | How |
|---|---|
| Where | The live site (https://hackathon-template-vert.vercel.app) for the real thing. Mic and camera need HTTPS or localhost. |
| Sound | The portable speaker you'll demo with, not laptop speakers. |
| Stopwatch | Phone timer. Target: **onboarding → verdict in about 3 minutes**. |
| Who does what | One person drives, one writes results in the table at the bottom. |

**Cost:** a full live trial uses about **5,000–7,000 ElevenLabs credits** plus 10–15 Groq calls. We have roughly 110k credits this month, so budget about 15 full runs in total, and keep 3 in reserve for the demo.

**Cheap runs (no voice credits):** for anything that's only about the UI (buttons, animations, layout), run locally with `ELEVENLABS_API_KEY= DEBATE_LLM=mock npm run dev`. The voices become silent placeholders and the debate text comes from the mock, so nothing is spent.

Mark every check ✅ pass, ❌ fail (write what you saw), or ⚠️ works but looks or sounds off.

---

## Pass 1: the demo path (live, new user)

The exact run you'll do on stage. Start the stopwatch on **Begin**.

**Onboarding**
1. **Begin** → read the script aloud for 45 s or more → stop.
   - [ ] The progress bar reaches 45 s, then says you can stop.
   - [ ] "Meet your future self…" plays **your own cloned voice**. If you see a yellow "We couldn't use your voice" warning, write down the message.
2. Selfie: take the front photo, then the side photo.
   - [ ] The cut-out of your head looks clean (no background around it).
3. Your file: the chips (name, age, situation…) match what you said. Click one and correct it.
4. Hold to say your question, e.g. "Should I quit my quant job to become a professional poker player?" → **Take it to court**.
   - [ ] The question was transcribed correctly.

**Court**
5. Intro.
   - [ ] **No glimpse of the court before the crane-up.** It should open on the dark carpet.
   - [ ] The crane rises, lands with a shake, then the court appears.
6. The debate.
   - [ ] The three voices are clearly different (YES, NO and the Judge), and YES and NO come from different sides of the speaker.
   - [ ] The lines sound like people arguing, not an essay: short, concrete, a bit funny. Note any line that sounds like AI.
   - [ ] There's a Judge intro before the topic.
   - [ ] At most one punch shot per topic (zoom plus a slowed, intense ending).
   - [ ] A cut-in ("Hold on!") lands mid-line and the interrupted speaker comes back.
   - [ ] Faces animate: talking jaw, expressions, poses.
7. Interrupt: hold to interrupt (or press Space) while YES is talking, and argue back.
   - [ ] OBJECTION! effect: hard zoom-out, everyone turns to face you.
   - [ ] The speaker answers **your** point first, then the debate carries on.
8. The Judge's ruling for the topic, then the verdict.
   - [ ] The verdict screen shows the probability, the sources (facts only) and the transcript.
   - [ ] **Stop the stopwatch.** Write down the time. Target: about 3:00 (3:30 at most).

---

## Pass 2: returning user and the second trial (live)

The bugs fixed in #93 and #95 live here.

1. At the end of Pass 1, choose **Remember me** if offered, then **Main menu** / **New case**.
2. Welcome back → **That's me: ask a new question** → type a new question → **Take it to court**.
   - [ ] The crane intro plays again, and the court is fresh (not the old verdict).
   - [ ] The new question is the one being argued (no retyping needed).
3. During that trial, press the browser **Back** button → you're on `/` → **Take it to court** again.
   - [ ] It goes to court (it used to do nothing).
4. **I'm someone new**: onboarding starts from scratch, not as the previous person.
5. **Forget me**: you go back to the start, and next time there's no Welcome back.

---

## Pass 3: interrupts and agenda (cheap mode is fine for most of it)

1. Interrupt the **Judge** with "Add a topic about my family": a topic is added and the Judge confirms it.
2. Interrupt the Judge with "I don't care about money": that topic is removed and never debated.
3. Interrupt **NO** while it's speaking: NO answers you first.
4. Interrupt twice on the same topic: each point is answered and counted once.
5. Space bar works to interrupt (not while typing in a box).

---

## Pass 4: things going wrong (do these in cheap mode where you can)

| Do this | Expect |
|---|---|
| Deny microphone access | A typing box appears; you can still ask your question and interrupt by typing. |
| Deny camera access | Skip the selfie; the default faces are used. |
| Record only about 10 s | "Too short to clone" warning; continues with the default voice. |
| Skip setup: go straight to court | The court asks you for a question; the intro still plays with no flash. |
| Turn Wi-Fi off mid-trial for 10 s | The trial keeps going (mock lines or silence), no crash or frozen screen. |
| Refresh `/trial` mid-trial | No crash; you land back at a usable court. |

---

## Pass 5: share link

1. On the verdict screen, save and share → the consent question appears first.
2. Scan the QR code with a phone → `/t/<id>` shows the transcript and verdict.
   - [ ] No voice audio and no selfie appear on the shared page.

---

## Pass 6: the room

- [ ] On the projector at 16:9, the text box and buttons are readable from the back of the room.
- [ ] The speaker volume is enough over crowd noise; the voices don't clip.
- [ ] Browser: Chrome (the one we demo with). Check Safari once if there's time.
- [ ] Laptop power-saving and screen sleep are off.

---

## Results

| Pass | Step | Result | Notes (what you saw) | Who |
|---|---|---|---|---|
| 1 | Total time | | | |
| | | | | |
