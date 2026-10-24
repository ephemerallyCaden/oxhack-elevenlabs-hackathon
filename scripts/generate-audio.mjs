// B9: generate the courtroom's sound effects and music with ElevenLabs (Sound Effects + Music APIs).
// Run: node --env-file=.env.local scripts/generate-audio.mjs [--only name1,name2] [--force]
// Writes public/audio/sfx/*.mp3 and public/audio/bgm/*.mp3; skips files that already exist unless --force.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const KEY = process.env.ELEVENLABS_API_KEY;
const API = "https://api.elevenlabs.io/v1";

// Moments from docs/design-core-loop.md: cut-scene, interrupts (cut to witness view), Judge scoring, verdict.
const SFX = {
  objection: { text: "Dramatic courtroom objection sting: a sharp orchestral stab with a punchy hit, anime game style", seconds: 1.5 },
  gavel: { text: "Single wooden judge's gavel strike on a sound block in a courtroom, crisp and loud", seconds: 1 },
  scene_cut: { text: "Quick cinematic whoosh transition, short and clean", seconds: 0.8 },
  needle_up: { text: "Rising mechanical dial ticking quickly upward, game UI, satisfying", seconds: 1.5 },
  needle_down: { text: "Falling mechanical dial ticking quickly downward, game UI", seconds: 1.5 },
  gasp: { text: "Courtroom audience gasping in shock together", seconds: 1.5 },
  murmur: { text: "Low courtroom crowd murmuring and whispering, indistinct, steady", seconds: 6, loop: true },
  blip: { text: "Very short soft retro text blip, single beep, video game dialogue", seconds: 0.5 },
  buzzer: { text: "Short comedic wrong-answer buzzer, game show", seconds: 1 },
};
const BGM = {
  cutscene: { prompt: "Suspenseful instrumental build-up for a courtroom video game loading scene, ticking clock, low strings and pulsing synth, mysterious", ms: 30000 },
  trial: { prompt: "Tense but light instrumental courtroom investigation theme for an anime visual-novel game, steady groove, piano and strings, loopable, no vocals", ms: 60000 },
  pursuit: { prompt: "Energetic dramatic chase theme for a courtroom video game when an argument is going well, driving drums, brass stabs, fast strings, no vocals", ms: 40000 },
  verdict: { prompt: "Triumphant dramatic verdict reveal fanfare for a courtroom game, orchestral swell then resolution, no vocals", ms: 20000 },
};

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
const force = args.includes("--force");

async function credits() {
  const r = await fetch(`${API}/user/subscription`, { headers: { "xi-api-key": KEY } });
  return (await r.json()).character_count;
}

async function save(path, url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  writeFileSync(path, Buffer.from(await r.arrayBuffer()));
}

mkdirSync("public/audio/sfx", { recursive: true });
mkdirSync("public/audio/bgm", { recursive: true });
const before = await credits();

for (const [name, s] of Object.entries(SFX)) {
  const path = `public/audio/sfx/${name}.mp3`;
  if ((only && !only.includes(name)) || (existsSync(path) && !force)) continue;
  try {
    await save(path, `${API}/sound-generation?output_format=mp3_44100_128`, {
      text: s.text, duration_seconds: s.seconds, prompt_influence: 0.6, loop: !!s.loop, model_id: "eleven_text_to_sound_v2",
    });
    console.log(`sfx ${name}: ok`);
  } catch (e) {
    console.log(`sfx ${name}: FAILED ${e.message}`);
  }
}
for (const [name, m] of Object.entries(BGM)) {
  const path = `public/audio/bgm/${name}.mp3`;
  if ((only && !only.includes(name)) || (existsSync(path) && !force)) continue;
  try {
    await save(path, `${API}/music?output_format=mp3_44100_128`, { prompt: m.prompt, music_length_ms: m.ms, force_instrumental: true });
    console.log(`bgm ${name}: ok`);
  } catch (e) {
    console.log(`bgm ${name}: FAILED ${e.message}`);
  }
}
console.log(`Credits used: ${(await credits()) - before}`);
