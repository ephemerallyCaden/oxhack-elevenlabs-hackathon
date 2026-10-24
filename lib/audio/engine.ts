"use client";

import type { Speaker } from "@/types";
import { BGM, SFX, type BgmName, type SfxName } from "./assets";

// B7: one Web Audio graph for the courtroom.
//   voice (panned per speaker) ─┐
//   music (ducked under voice) ─┼─ master → speakers
//   sfx ────────────────────────┘
// Browser-only. Call unlock() from a click/keypress before the first sound (autoplay rules).

const PAN: Record<Exclude<Speaker, "user">, number> = { prosecution: -0.7, defense: 0.7, judge: 0 };
const MUSIC_LEVEL = 0.35;
const DUCKED_LEVEL = 0.09; // ≈ −12 dB while someone speaks

let ctx: AudioContext | null = null;
let master: GainNode, voiceBus: GainNode, musicBus: GainNode, sfxBus: GainNode;
const buffers = new Map<string, Promise<AudioBuffer>>();
let voice: { src: AudioBufferSourceNode; done: () => void } | null = null;
let music: { name: BgmName; src: AudioBufferSourceNode; gain: GainNode } | null = null;
let ambience: AudioBufferSourceNode | null = null;
// Loads are async: each seq token cancels calls that were still loading when a newer call (or stop) arrived.
let voiceSeq = 0;
let musicSeq = 0;
let ambienceSeq = 0;

function graph() {
  if (ctx) return ctx;
  ctx = new AudioContext();
  master = ctx.createGain();
  master.connect(ctx.destination);
  voiceBus = ctx.createGain();
  musicBus = ctx.createGain();
  sfxBus = ctx.createGain();
  musicBus.gain.value = MUSIC_LEVEL;
  for (const bus of [voiceBus, musicBus, sfxBus]) bus.connect(master);
  return ctx;
}

function load(url: string) {
  const c = graph();
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => c.decodeAudioData(b));
    buffers.set(url, p);
  }
  return p;
}

function play(buffer: AudioBuffer, out: AudioNode, { loop = false, at = 0 } = {}) {
  const src = graph().createBufferSource();
  src.buffer = buffer;
  src.loop = loop;
  src.connect(out);
  src.start(graph().currentTime + at);
  return src;
}

function duck(on: boolean) {
  const t = graph().currentTime;
  musicBus.gain.cancelScheduledValues(t);
  musicBus.gain.setTargetAtTime(on ? DUCKED_LEVEL : MUSIC_LEVEL, t, on ? 0.08 : 0.4);
}

/** Resume audio after a user gesture, and warm the cache for the common sounds. */
export async function unlock() {
  await graph().resume();
  Object.values(SFX).forEach(load);
}

/** Preload anything (e.g. the next line's audioUrl) so it starts instantly. */
export function preload(url: string) {
  void load(url);
}

/**
 * Play one line of dialogue, panned by speaker, with the music ducked underneath.
 * Resolves when it finishes OR is cut off by stopVoice() (interrupts). Starting a new line stops the old one.
 */
export async function playVoice(speaker: Exclude<Speaker, "user">, url: string): Promise<void> {
  const token = ++voiceSeq;
  const buffer = await load(url);
  if (token !== voiceSeq) return; // interrupted or superseded while loading
  stopVoice();
  const panner = graph().createStereoPanner();
  panner.pan.value = PAN[speaker];
  panner.connect(voiceBus);
  const src = play(buffer, panner);
  duck(true);
  return new Promise((resolve) => {
    const done = () => {
      if (voice?.src === src) voice = null;
      if (!voice) duck(false);
      resolve();
    };
    voice = { src, done };
    src.onended = done;
  });
}

/** Cut the current line immediately (the user pressed INTERRUPT). Its playVoice() promise resolves. */
export function stopVoice() {
  voiceSeq++; // also cancels a line still loading
  if (!voice) return;
  const v = voice;
  voice = null;
  v.src.onended = null;
  v.src.stop();
  v.done();
}

/** Fire-and-forget sound effect. */
export async function playSfx(name: SfxName, { volume = 1, delay = 0 } = {}) {
  const buffer = await load(SFX[name]);
  const gain = graph().createGain();
  gain.gain.value = volume;
  gain.connect(sfxBus);
  play(buffer, gain, { at: delay });
}

/** Judge's gavel: 1 hit for topic scores, 3 for the verdict. */
export function gavel(times = 1) {
  for (let i = 0; i < times; i++) void playSfx("gavel", { delay: i * 0.3 });
}

/** Crossfade to a music track (or null for silence). `trial` and `cutscene` loop; `verdict` plays once. */
export async function setMusic(name: BgmName | null, fadeSeconds = 1) {
  if (music?.name === name) return;
  const token = ++musicSeq;
  const c = graph();
  const t = c.currentTime;
  if (music) {
    const old = music;
    old.gain.gain.setTargetAtTime(0, t, fadeSeconds / 3);
    old.src.stop(t + fadeSeconds * 2);
    music = null;
  }
  if (!name) return;
  const buffer = await load(BGM[name]);
  if (token !== musicSeq) return; // a newer setMusic won while loading
  const gain = c.createGain();
  gain.gain.value = 0;
  gain.gain.setTargetAtTime(1, c.currentTime, fadeSeconds / 3);
  gain.connect(musicBus);
  music = { name, src: play(buffer, gain, { loop: name !== "verdict" }), gain };
}

/** Low crowd murmur under everything (on during the trial, off for the verdict). */
export async function setAmbience(on: boolean) {
  const token = ++ambienceSeq;
  if (!on) {
    ambience?.stop();
    ambience = null;
    return;
  }
  if (ambience) return;
  const buffer = await load(SFX.murmur);
  if (token !== ambienceSeq || ambience) return; // turned off or already started while loading
  const gain = graph().createGain();
  gain.gain.value = 0.25;
  gain.connect(sfxBus);
  ambience = play(buffer, gain, { loop: true });
}

/** The OBJECTION moment: cut the speaker, sting, dip the music. */
export function objection() {
  stopVoice();
  void playSfx("objection");
  duck(true);
  setTimeout(() => !voice && duck(false), 1500);
}

export function setMasterVolume(v: number) {
  graph();
  master.gain.value = v;
}
