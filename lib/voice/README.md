# lib/voice — owner: randodeh (B)
ElevenLabs TTS / STT / voice clone wrappers + per-role voice configs. Returns mock audio when ELEVENLABS_API_KEY is missing. Issues: B1-B9.

## Verified against installed SDK (`@elevenlabs/elevenlabs-js` 2.74.0)
Request fields are **camelCase** (`modelId`, `voiceSettings`, `outputFormat`), not snake_case as in the research files.

| Need | Method |
|---|---|
| TTS | `el.textToSpeech.convert(voiceId, { text, modelId, voiceSettings, outputFormat })` / `.stream(...)` |
| TTS + per-character timings (typewriter sync for C4) | `el.textToSpeech.convertWithTimestamps(...)` |
| Voice settings | `{ stability, similarityBoost, style, speed, useSpeakerBoost }` |
| Instant voice clone | `el.voices.ivc.create(...)` (`voices.addFromFile` does NOT exist) |
| Speech-to-text (Scribe) | `el.speechToText.convert({ file, modelId, keyterms, languageCode, diarize })` |
| Sound effects | `el.textToSoundEffects.convert(...)` |
| Music | `el.music.compose(...)` / `.stream(...)` |
| Voice remix / design (B4 fallback) | `el.textToVoice.remix(...)`, `.design(...)` |
| Multi-speaker dialogue | `el.textToDialogue.convert(...)` |
| Models / credits | `el.models.list()`, `el.user.subscription.get()` |

Check models + credits: `node --env-file=.env.local scripts/check-elevenlabs.mjs` (add `--tts` to test audio tags per model).

## Findings (B1, tested with our key)
- **Plan:** Creator — 131,000 credits/month, Instant Voice Cloning allowed, 30 voice slots.
- **Use `eleven_v4_turbo` for everything (dev AND demo).** 0.5x credit cost, 10k chars/request, acts out audio tags.
- **Never use `eleven_flash_v2_5` with audio tags — Flash reads `[confident]` out loud** (verified by transcribing its output). Research files 07/08 say "Flash for dev" — ignore that.
- `eleven_v4` (1x cost) and `eleven_v3` also act tags out; keep `eleven_v4` as an A/B option in the voice lab (B4).
- Scribe STT model: `scribe_v2` (works with `speechToText.convert`).
- Pass `timeoutInSeconds` to `new ElevenLabsClient(...)` — without it a call hung once in testing.

Env (defaults in code if unset): `ELEVENLABS_MODEL=eleven_v4_turbo`, `ELEVENLABS_STT_MODEL=scribe_v2`.
