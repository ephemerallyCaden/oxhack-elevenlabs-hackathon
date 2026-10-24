# Voice Differentiation: 3 Future Selves from 1 Clone

> Deep research on creating 3 distinct-sounding versions of the same cloned voice
> using ElevenLabs, for a "future selves debate a life decision" feature.

---

## 1. Voice Settings Parameters (The Tuning Knobs)

ElevenLabs exposes 5 parameters on every TTS request via `voice_settings`:

### stability (float, 0-1)
- **Low (0.0-0.3):** Broad emotional range, more expressive, more variation between generations. Voice sounds more animated and less predictable. Good for emotional/passionate delivery.
- **Mid (0.4-0.6):** Balanced. Natural conversational tone.
- **High (0.7-1.0):** Monotonous, consistent, robotic. Good for authoritative/measured delivery. Less variation between takes.
- **Key insight:** This is the MOST powerful differentiation lever. A stability delta of 0.4+ between two configs produces noticeably different deliveries from the same voice.

### similarity_boost (float, 0-1)
- **Low (0.0-0.3):** Voice drifts from the original clone. More "generic" sounding. Can introduce artifacts.
- **Mid (0.5-0.7):** Good balance of clone fidelity and naturalness.
- **High (0.8-1.0):** Tightly matches the original speaker's timbre and characteristics. Most "sounds like you."
- **For our use case:** Keep this at 0.6-0.85 for all three selves — we want them to all sound like the same person, just with different delivery styles.

### style (float, 0-1)
- **0.0:** No style exaggeration. Neutral delivery.
- **0.3-0.5:** Moderate amplification of the speaker's natural style.
- **0.7-1.0:** Heavy style exaggeration. More dramatic, more character. Can sound overacted.
- **Warning:** Values above 0 increase latency and compute cost. Use judiciously.
- **Key insight:** Style amplifies what's ALREADY in the voice. If the cloned sample was monotone, cranking style won't add emotion. If the sample was expressive, style will make it MORE expressive.

### use_speaker_boost (boolean)
- **true:** Enhances similarity to the original speaker. Slightly increases latency.
- **false:** Faster, slightly less accurate to the original.
- **For our use case:** Set `true` for Judge (authority needs to sound "most like you"), `false` for the others to let them drift slightly.

### speed (float)
- **< 1.0:** Slower speech.
- **1.0:** Normal speed (default).
- **> 1.0:** Faster speech.
- **Available in:** VoiceSettings in both Python and JS SDKs. The exact range boundaries aren't documented, but 0.7-1.3 is a safe range.

**There is NO direct pitch or timbre control.** Pitch and timbre are baked into the cloned voice. The only way to shift them is post-processing or using Voice Design/Remix (see Section 4).

---

## 2. Audio Tags for Emotional Differentiation

### Supported Models
- **Eleven v4 / v4 Turbo:** Best audio tag support. "Follows audio tags and direction prompts more accurately than prior models."
- **Eleven v3:** Introduced audio tags. "Requires more prompt engineering." Not suitable for real-time.
- **Eleven multilingual v2:** Limited tag support.
- **Eleven Flash v2.5:** Minimal tag support; optimized for speed.

**Use `eleven_v4_turbo` for the debate** — best quality + tags, ~100ms latency.

### Confirmed Working Tags (from official docs/examples)
```
[excited]       [whispers]      [laughs]        [sighs]
[curious]       [giggling]      [shouting]      [softly]
[laughs warmly] [sighs contentedly] [hesitant]
```

### Likely Working Tags (via natural language prompt engineering)
The v4 model interprets natural language descriptions of delivery. These are not "formal tags" but the model understands them:
```
[confident]     [cautious]      [calm]          [measured]
[assertive]     [warm]          [stern]         [thoughtful]
[passionate]    [gentle]        [firm]          [reflective]
[angry]         [nervous]       [wistful]       [tired]
[determined]    [empathetic]    [authoritative]
```

### Tag Formatting Rules
- Lowercase, in square brackets: `[excited]`
- Place at the START of a sentence or clause
- Can combine: `[happily][shouts] We did it! [laughs]`
- Can combine descriptive phrases: `[said angrily in French accent]`
- Tags affect the text that FOLLOWS them until the next tag or sentence boundary

