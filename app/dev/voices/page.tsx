"use client";

import { useRef, useState } from "react";
import type { VoiceSettings } from "@elevenlabs/elevenlabs-js/api";
import type { SttResponse } from "@/types";
import { TAG_PALETTE, VOICE_SETTINGS, type VoiceRole } from "@/lib/voice/configs";
import type { TtsResult } from "@/lib/voice/tts";
import HoldToTalk from "@/components/HoldToTalk";

// B4 voice lab: hear one line as all three future selves, tune settings, blind-test, and check audio tags.
const ROLES: VoiceRole[] = ["prosecution", "defense", "judge"];
const LABEL: Record<VoiceRole, string> = { prosecution: "Poker You", defense: "Quant You", judge: "Judge" };
const COLOR: Record<VoiceRole, string> = { prosecution: "bg-red-600", defense: "bg-blue-600", judge: "bg-amber-600" };
const PAN: Record<VoiceRole, number> = { prosecution: -0.7, defense: 0.7, judge: 0 };
const BLIND_LINE = "There's a sixty-one percent chance you're broke in eighteen months. Think about that.";
const TAGS_TO_CHECK = ["shouting", "scoffs", "whispers", "laughs", "sighs", "gasps"];
const randomRole = () => ROLES[Math.floor(Math.random() * ROLES.length)];

