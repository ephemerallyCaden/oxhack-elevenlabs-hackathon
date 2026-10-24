# ElevenLabs Implementation Guide — Gotchas & Working Code

> From reference-loop research: GitHub issues, official examples, and known pitfalls.
> Read this BEFORE you start coding.

---

## Critical Gotchas (Will Break Your Demo)

### 1. Localhost Allowlist Bug (Issue #320, OPEN)

**Problem:** ElevenLabs Agent/Speech Engine allowlist rejects `localhost` as a hostname.

**Workaround:** Use `127.0.0.1:3000` instead of `localhost:3000` in the allowlist.

| Entry | Result |
|---|---|
| `localhost:3000` | REJECTED |
| `https://localhost:3000` | REJECTED |
| `127.0.0.1:3000` | **ACCEPTED** |

**Source:** [elevenlabs/elevenlabs-js#320](https://github.com/elevenlabs/elevenlabs-js/issues/320)

---

### 2. Streaming GC Bug (Issue #400, CLOSED — ensure latest SDK)

**Problem:** On Node 18+, the `ReadableStream` from `textToSpeech.convert()` can become unusable if you `await` anything between getting the stream and consuming it. V8 garbage-collects the underlying `Response` object, and undici's `FinalizationRegistry` cancels the body stream.

**Symptoms:** `TypeError: Response body object should not be disturbed or locked`

**Fix:** Update to latest `@elevenlabs/elevenlabs-js` (patched upstream in Fern). If still on older SDK, consume the stream immediately — don't hold it across awaits.

**Source:** [elevenlabs/elevenlabs-js#400](https://github.com/elevenlabs/elevenlabs-js/issues/400)

---

### 3. Speech Engine Needs ngrok (or public URL)

The Speech Engine WebSocket server must be publicly accessible. ElevenLabs connects TO your server, not the other way around.

```bash
# Terminal 1: ngrok tunnel
ngrok http 3001

# Terminal 2: Speech Engine server
pnpm run speech-engine:server

# Terminal 3: Next.js dev
pnpm run dev
```

Set `PUBLIC_WS_URL` in `.env` to your ngrok URL + `/ws`:
```
PUBLIC_WS_URL=https://abc123.ngrok.io/ws
```

---

### 4. Speech Engine Duplicate Event Bug (Issue #453, OPEN)

**Problem:** A re-sent older `user_transcript` event can pass the duplicate check and abort the current response.

**Impact:** During rapid back-and-forth conversation, responses can get cut off.

**Mitigation:** Be aware of this during demo. Keep conversations with clear turn-taking rather than rapid interruptions.

**Source:** [elevenlabs/elevenlabs-js#453](https://github.com/elevenlabs/elevenlabs-js/issues/453)

---

## Working Speech Engine + Next.js Architecture

From the official `elevenlabs-examples` repo: `speech-engine/nextjs/quickstart`

### Architecture

```
┌─────────────┐     WebRTC      ┌──────────────────┐     WebSocket     ┌─────────────────┐
│   Browser    │ ←──────────→   │  ElevenLabs      │ ←──────────────→  │  Your Server    │
│  (Next.js)   │    (audio)     │  Speech Engine   │   (transcripts)   │  (port 3001)    │
│  port 3000   │                │  (cloud)         │                   │  + LLM calls    │
└─────────────┘                 └──────────────────┘                   └─────────────────┘
                                                                              ↓
                                                                       ┌─────────────────┐
                                                                       │  Claude / OpenAI │
                                                                       │  (streaming)     │
                                                                       └─────────────────┘
```

### Step 1: Create the Speech Engine resource

```typescript
// scripts/create-engine.mts
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const elevenlabs = new ElevenLabsClient({ apiKey: API_KEY });

const engine = await elevenlabs.speechEngine.create({
  name: "FocusCast Voice Agent",
  speechEngine: {
    wsUrl: PUBLIC_WS_URL,  // Your ngrok URL + /ws
  },
});

console.log(`ELEVENLABS_SPEECH_ENGINE_ID=${engine.engineId}`);
```

### Step 2: Server — attach Speech Engine to HTTP server

```typescript
// server.mts
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { createServer } from "node:http";

const elevenlabs = new ElevenLabsClient({ apiKey: API_KEY });
const httpServer = createServer();

elevenlabs.speechEngine.attach(SPEECH_ENGINE_ID, httpServer, "/ws", {
  debug: true,

  onInit(conversationId) {
    console.log("Session started:", conversationId);
  },

  async onTranscript(transcript, signal, session) {
    // transcript = array of { role: "user"|"agent", content: string }

    // Convert to your LLM's format
    const messages = transcript.map(msg => ({
      role: msg.role === "agent" ? "assistant" : "user",
      content: msg.content,
    }));

    // Stream response from your LLM (Claude example)
    const stream = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      system: "You are a focus coach...",
      messages: messages,
      stream: true,
    }, { signal });

    // Send the stream — ElevenLabs auto-detects Anthropic format
    session.sendResponse(stream);
  },

  onClose(session) {
    console.log("Session closed:", session.conversationId);
  },
});

httpServer.listen(3001, () => console.log("Speech Engine on :3001"));
```

### Step 3: Client — connect via WebRTC

```typescript
// Uses @elevenlabs/react for the browser side
// Token endpoint returns a signed token so API key stays server-side
```

### Environment Variables

```env
ELEVENLABS_API_KEY=sk_...
ELEVENLABS_SPEECH_ENGINE_ID=se_...
OPENAI_API_KEY=sk-...          # or ANTHROPIC_API_KEY
PUBLIC_WS_URL=https://abc.ngrok.io/ws
```

### Dependencies

```json
{
  "@elevenlabs/elevenlabs-js": "latest",
  "@elevenlabs/react": "latest",
  "openai": "latest",
  "dotenv": "latest"
}
```

---

## Quick TTS with Audio Tags (Simplest Integration)

```typescript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Generate voice with emotional audio tags
const audio = await el.textToSpeech.convert("voice_id_here", {
  text: `[excited] Forty-seven minutes of deep focus!
         [whispers] That's your longest session this week.
         [laughs] Not bad at all.`,
  model_id: "eleven_v4_turbo",  // ~100ms latency, best for demos
  output_format: "mp3_44100_128",
});

// IMPORTANT: Consume the stream immediately (see GC bug above)
const chunks = [];
for await (const chunk of audio) {
  chunks.push(chunk);
}
const buffer = Buffer.concat(chunks);
```

### Model Selection

| Use Case | Model | Why |
|---|---|---|
| Development/testing | `eleven_flash_v2_5` | 50% cheaper credits, ~75ms |
| Demo/production | `eleven_v4_turbo` | Best quality, ~100ms, emotion tags |
| Long narration | `eleven_multilingual_v2` | Most stable for long text |

### Voice Selection for FocusCast

Use the Voice Library API to find voices by use case:
```typescript
const voices = await el.voices.getAll();
// Filter for: radio host, announcer, coach, meditation
// Or use Voice Design: describe your ideal voice in text
```

---

## Instant Voice Cloning (The Demo Jaw-Drop)

```typescript
// Clone a voice from audio file (needs Starter plan, $1 first month)
const voice = await el.voices.addFromFile({
  name: "Judge Voice Clone",
  files: [audioBlob],  // 10 seconds to 2 minutes of audio
});

// Use the cloned voice immediately
const audio = await el.textToSpeech.convert(voice.voice_id, {
  text: "[excited] You just completed a 25-minute focus session!",
  model_id: "eleven_v4_turbo",
});
```

**Timing:** Clone creation takes ~10 seconds. Record judge's voice at the START of your demo, clone processes while you present, reveal at the end.

---

## Sound Effects Generation

```typescript
const sfx = await el.soundEffects.generate({
  text: "gentle rain on a window with soft distant thunder, loopable",
  duration_seconds: 30,
});
// Returns 4 variations; pick the best
```

---

## Credit Budget Cheat Sheet (Starter Plan: 30K)

| Action | Credits | Notes |
|---|---|---|
| TTS: 100 characters | ~100 | 1 credit per character |
| TTS with Flash v2.5 | ~50 | 50% cheaper — use for dev |
| Voice clone creation | ~500 | One-time per voice |
| Sound effect (30s) | ~1,000 | 4 variations returned |
| Music generation | ~2,000 | Per generation |
| STT: 1 minute | ~330 | Scribe v2 |

**Strategy:** Flash v2.5 during development, v4 Turbo for demo only.

---

## Reference-Loop Evidence

| Evidence ID | Source | Key Finding |
|---|---|---|
| E-206a30d1 | [JS SDK #400](https://github.com/elevenlabs/elevenlabs-js/issues/400) | Streaming GC bug — consume streams immediately, update SDK |
| E-674ccb19 | [JS SDK #453](https://github.com/elevenlabs/elevenlabs-js/issues/453) | Speech Engine duplicate transcript abort |
| E-3e85d755 | [JS SDK #320](https://github.com/elevenlabs/elevenlabs-js/issues/320) | Localhost allowlist — use `127.0.0.1` |
| — | [elevenlabs-examples](https://github.com/elevenlabs/elevenlabs-examples) | Official Speech Engine + Next.js quickstart |