### Sound Effects in Tags
v4 also supports inline sound effects:
```
[light rain]    [phone buzzing]  [door knock]
```
Could be used for dramatic effect in the debate (e.g., gavel sound for Judge).

### Combining Tags with Voice Settings
**This is where maximum differentiation happens.** Tags control per-sentence emotion; voice_settings control overall delivery style. They stack:

```
voice_settings = { stability: 0.25, style: 0.6 }  // emotional baseline
text = "[passionate] This is your ONE chance to change everything!"
// Result: Very expressive, emotionally charged delivery
```

vs.

```
voice_settings = { stability: 0.85, style: 0.1 }  // measured baseline
text = "[calm] Let's consider the facts before we decide."
// Result: Cool, controlled, authoritative delivery
```

---

## 3. Suggested Configurations for 3 Future Selves

### Self A — Prosecution (Advocating FOR the change)
**Character:** Confident, slightly assertive, passionate, forward-leaning energy.

```typescript
const prosecutionSettings = {
  stability: 0.25,           // Low: expressive, animated
  similarity_boost: 0.70,    // Moderate: sounds like you but with room to emote
  style: 0.55,               // Moderate-high: amplifies natural expressiveness
  use_speaker_boost: false,   // Let it drift slightly for character
  speed: 1.08,               // Slightly faster: urgency, confidence
};

// Prefix text with tags like:
// "[confident] You KNOW this is the right move."
// "[passionate] Think about what you'll gain!"
// "[assertive] The evidence is overwhelming."
```

### Self B — Defense (Advocating AGAINST the change)
**Character:** Cautious, warmer, more emotional, protective, concerned.

```typescript
const defenseSettings = {
  stability: 0.35,           // Low-mid: emotional range, but grounded
  similarity_boost: 0.75,    // Moderate-high: warm, familiar "you"
  style: 0.40,               // Moderate: natural, not over-the-top
  use_speaker_boost: true,   // Closer to original: comforting familiarity
  speed: 0.93,               // Slightly slower: thoughtful, careful
};

// Prefix text with tags like:
// "[gentle] But have you really thought about what you're giving up?"
// "[concerned] I'm worried about the risks here."
// "[warm] Remember what we already have..."
// "[hesitant] I... I'm not sure this is worth it."
```

### Self C — Judge (Mediator)
**Character:** Calm, authoritative, measured, neutral but wise.

```typescript
const judgeSettings = {
  stability: 0.80,           // High: steady, consistent, authoritative
  similarity_boost: 0.85,    // High: most "you" — the real you, undistorted
  style: 0.15,               // Low: no dramatic flair, just clean delivery
  use_speaker_boost: true,   // Maximum fidelity to original voice
  speed: 0.97,               // Slightly slower: deliberate, measured
};

// Prefix text with tags like:
// "[calm] Let me summarize both positions."
// "[thoughtful] The prosecution raises valid points, however..."
// "[measured] Before we proceed, let's acknowledge..."
// "[authoritative] ORDER. [pause] I've heard enough on this point."
```

### Differentiation Summary

| Parameter | Prosecution (A) | Defense (B) | Judge (C) |
|-----------|-----------------|-------------|-----------|
| stability | 0.25 | 0.35 | 0.80 |
| similarity_boost | 0.70 | 0.75 | 0.85 |
| style | 0.55 | 0.40 | 0.15 |
| speaker_boost | false | true | true |
| speed | 1.08 | 0.93 | 0.97 |
| Primary tags | confident, passionate, assertive | gentle, concerned, hesitant | calm, measured, authoritative |
| Feel | Energetic advocate | Warm protector | Steady arbiter |

**The biggest differentiator is stability** (0.25 vs 0.35 vs 0.80). This alone makes each voice feel dramatically different even though it's the same clone.

---

## 4. Alternative Approaches

### 4a. Clone Same Audio 3 Times — NOT USEFUL
Cloning creates a voice_id. Voice settings are applied at generation time, not clone time. You only need ONE clone. Apply different `voice_settings` per request.

