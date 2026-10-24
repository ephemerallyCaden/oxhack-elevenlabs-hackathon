// Professional Voice Clone for the presenter (B3 upgrade). Steps, in order:
//   node --env-file=.env.local scripts/pvc.mjs create <recording> [more recordings...] [--denoise]
//   node --env-file=.env.local scripts/pvc.mjs captcha            → opens the text you must read aloud
//   node --env-file=.env.local scripts/pvc.mjs verify <your-captcha-recording>
//   node --env-file=.env.local scripts/pvc.mjs train [modelId]    (default eleven_v4, falls back to eleven_multilingual_v2)
//   node --env-file=.env.local scripts/pvc.mjs status             → run any time; done when state is "fine_tuned"
// The voice id is kept in scripts/out/pvc.json between steps.
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { spawn } from "node:child_process";

const el = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY, timeoutInSeconds: 600, maxRetries: 1 });
const STATE = "scripts/out/pvc.json";
const [cmd, ...args] = process.argv.slice(2);
mkdirSync("scripts/out", { recursive: true });
const voiceId = () => {
  if (!existsSync(STATE)) throw new Error("No PVC yet — run `create` first");
  return JSON.parse(readFileSync(STATE, "utf8")).voiceId;
};
const open = (path) => spawn("cmd", ["/c", "start", "", path], { detached: true, stdio: "ignore" }).unref();

if (cmd === "create") {
  const files = args.filter((a) => !a.startsWith("--"));
  if (!files.length) throw new Error("Pass the recording file(s)");
  const voice = await el.voices.pvc.create({ name: "Roulette presenter (PVC)", language: "en", description: "Presenter's professional clone for the three future selves" });
  writeFileSync(STATE, JSON.stringify({ voiceId: voice.voiceId }, null, 2));
  console.log(`Created PVC ${voice.voiceId}. Uploading ${files.length} file(s)…`);
  for (const f of files) {
    const samples = await el.voices.pvc.samples.create(voice.voiceId, {
      files: [new File([readFileSync(f)], basename(f))],
      removeBackgroundNoise: args.includes("--denoise"),
    });
    console.log(`  uploaded ${basename(f)} → ${samples.map((s) => s.sampleId).join(", ")}`);
  }
  console.log("Next: scripts/pvc.mjs captcha");
} else if (cmd === "captcha") {
  // The SDK types this call as void, so fetch it directly to get the image.
  const res = await fetch(`https://api.elevenlabs.io/v1/voices/pvc/${voiceId()}/captcha`, { headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`captcha ${res.status}: ${await res.text()}`);
  const type = res.headers.get("content-type") ?? "";
  let png;
  if (type.includes("json")) {
    const body = await res.json();
    const b64 = typeof body === "string" ? body : Object.values(body).find((v) => typeof v === "string" && v.length > 200);
    png = Buffer.from(b64.replace(/^data:image\/\w+;base64,/, ""), "base64");
  } else png = Buffer.from(await res.arrayBuffer());
  writeFileSync("scripts/out/pvc-captcha.png", png);
  open("scripts/out/pvc-captcha.png");
  console.log("Opened scripts/out/pvc-captcha.png — record yourself reading it ONCE (same mic/room as the samples), then: scripts/pvc.mjs verify <recording>");
} else if (cmd === "verify") {
  if (!args[0]) throw new Error("Pass your captcha recording");
  const r = await el.voices.pvc.verification.captcha.verify(voiceId(), { recording: new File([readFileSync(args[0])], basename(args[0])) });
  console.log("Verification:", JSON.stringify(r));
} else if (cmd === "train") {
  const id = voiceId();
  for (const modelId of args[0] ? [args[0]] : ["eleven_v4", "eleven_multilingual_v2"]) {
    try {
      const r = await el.voices.pvc.train(id, { modelId });
      console.log(`Training started on ${modelId}:`, JSON.stringify(r));
      break;
    } catch (e) {
      console.log(`${modelId}: ${e.statusCode ?? ""} ${e.message?.slice(0, 200)}`);
    }
  }
} else if (cmd === "status") {
  const v = await el.voices.get(voiceId());
  console.log(`voice_id ${v.voiceId} | samples ${v.samples?.length ?? 0}`);
  console.log("verification:", JSON.stringify(v.fineTuning?.verificationAttempts?.at?.(-1) ?? v.fineTuning?.isAllowedToFineTune));
  console.log("state:", JSON.stringify(v.fineTuning?.state), "| progress:", JSON.stringify(v.fineTuning?.progress));
} else {
  console.log("Commands: create <files> | captcha | verify <recording> | train [modelId] | status");
}
