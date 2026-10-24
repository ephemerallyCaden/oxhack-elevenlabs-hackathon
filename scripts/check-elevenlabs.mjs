// B1: check which ElevenLabs models/credits we have and whether audio tags work.
// Run: node --env-file=.env.local scripts/check-elevenlabs.mjs [--tts]
// --tts generates one tagged sentence per TTS model into scripts/out/ (~150 credits per model).
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { mkdirSync, writeFileSync } from "node:fs";

if (!process.env.ELEVENLABS_API_KEY) {
  console.error("ELEVENLABS_API_KEY missing — add it to .env.local");
  process.exit(1);
}
const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 60, maxRetries: 1 });

const sub = await el.user.subscription.get();
console.log(`Plan: ${sub.tier} | credits used ${sub.characterCount} / ${sub.characterLimit} | IVC allowed: ${sub.canUseInstantVoiceCloning} | voice slots ${sub.voiceCount ?? "?"}/${sub.voiceLimit}`);

const models = (await el.models.list()).filter((m) => m.canDoTextToSpeech);
console.log("\nTTS models:");
for (const m of models) {
  console.log(`  ${m.modelId.padEnd(28)} ${m.name ?? ""} | cost x${m.modelRates?.characterCostMultiplier ?? "?"} | max chars ${m.maximumTextLengthPerRequest ?? "?"}`);
}

if (process.argv.includes("--tts")) {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb"; // George (library) until we clone
  const text = "[confident] Twenty-three percent chance I'm a millionaire. [hesitant] But... sixty-one percent chance I'm broke. [calm] Order in the court.";
  mkdirSync("scripts/out", { recursive: true });
  const candidates = ["eleven_v4", "eleven_v4_turbo", "eleven_v3", "eleven_flash_v2_5"];
  for (const m of models.filter((m) => candidates.includes(m.modelId))) {
    try {
      const stream = await el.textToSpeech.convert(voiceId, { text, modelId: m.modelId, outputFormat: "mp3_44100_128" });
      const chunks = [];
      for await (const c of stream) chunks.push(c); // consume immediately (SDK GC gotcha, research/07)
      writeFileSync(`scripts/out/tags-${m.modelId}.mp3`, Buffer.concat(chunks));
      console.log(`  wrote scripts/out/tags-${m.modelId}.mp3`);
    } catch (e) {
      console.log(`  ${m.modelId}: ${e.statusCode ?? ""} ${e.message?.slice(0, 120)}`);
    }
  }
  console.log("\nListen to each file: are the [tags] acted out, ignored, or read aloud?");
}