### 4b. Voice Design to Describe Variants — POSSIBLE BUT RISKY
The `text_to_voice.design()` endpoint accepts a natural language `voice_description` and generates a new synthetic voice. You could describe each variant:
```python
# "A confident version of a 30-year-old male, assertive and energetic"
# "A cautious version of the same person, warmer and more emotional"
```
**Problem:** These would sound like DIFFERENT people, not variants of the user's own voice. Defeats the "future self" concept.

### 4c. Voice Remix — THE BEST ALTERNATIVE APPROACH
The `text_to_voice.remix()` endpoint takes an existing voice_id and a text description of changes to make:
```python
remixed = elevenlabs.text_to_voice.remix(
    voice_id=user_clone_id,
    voice_description="Make this voice sound slightly deeper and more authoritative, like a judge",
    auto_generate_text=True,
)
```
**This creates a NEW voice based on the clone but modified by the description.** Could be powerful for creating the 3 variants, but:
- Adds latency (generates preview voices, you pick one)
- Costs credits per remix
- Results are non-deterministic — might not match the character you want
- Best used as a one-time setup step, not per-request

**Verdict:** Use voice_settings + audio tags as the primary approach. Fall back to Remix if the settings-only approach doesn't produce enough differentiation.

### 4d. Speech-to-Speech — INTERESTING FOR V2
Speech-to-speech converts audio input (with its emotion/pacing) into the target voice. You could:
1. Record 3 template performances (confident, cautious, calm) with ANY voice
2. Use STS to convert each into the user's cloned voice, preserving the emotion/pacing

```python
audio_stream = elevenlabs.speech_to_speech.convert(
    voice_id=user_clone_id,
    audio=template_audio_file,
    voice_settings='{"stability": 0.3, "similarity_boost": 0.7}',  # JSON string!
    model_id="eleven_english_sts_v2",
)
```

**Note:** voice_settings for STS must be a JSON-encoded STRING, not an object.

**Problem for hackathon:** Requires pre-recorded template audio. Not real-time. Better for polished demo, not live generation.

### 4e. Post-Processing (Pitch Shift, Speed Change)
ElevenLabs has built-in `audio_effects` on TTS requests:

```typescript
const audio = await el.textToSpeech.convert(voiceId, {
  text: "...",
  model_id: "eleven_v4_turbo",
  audio_effects: {
    filter_preset_id: "phone",      // or "old_radio"
    distance: 0.3,                   // 0-1, rolls off frequencies
    environment_id: "small_room",    // or "hall"
    send_level: 0.2,                 // reverb amount 0-1
    pan: -0.3,                       // stereo position -1 to 1
    background_noise_id: "cafe",     // ambient noise bed
  },
});
```

**For differentiation potential:**
- Give Judge a slight `small_room` reverb (0.1 send_level) for gravitas
- Give Prosecution a tiny `distance: 0.1` for "leaning forward" energy
- Keep Defense clean/close for intimacy
- Use `pan` to place them in stereo space: Prosecution left, Defense right, Judge center

**External post-processing (Web Audio API):**
- Pitch shift via `AudioContext.createBufferSource().playbackRate` (changes speed too)
- True pitch shift via `PitchShifter` library or Web Audio worklet
- BUT: adds complexity and latency. Not recommended for hackathon.

---

## 5. Streaming TTS for Real-Time Debate

### HTTP Streaming (Recommended for Hackathon)
```typescript
const audioStream = await el.textToSpeech.stream(voiceId, {
  text: debateText,
  model_id: "eleven_v4_turbo",
  voice_settings: prosecutionSettings,
  output_format: "mp3_44100_128",
});

// Consume immediately (GC bug — see gotchas doc)
for await (const chunk of audioStream) {
  // Send to client via SSE or buffer to WebSocket
}
```

**Latency:** ~100ms for v4 Turbo first byte. Each subsequent chunk streams as generated.

### WebSocket Streaming (Lower Latency, More Complex)
```
wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input
```

Connection sends:
1. **InitializeConnection:** voice_settings, generation_config (chunk_length_schedule), model_id
2. **SendText:** text chunks with `try_trigger_generation=True`
3. **CloseConnection:** empty text `{"text":""}` to signal end

