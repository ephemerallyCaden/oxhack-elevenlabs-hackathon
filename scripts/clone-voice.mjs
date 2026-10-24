// B3: create an Instant Voice Clone from a recording and print its voice_id.
// Run: node --env-file=.env.local scripts/clone-voice.mjs <recording> [more recordings...] [--name "Presenter"] [--denoise]
// Then add ELEVENLABS_VOICE_ID=<id> to .env.local.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
const nameIdx = args.indexOf("--name");
const name = nameIdx >= 0 ? args[nameIdx + 1] : "Roulette presenter";
const files = args.filter((a, i) => !a.startsWith("--") && i !== nameIdx + 1);
if (!files.length) {
  console.error("Usage: node --env-file=.env.local scripts/clone-voice.mjs voice-sample.m4a [--name \"Rand\"] [--denoise]");
  process.exit(1);
}

const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 120, maxRetries: 1 });

const voice = await el.voices.ivc.create({
  name,
  files: files.map((f) => new File([readFileSync(f)], basename(f))),
  removeBackgroundNoise: args.includes("--denoise"), // only if the room was noisy
  description: "Roulette demo: presenter's voice for the three future selves",
});
console.log(`\nvoice_id: ${voice.voiceId}${voice.requiresVerification ? "  (ElevenLabs says it needs verification)" : ""}`);
console.log(`Add to .env.local:  ELEVENLABS_VOICE_ID=${voice.voiceId}\n`);

// One preview line so you can hear the clone straight away.
const stream = await el.textToSpeech.convert(voice.voiceId, {
  text: "[confident] In five years I'm a millionaire. [hesitant] Or... I'm completely broke. [calm] Order in the court.",
  modelId: "eleven_v4_turbo",
  outputFormat: "mp3_44100_128",
});
const chunks = [];
for await (const c of stream) chunks.push(c);
mkdirSync("scripts/out", { recursive: true });
writeFileSync("scripts/out/clone-preview.mp3", Buffer.concat(chunks));
console.log("Preview: scripts/out/clone-preview.mp3");