export default function VoiceLab() {
  const [text, setText] = useState("Twenty-three percent chance I'm a millionaire. But sixty-one percent chance I'm broke.");
  const [useTags, setUseTags] = useState(true);
  const [pan, setPan] = useState(true);
  const [settings, setSettings] = useState<Record<VoiceRole, VoiceSettings>>(VOICE_SETTINGS);
  const [status, setStatus] = useState("");
  const cache = useRef(new Map<string, TtsResult>());
  const ctx = useRef<AudioContext | null>(null);

  async function tts(role: VoiceRole, line: string, s: VoiceSettings = settings[role]) {
    const key = JSON.stringify([role, line, s]);
    const hit = cache.current.get(key);
    if (hit) return hit;
    setStatus(`Generating ${LABEL[role]}…`);
    const res = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line, role, voiceSettings: s }),
    });
    const out: TtsResult = await res.json();
    cache.current.set(key, out);
    setStatus(out.fallback ? "No API key — silent mock audio" : `${LABEL[role]}: ${(out.durationMs / 1000).toFixed(1)}s`);
    return out;
  }

  async function play(audioUrl: string, panValue: number) {
    ctx.current ??= new AudioContext();
    const buf = await ctx.current.decodeAudioData(await (await fetch(audioUrl)).arrayBuffer());
    const src = ctx.current.createBufferSource();
    const panner = ctx.current.createStereoPanner();
    src.buffer = buf;
    panner.pan.value = panValue;
    src.connect(panner).connect(ctx.current.destination);
    src.start();
    await new Promise((r) => (src.onended = r));
  }

  const tagged = (role: VoiceRole, line: string) => (useTags ? `[${TAG_PALETTE[role][0]}] ${line}` : line);

  async function speak(role: VoiceRole) {
    const out = await tts(role, tagged(role, text));
    await play(out.audioUrl, pan ? PAN[role] : 0);
  }

  // ── Blind test: random role, voice only (no panning), guess who ──
  const [blind, setBlind] = useState<{ answer: VoiceRole; score: number; total: number; last?: string } | null>(null);
  async function nextBlind(score = 0, total = 0, last?: string) {
    const answer = randomRole();
    setBlind({ answer, score, total, last });
    const out = await tts(answer, tagged(answer, BLIND_LINE));
    await play(out.audioUrl, 0);
  }
  function guess(role: VoiceRole) {
    if (!blind) return;
    const right = role === blind.answer;
    const last = right ? `✓ It was ${LABEL[blind.answer]}` : `✗ It was ${LABEL[blind.answer]}, not ${LABEL[role]}`;
    if (blind.total + 1 >= 9) setBlind({ ...blind, score: blind.score + (right ? 1 : 0), total: 9, last });
    else nextBlind(blind.score + (right ? 1 : 0), blind.total + 1, last);
  }

  // ── Tag check: is each tag acted out, or read aloud? (transcribe and look for the tag word) ──
  const [tagResults, setTagResults] = useState<Record<string, string>>({});
  async function checkTag(tag: string) {
    setTagResults((r) => ({ ...r, [tag]: "…" }));
    const out = await tts("prosecution", `[${tag}] I can't believe you just said that.`, settings.prosecution);
    play(out.audioUrl, 0);
    const form = new FormData();
    form.append("audio", await (await fetch(out.audioUrl)).blob(), "clip.mp3");
    const stt: SttResponse = await (await fetch("/api/voice/stt", { method: "POST", body: form })).json();
    const leaked = stt.transcript.toLowerCase().includes(tag.replace(/s$/, ""));
    setTagResults((r) => ({ ...r, [tag]: `${leaked ? "✗ READ ALOUD" : "✓ acted"} — "${stt.transcript}"` }));
  }

  const [heard, setHeard] = useState<string[]>([]);

  const setOne = (role: VoiceRole, k: keyof VoiceSettings, v: number) =>
    setSettings((s) => ({ ...s, [role]: { ...s[role], [k]: v } }));

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
      <header>
        <h1 className="text-3xl font-bold">Voice lab</h1>
        <p className="text-zinc-400">Same line, three future selves. Tune until they&apos;re clearly different. {status}</p>
      </header>

      <section className="flex flex-col gap-3">
        <textarea className="rounded bg-zinc-900 p-3 text-lg" rows={2} value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap gap-4 text-sm">
          <label><input type="checkbox" checked={useTags} onChange={(e) => setUseTags(e.target.checked)} /> Add each role&apos;s first audio tag</label>
          <label><input type="checkbox" checked={pan} onChange={(e) => setPan(e.target.checked)} /> Stereo pan (left / centre / right)</label>
        </div>
        <div className="grid grid-cols-3 gap-4">
          {ROLES.map((role) => (
            <div key={role} className="flex flex-col gap-2 rounded bg-zinc-900 p-4">
              <button className={`${COLOR[role]} rounded py-2 font-bold`} onClick={() => speak(role)}>▶ {LABEL[role]}</button>
              <p className="text-xs text-zinc-500">tags: {TAG_PALETTE[role].join(", ")}</p>
              {(["stability", "similarityBoost"] as const).map((k) => (
                <label key={k} className="text-sm">
                  {k}: {settings[role][k]?.toFixed(2)}
                  <input
                    type="range" className="w-full"
                    min={0} max={1} step={0.05}
                    value={settings[role][k] ?? 1}
                    onChange={(e) => setOne(role, k, Number(e.target.value))}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
        <button className="rounded bg-zinc-700 py-2" onClick={async () => { for (const r of ROLES) await speak(r); }}>▶ Play all three</button>
        <details>
          <summary className="cursor-pointer text-sm text-zinc-400">Copy settings into lib/voice/configs.ts</summary>
          <pre className="mt-2 overflow-x-auto rounded bg-zinc-900 p-3 text-xs">{JSON.stringify(settings, null, 2)}</pre>
        </details>
      </section>

      <section className="flex flex-col gap-3 rounded bg-zinc-900 p-4">
        <h2 className="text-xl font-bold">Blind test (target ≥ 7/9)</h2>
        <p className="text-sm text-zinc-400">Plays a random self with no panning. Get a teammate to guess who it is.</p>
        {!blind || blind.total >= 9 ? (
          <button className="rounded bg-green-700 py-2" onClick={() => nextBlind()}>
            {blind ? `Score ${blind.score}/9 — run again` : "Start blind test"}
          </button>
        ) : (
          <>
            <p>Clip {blind.total + 1}/9 · score {blind.score} {blind.last && `· ${blind.last}`}</p>
            <div className="grid grid-cols-3 gap-2">
              {ROLES.map((r) => <button key={r} className={`${COLOR[r]} rounded py-2`} onClick={() => guess(r)}>{LABEL[r]}</button>)}
            </div>
            <button className="text-sm text-zinc-400" onClick={async () => play((await tts(blind.answer, tagged(blind.answer, BLIND_LINE))).audioUrl, 0)}>↻ replay</button>
          </>
        )}
        {blind?.total === 9 && <p>{blind.last}</p>}
      </section>

      <section className="flex flex-col items-center gap-3 rounded bg-zinc-900 p-4">
        <h2 className="self-start text-xl font-bold">Speech input (HoldToTalk)</h2>
        <HoldToTalk spacebar={false} editable onTranscript={(t) => setHeard((h) => [t, ...h])} />
        <ul className="self-start text-sm text-zinc-300">{heard.map((t, i) => <li key={i}>“{t}”</li>)}</ul>
      </section>

      <section className="flex flex-col gap-2 rounded bg-zinc-900 p-4">
        <h2 className="text-xl font-bold">Audio tag check</h2>
        <p className="text-sm text-zinc-400">Generates each tag, transcribes it, and flags tags that get spoken out loud.</p>
        {TAGS_TO_CHECK.map((tag) => (
          <div key={tag} className="flex items-center gap-3 text-sm">
            <button className="w-28 rounded bg-zinc-700 py-1" onClick={() => checkTag(tag)}>[{tag}]</button>
            <span className="text-zinc-300">{tagResults[tag]}</span>
          </div>
        ))}
      </section>
    </main>
  );
}