Receives: base64-encoded audio chunks as JSON.

**For the debate use case:** HTTP streaming is simpler and sufficient. WebSocket only helps if you're streaming text token-by-token from an LLM.

### Handling Turn-Based Debate

```typescript
class DebateManager {
  private currentAbortController: AbortController | null = null;

  async speak(voiceId: string, text: string, settings: VoiceSettings) {
    // Cancel any current speech
    if (this.currentAbortController) {
      this.currentAbortController.abort();
    }

    this.currentAbortController = new AbortController();

    const stream = await el.textToSpeech.stream(voiceId, {
      text,
      model_id: "eleven_v4_turbo",
      voice_settings: settings,
    });

    // Play audio (implement with Web Audio API or <audio> element)
    await this.playStream(stream, this.currentAbortController.signal);
  }

  async objection(interruptText: string, settings: VoiceSettings) {
    // Abort current speaker
    this.currentAbortController?.abort();

    // Immediately start the interrupting voice
    await this.speak(voiceId, interruptText, settings);
  }
}
```

**"OBJECTION!" Interruption Flow:**
1. Abort the current HTTP stream (AbortController)
2. Stop current audio playback (AudioContext.close() or audio.pause())
3. Immediately fire new TTS request with the interrupting character's settings
4. First audio chunk arrives in ~100ms (v4 Turbo)

**Between-turn gap:** ~100-200ms if you pre-fire the next speaker's request slightly before the current one finishes. Use `stream_with_timestamps` to know exactly when audio ends.

### Three Voice Configs from One Clone
```typescript
// All three use the SAME voice_id — just different settings
const VOICE_ID = user_clone_voice_id;

await debate.speak(VOICE_ID, prosecutionText, prosecutionSettings);
// ... wait for completion ...
await debate.speak(VOICE_ID, defenseText, defenseSettings);
// ... wait for completion ...
await debate.speak(VOICE_ID, judgeText, judgeSettings);
```

### text_to_dialogue — Alternative Multi-Speaker Approach
ElevenLabs has a `text_to_dialogue` endpoint that handles multi-character speech natively:

```typescript
const dialogue = await el.textToDialogue.stream({
  inputs: [
    { text: "[assertive] The prosecution rests.", voice_id: VOICE_ID },
    { text: "[concerned] But your honor, the defense objects!", voice_id: VOICE_ID },
    { text: "[calm] Overruled. Continue.", voice_id: VOICE_ID },
  ],
  model_id: "eleven_v4_turbo",
});
```

**Limitation:** Same voice_id for all three means you can't pass different voice_settings per speaker in dialogue mode. The settings would be the same for all. Audio tags become your ONLY differentiation tool here.

**Verdict:** Use individual `textToSpeech.stream()` calls per speaker for maximum control over settings. Use `text_to_dialogue` only if you want ElevenLabs to handle cross-speaker prosodic continuity (speakers sound like they're responding to each other).

---

## 6. Onboarding Voice Capture

### Minimum Recording Requirements
| Approach | Audio Length | Quality |
|----------|-------------|---------|
| Absolute minimum | ~10 seconds | Passable but thin. Emotion won't transfer well. |
| Recommended for IVC | 1-2 minutes | Good quality. Captures core voice characteristics. |
| Ideal for IVC | 3-5 minutes | Best IVC quality. More stable across settings. |
| Professional (PVC) | 30+ minutes | Near-perfect clone. Overkill for hackathon. |

### What the User Should Say
For best clone quality, the recording should:
1. **Be natural and conversational** (not reading like a robot)
2. **Include emotional range** — some excited, some calm, some thoughtful
3. **Feature only one speaker** with no background noise
4. **Cover diverse phonemes** — a diverse text sample works best

**Suggested onboarding script (60-90 seconds):**
```
"Tell me about a decision you're currently wrestling with.
What are the main arguments for making this change?
And what's holding you back?
If you could ask your future self for advice, what would you want to know?"
```

This is genius for the app because:
- The user naturally provides 60-90 seconds of speech
- They use their real emotional range (excitement about the change, hesitation about risks)
- The content feeds directly into the AI debate prompt
- It doesn't feel like "recording a voice sample" — it feels like the app experience

### Audio Quality Tips for Web Recording
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    sampleRate: 44100,        // WAV/PCM 44.1kHz preferred
    channelCount: 1,          // Mono
  },
});
```

Use **MediaRecorder** with `audio/webm;codecs=opus` (widely supported) or `audio/wav`. ElevenLabs accepts common formats.

### Cloning API Call
```typescript
const voice = await el.voices.ivc.create({
  name: `user_${userId}_voice`,
  files: [audioBlob],
  description: "User voice clone for future selves debate",
  remove_background_noise: true,  // ONLY if recording has noise
  labels: { language: "en", gender: "detected", age: "adult" },
});

