# ElevenLabs Capabilities — Hackathon Reference

> Full capability audit for a 25-hour hackathon build

---

## 1. Text-to-Speech API

- **17,500+ pre-built voices**, 90+ languages (Eleven v4)
- **Audio emotion tags**: `[whispers]`, `[laughs]`, `[hesitant]` — unique to ElevenLabs
- IPA pronunciation control, pronunciation dictionaries
- Multi-speaker dialogue support

### Models

| Model | Languages | Latency | Best For |
|---|---|---|---|
| Eleven v4 | 90+ | Standard | Expressive narration, emotion control |
| Eleven v4 Turbo | 90+ | ~100ms | Real-time voice agents (best for demos) |
| Eleven v3 | 70+ | Standard | Storytelling, gaming |
| Multilingual v2 | 29 | Standard | Long-form, stable output |
| Flash v2.5 | 32 | ~75ms | Lowest latency, **50% cheaper credits** |

**Hackathon time**: 1-2 hours basic, 3-4 hours with streaming frontend

**Wow factor**: Audio tags (`[whispers]`, `[laughs]`) mid-sentence make demos viscerally impressive

**Non-obvious uses**:
- Real-time narration of live data (sports, stocks, game commentary)
- "Emotional" notifications — whispers urgent alerts, confident tone for good news
- Instant accessibility layer for any text-heavy app

---

## 2. Voice Cloning

### Instant Voice Cloning (IVC)
- **10 seconds to 2 minutes** of audio needed
- Ready in **seconds**
- Available on **Starter plan** ($6/mo, $1 first month)
- Good enough for demos

### Professional Voice Cloning (PVC)
- 30+ minutes of recordings needed
- Available on Creator plan ($22/mo)
- Too slow for hackathon unless prepped in advance

**Both modes support 32+ languages** — a cloned English voice can speak Japanese

**Hackathon time**: 30 minutes for IVC

**Wow factor**: Clone a judge's voice during demo (with permission), have app speak back as them. **Single most jaw-dropping demo move.**

**Non-obvious uses**:
- Historical figure voices from public domain recordings
- Parent's voice for bedtime story app
- Voice preservation for ALS/speech condition patients

**Gotchas**:
- Not available on Free plan — need Starter ($1 first month)
- Quality degrades with noisy source audio
- Cloned voices in non-native languages sound slightly accented

---

## 3. Speech-to-Speech (Voice Conversion)

- Upload audio in one voice → output in another voice
- **Preserves** emotional delivery, whispers, laughs, accents
- Processing latency: ~400ms
- 29 languages, max 5 minutes per conversion
- Can use 10,000+ library voices or cloned voices

**Hackathon time**: 2-3 hours (batch), 4-5 hours (real-time pipeline)

**Non-obvious uses**:
- Voice anonymization (therapy apps, whistleblower tools)
- Gaming: speak naturally, character says it in-character
- "Voice filter" social app (Instagram filters for voice)

---

## 4. Conversational AI / Voice Agents ⭐ MOST HACKATHON-POWERFUL

### A. ElevenAgents (Fully Managed, No-Code)
- Sub-second responsiveness
- 90+ languages with real-time language detection
- Knowledge base integration (upload docs/FAQs)
- Tool calling (webhooks to your backend)
- Integrations: Zapier, Stripe, Cal.com, Twilio, Zendesk, HubSpot, SIP
- A/B testing of agent behavior

### B. Speech Engine (Bring Your Own LLM) ⭐ RECOMMENDED
- WebSocket server handling audio I/O
- **You provide Claude as the LLM**
- Auto-detects OpenAI, Anthropic, Gemini stream formats
- Handles interruption cancellation
- Attaches to Express/Next.js/Fastify servers

```python
# Python: Speech Engine with Claude
async def on_transcript(transcript, session):
    stream = await llm_client.create_response(...)
    await session.send_response(stream)
```

```typescript
// Node: Attach to Express
await elevenlabs.speechEngine.attach(engineId, httpServer, "/api/speech-engine/ws", {
  async onTranscript(transcript, signal, session) {
    const response = await anthropic.messages.create({...}, { signal });
    session.sendResponse(response);
  },
});
```

**Hackathon time**: ElevenAgents 1-2 hours, Speech Engine + Claude 4-6 hours

**Wow factor**: Live voice conversation with AI that sounds human, responds <1 second, and takes real actions. Judges can talk to it directly.

---

## 5. Sound Effects Generation

