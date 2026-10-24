"use client";

import { useState } from "react";
import * as audio from "@/lib/audio/engine";
import { BGM, SFX, type BgmName, type SfxName } from "@/lib/audio/assets";
import type { TtsResponse } from "@/types";

// B7 test page for the audio engine: music crossfades, ducking under voices, panning, SFX, OBJECTION.
const LINES = {
  prosecution: "[confident] Twenty-three percent chance you're a millionaire. That's not luck, that's upside.",
  defense: "[concerned] And a sixty-one percent chance you're broke within eighteen months. Think about that.",
  judge: "[calm] Order. The court has heard enough on this topic.",
} as const;
type VoiceSpeaker = keyof typeof LINES;
const now = () => performance.now();

export default function SoundLab() {
  const [status, setStatus] = useState("Click anything to start (unlocks audio).");
  const [ambience, setAmbience] = useState(false);

  async function say(speaker: VoiceSpeaker) {
    await audio.unlock();
    setStatus(`Generating ${speaker}…`);
    const res: TtsResponse = await (await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: LINES[speaker], speaker }),
    })).json();
    const t0 = now();
    setStatus(`${speaker} speaking (music ducked)…`);
    await audio.playVoice(speaker, res.audioUrl);
    setStatus(`${speaker} line ended after ${((now() - t0) / 1000).toFixed(1)}s`);
  }

  const btn = "rounded bg-zinc-800 px-4 py-2 hover:bg-zinc-700";
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-8">
      <h1 className="text-3xl font-bold">Sound lab</h1>
      <p data-testid="status" className="text-zinc-400">{status}</p>

      <section className="flex flex-wrap gap-2">
        <h2 className="w-full text-xl font-bold">Music (crossfades)</h2>
        {(Object.keys(BGM) as BgmName[]).map((m) => (
          <button key={m} className={btn} onClick={async () => { await audio.unlock(); await audio.setMusic(m); setStatus(`music: ${m}`); }}>{m}</button>
        ))}
        <button className={btn} onClick={() => { audio.setMusic(null); setStatus("music off"); }}>off</button>
        <button className={btn} onClick={async () => { await audio.unlock(); await audio.setAmbience(!ambience); setAmbience(!ambience); }}>
          crowd ambience: {ambience ? "on" : "off"}
        </button>
      </section>

      <section className="flex flex-wrap gap-2">
        <h2 className="w-full text-xl font-bold">Voices (panned left / right / centre, music ducks)</h2>
        {(Object.keys(LINES) as VoiceSpeaker[]).map((s) => (
          <button key={s} className={btn} onClick={() => say(s)}>{s}</button>
        ))}
        <button className="rounded bg-red-700 px-4 py-2 font-bold" onClick={() => { audio.objection(); setStatus("OBJECTION! (voice cut)"); }}>
          OBJECTION!
        </button>
      </section>

      <section className="flex flex-wrap gap-2">
        <h2 className="w-full text-xl font-bold">Sound effects</h2>
        {(Object.keys(SFX) as SfxName[]).map((s) => (
          <button key={s} className={btn} onClick={async () => { await audio.unlock(); audio.playSfx(s); }}>{s}</button>
        ))}
        <button className={btn} onClick={async () => { await audio.unlock(); audio.gavel(3); }}>verdict gavel ×3</button>
      </section>
    </main>
  );
}