const voiceId = voice.voice_id;
// Save to Supabase
```

**Warning about `remove_background_noise`:** "If the samples do not include background noise, it can make the quality worse." Only enable this if the recording environment is noisy. If using a decent microphone in a quiet room, set to `false`.

### Storing voice_id in Supabase

```sql
-- Add to user profile
ALTER TABLE profiles ADD COLUMN voice_id TEXT;
ALTER TABLE profiles ADD COLUMN voice_created_at TIMESTAMPTZ;
```

```typescript
// After cloning
await supabase
  .from('profiles')
  .update({
    voice_id: voice.voice_id,
    voice_created_at: new Date().toISOString(),
  })
  .eq('id', userId);
```

### Voice ID Persistence
- **Yes, voice_ids persist across sessions.** They are stored in your ElevenLabs account and accessible via API indefinitely (or until deleted).
- Voice IDs use the format: `JBFqnCBsd6RMkjVDRZzb` (21 character alphanumeric).
- You can retrieve all voices via `el.voices.getAll()` to verify a stored voice_id still exists.
- **No expiration** — voice_ids remain valid as long as the ElevenLabs account is active.

---

## 7. Implementation Priority for Hackathon

### Phase 1: Prove the concept (Hour 1-2)
1. Hard-code a test voice_id (use a pre-made clone or library voice)
2. Call TTS 3 times with the 3 different voice_settings configs from Section 3
3. Verify they sound noticeably different
4. Adjust settings if needed

### Phase 2: Add audio tags (Hour 2-3)
1. Add `[confident]`, `[gentle]`, `[calm]` prefixes to each character's lines
2. Test with `eleven_v4_turbo` model
3. Fine-tune tag placement for best effect

### Phase 3: Onboarding flow (Hour 3-5)
1. Build web audio recording UI
2. Call IVC clone endpoint
3. Store voice_id in Supabase
4. Wire the 3 configs to use the user's own clone

### Phase 4: Streaming debate (Hour 5-8)
1. HTTP streaming with AbortController for interruptions
2. Audio playback queue with turn management
3. "OBJECTION!" interrupt handler

### If differentiation isn't enough:
- Try Voice Remix to create 2 modified variants of the clone
- Add subtle audio_effects (reverb for Judge, slight distance for Prosecution)
- Use stereo panning to spatially separate the voices

---

## 8. Credit Budget Estimate

| Action | Credits | Occurrences | Total |
|--------|---------|-------------|-------|
| Voice clone (IVC) | ~500 | 1 per user | 500 |
| Dev testing (Flash v2.5) | ~50/100 chars | ~200 calls | 10,000 |
| Demo (v4 Turbo) | ~100/100 chars | ~50 calls | 5,000 |
| Voice Remix (if needed) | ~500 | 2 variants | 1,000 |
| **Total estimate** | | | **~16,500** |

Starter plan gives 30,000 credits. Plenty of headroom.

---

## Sources
- ElevenLabs Python SDK v2.74.1 (`elevenlabs` PyPI) — VoiceSettings, TTS client, STS client, IVC client, Voice Design client source code
- ElevenLabs JS SDK (`@elevenlabs/elevenlabs-js`) — VoiceSettings TypeScript interface, TTS client
- ElevenLabs blog: Eleven v4 announcement, v3 announcement
- ElevenLabs product page: voice cloning requirements, TTS capabilities
- ElevenLabs API reference.md: full endpoint parameter documentation
- Research doc 07 in this repo: implementation gotchas and working code patterns