- Text prompt → 4 audio variations in seconds
- Max 30 seconds per clip
- 400+ categories (sci-fi, nature, ambient, 8-bit, etc.)
- Seamless looping support
- Royalty-free on paid plans

**Hackathon time**: 1 hour (single API call)

**Non-obvious uses**:
- Generative soundscapes based on user mood/context
- Dynamic game sound effects per player action
- "Describe your alarm sound" personalized alarm clock

---

## 6. Audio Isolation

- Separates speech from background noise (studio-grade)
- Removes ambient noise, mic feedback, overlapping conversations
- Input: WAV, MP3, FLAC, OGG, AAC up to 500MB, 1 hour max

**Hackathon time**: 30 minutes (single API endpoint)

**Wow factor**: Before/after demo in noisy hackathon venue — dramatic difference

---

## 7. Dubbing / Translation

- 90+ languages and accents
- Audio-based (preserves performance, not transcript-based)
- Automatic voice cloning of original speaker across languages
- Lip-sync alignment out of the box

**Hackathon time**: 2-3 hours

**Wow factor**: Record team member in English, play back in 5 languages with same voice

---

## 8. Speech-to-Text (Scribe)

- **Scribe v2**: Industry-leading transcription, 90+ languages
- **Scribe v2 Realtime**: Sub-150ms latency
- Speaker diarization, PII redaction, caption generation
- Keyterm prompting (up to 1,000 domain-specific terms)

**Hackathon time**: 1-2 hours

---

## 9. Music Generation (ElevenMusic)

- Full songs, instrumentals, melodies from text
- Custom vocals, genre transitions mid-track
- Inpainting (regenerate just one section)
- 2/4/6-stem separation for remixing
- Genres: trap soul, country, pop, rock, jazz, ambient, opera, afrobeats, reggaeton

**Hackathon time**: 1-2 hours

---

## 10. Pricing for Hackathon

| Plan | Cost | Credits | ~Audio Min | Key Unlocks |
|---|---|---|---|---|
| Free | $0 | 10k/mo | ~10 | TTS, STT, SFX, Music. NO cloning |
| **Starter** | **$1 first mo** | 30k/mo | ~30 | **Voice Cloning**, commercial use |
| Creator | $11 first mo | 121k/mo | ~121 | Professional Cloning |
| Pro | $99 | 600k/mo | ~600 | 44.1kHz PCM, 192kbps |

### Credit Math
- TTS: 1 credit/character. "Hello world" = 11 credits
- 3-min demo script (~2,500 chars) = ~2,500 credits
- STT: 330 credits/minute
- **Flash v2.5 uses 50% fewer credits** — use during development

**Recommendation**: Get **Starter for $1**. Use Flash v2.5 during dev, switch to v4 Turbo for demo.

---

## 11. SDKs

**Python** (`pip install elevenlabs`): Sync + async clients, all APIs, streaming, Conversational AI, Speech Engine

**Node.js** (`npm install @elevenlabs/elevenlabs-js`): Server + browser + React packages, WebSocket Speech Engine, auto-retry

**Also**: Flutter, Swift, Kotlin for mobile

---

## 12. Hackathon Winning Patterns

### Pattern 1: "Talk to X"
Conversational interface for something unexpected — a historical figure, your codebase, a painting

### Pattern 2: "Instant Localization"
One input → many languages, preserving speaker's voice

### Pattern 3: "Voice as Identity"
App speaks in user's own cloned voice

### Pattern 4: "Multimodal Magic"
Combine STT + LLM + TTS + SFX for immersive experience

### What Judges Reward
1. **Live interaction** — judges talk to it, not watch a recording
2. **Emotional response** — the voice makes you feel something
3. **Speed** — sub-second responses feel magical
4. **Personalization** — adapts to the person using it
5. **Creative domain** — voice AI applied to something unexpected

---

## 13. Guaranteed Jaw-Drop Features

| Feature | Integration Time | Impact |
|---|---|---|
| Live voice cloning during demo | 2-3 hours | Tier 1 |
| Real-time voice agent with tool use | 6-8 hours | Tier 1 |
| Multilingual voice preservation | 3-4 hours | Tier 1 |
| Emotional audio tags in context | 2-3 hours | Tier 2 |
| Generative soundscapes | 3-4 hours | Tier 2 |
| Speech Engine + Claude | 5-7 hours | Tier 2 |
| Before/after voice isolation | 1-2 hours | Tier 3 |
| Voice Design from description | 1-2 hours | Tier 3 |

---

## 14. Example Repos

Official examples at `github.com/elevenlabs/elevenlabs-examples` — 18 ready-to-run projects including Next.js voice agents
