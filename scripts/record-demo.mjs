#!/usr/bin/env node
// Record a stored demo trial (lib/debate/replay.ts): runs a real trial through the actual orchestrator
// against a running dev server (which has the keys), ends every line at once, makes one scripted
// objection, and saves the state over time to public/demos/<id>.json (+ index.json for the menu).
//
//   npm run dev   # in another terminal, with keys in .env.local
//   node scripts/record-demo.mjs --id quit-job --question "Should I quit my job to start a company?" \
//     --object "But I have six months of savings" --profile '{"name":"Sam","age":27,"situation":"software engineer"}'
//
// Options: --base <url> (default http://127.0.0.1:3000) · --title "…" · --voice (also record the voices:
// spends ElevenLabs credits, about 3-5k per trial; without it the lines are shown for their estimated
// length) · --allow-mock (save even if a call fell back to mock lines; normally refused).
import { createJiti } from "jiti";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []),
);
if (!args.id || !args.question) {
  console.error('usage: node scripts/record-demo.mjs --id <slug> --question "Should I …?" [--object "…"] [--profile \'{…}\'] [--title "…"] [--voice] [--base url]');
  process.exit(1);
}
if (!/^[a-z0-9-]{1,40}$/.test(args.id)) throw new Error("--id: lower-case letters, digits and dashes");
const base = String(args.base ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const voiced = args.voice === true;

const jiti = createJiti(import.meta.url, { alias: { "@": root } });
const { TrialOrchestrator } = await jiti.import(join(root, "lib/debate/orchestrator.ts"));
const { diffState } = await jiti.import(join(root, "lib/debate/replay.ts"));

// The orchestrator calls this site's API with relative URLs: point them at the dev server.
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (url === "/api/voice/tts" && !voiced) return Promise.resolve(Response.json({ audioUrl: "", durationMs: 0, fallback: true }));
  return realFetch(url.startsWith("/") ? base + url : url, init);
};

const profile = args.profile ? JSON.parse(args.profile) : undefined;
const orch = new TrialOrchestrator({ profile });
const frames = [];
let prev, t = Date.now(), objected = false, lastLine = "";
const done = new Promise((resolve) => {
  orch.subscribe(() => {
    const s = orch.getState();
    frames.push(diffState(prev, s, Date.now() - t));
    prev = s;
    t = Date.now();
    if (s.phase === "done") return resolve(s);
    if (s.phase !== "speaking" || !s.current || s.current.id === lastLine) return;
    const line = s.current;
    lastLine = line.id;
    process.stdout.write(`${line.speaker.padEnd(11)} ${line.text.slice(0, 90)}\n`);
    setTimeout(() => {
      // The scripted objection: the first NO argument of the first topic.
      if (args.object && !objected && line.speaker === "defense" && line.kind === "argument" && orch.beginInterrupt()) {
        objected = true;
        setTimeout(() => orch.endInterrupt(String(args.object)), 0);
      } else orch.lineEnded(line.id);
    }, 0);
  });
});
const timer = setTimeout(() => (console.error("timed out after 10 min"), process.exit(1)), 600_000);
orch.start(String(args.question), profile);
const end = await done;
clearTimeout(timer);

const mocked = [...new Set(end.fallbacks)].filter((f) => f !== "voice/tts" || voiced);
if (mocked.length && args["allow-mock"] !== true) {
  console.error(`\nNot saved: these calls fell back to mock lines: ${mocked.join(", ")}. Is the dev server running with keys? (--allow-mock to save anyway)`);
  process.exit(1);
}

// Voiced: move each line's audio out of the JSON into public/demos/<id>/<n>.mp3.
const dir = join(root, "public/demos");
mkdirSync(dir, { recursive: true });
if (voiced) {
  const audioDir = join(dir, args.id);
  mkdirSync(audioDir, { recursive: true });
  let n = 0;
  const save = (url) => {
    const m = /^data:audio\/(\w+);base64,(.+)$/.exec(url ?? "");
    if (!m) return url;
    const file = `${String(n++).padStart(3, "0")}.${m[1] === "mpeg" ? "mp3" : m[1]}`;
    writeFileSync(join(audioDir, file), Buffer.from(m[2], "base64"));
    return `/demos/${args.id}/${file}`;
  };
  const seen = new Map();
  const fix = (line) => {
    if (!line || typeof line !== "object") return line;
    if (seen.has(line.id)) return seen.get(line.id);
    const out = { ...line, audioUrl: save(line.audioUrl), punch: line.punch && { ...line.punch, audioUrl: save(line.punch.audioUrl) } };
    seen.set(line.id, out);
    return out;
  };
  for (const f of frames) {
    if (f.set?.current) f.set.current = fix(f.set.current);
    if (f.add?.transcript) f.add.transcript = f.add.transcript.map(fix);
    if (f.set?.transcript) f.set.transcript = f.set.transcript.map(fix);
    if (f.set?.result) f.set.result = { ...f.set.result, lines: f.set.result.lines.map(fix) };
  }
}

const demo = { id: args.id, title: String(args.title ?? args.question), question: String(args.question), recordedAt: new Date().toISOString(), voiced, frames };
writeFileSync(join(dir, `${args.id}.json`), JSON.stringify(demo));
const indexFile = join(dir, "index.json");
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, "utf8")) : [];
const entry = { id: demo.id, title: demo.title, question: demo.question, voiced };
writeFileSync(indexFile, JSON.stringify([...index.filter((d) => d.id !== demo.id), entry], null, 2) + "\n");
console.log(`\nSaved public/demos/${args.id}.json: ${frames.length} steps, ${end.transcript.length} lines, verdict ${end.verdict?.spectrum?.label ?? "?"}${voiced ? ", with voices" : ""}`);
process.exit(0);
