"use client";

import { useEffect, useRef, useState } from "react";
import type { SttResponse, TtsResponse } from "@/types";

export type VoiceStepResult = {
  /** The user's clone, or null → use the presenter voice (server default). */
  voiceId: string | null;
  /** What they said — feeds the profile (D10). */
  transcript: string;
  fallback: boolean;
  /** Why the user's own voice couldn't be used (shown to them; the default voice is used instead). */
  error?: string;
};

const MIN_SECONDS = 45;
const MAX_SECONDS = 120;
const SESSION_KEY = "roulette.voiceId";
const now = () => performance.now();

/** The clone made during onboarding, for the trial: `new TrialOrchestrator({ voiceId: sessionVoiceId() })`. */
export function sessionVoiceId(): string | undefined {
  try {
    return sessionStorage.getItem(SESSION_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

type Phase = "intro" | "recording" | "processing" | "preview";

// B8: the user reads the onboarding script aloud once. That recording is cloned (their future selves'
// voice) and transcribed (their profile) in parallel. Ends with a line in their cloned voice.
export default function VoiceStep({ onDone }: { onDone: (r: VoiceStepResult) => void }) {
  const [phase, setPhase] = useState<Phase>("intro");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [status, setStatus] = useState("");
  const [result, setResult] = useState<VoiceStepResult | null>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; started: number; timer: number } | null>(null);
  const preview = useRef<HTMLAudioElement | null>(null);

  async function start() {
    let stream: MediaStream;
    try {
      // No browser processing: noise suppression / AGC change the voice and hurt the clone.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch {
      finish({ voiceId: null, transcript: "", fallback: true }, "No microphone — using the default voice.");
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), audioBitsPerSecond: 128_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => process(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));

    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const started = now();
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buf);
      setLevel(Math.min(1, Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length) * 4));
      const s = Math.floor((now() - started) / 1000);
      setSeconds(s);
      if (s >= MAX_SECONDS) stop();
    }, 100);

    recorder.start(1000);
    rec.current = { recorder, stream, ctx, started, timer };
    setSeconds(0);
    setPhase("recording");
  }

  function stop() {
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    clearInterval(r.timer);
    r.ctx.close();
    r.stream.getTracks().forEach((t) => t.stop());
    setLevel(0);
    setPhase("processing");
    setStatus("Cloning your voice and listening to your answers…");
    r.recorder.stop(); // → onstop → process
  }

  async function process(audio: Blob) {
    const form = () => {
      const f = new FormData();
      f.append("audio", audio, "onboarding.webm");
      return f;
    };
    const [clone, stt] = await Promise.all([
      fetch("/api/voice/clone", { method: "POST", body: form() })
        .then((r) => r.json() as Promise<{ voiceId: string | null; fallback: boolean; error?: string }>)
        .catch(() => ({ voiceId: null, fallback: true, error: "Couldn't reach the voice cloning service." })),
      fetch("/api/voice/stt", { method: "POST", body: form() }).then((r) => r.json() as Promise<SttResponse>).catch(() => ({ transcript: "", fallback: true })),
    ]);
    const res: VoiceStepResult = { voiceId: clone.voiceId, transcript: stt.transcript, fallback: clone.fallback || stt.fallback, error: clone.error };
    try {
      if (res.voiceId) sessionStorage.setItem(SESSION_KEY, res.voiceId);
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // private mode: the trial just uses the presenter voice
    }

    // The reveal: their future self speaks.
    setStatus("Meet your future self…");
    // A failed preview must never block onboarding: finish either way.
    const tts: TtsResponse | null = await fetch("/api/voice/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker: "judge", voiceId: res.voiceId ?? undefined, text: "[calm] Hello. I'm you, five years from now. Let's talk about this decision." }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    finish(res, res.voiceId ? "That's your voice, from the future." : "Your future selves will use the default voice.");
    if (tts?.audioUrl) {
      preview.current = new Audio(tts.audioUrl);
      preview.current.play().catch(() => {});
    }
  }

  function finish(r: VoiceStepResult, message: string) {
    setResult(r);
    setStatus(message);
    setPhase("preview");
  }

  useEffect(() => () => {
    rec.current?.stream.getTracks().forEach((t) => t.stop());
    preview.current?.pause();
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 text-center">
      {(phase === "intro" || phase === "recording") && (
        <div className="rounded-2xl bg-zinc-900 p-6 text-left text-xl leading-relaxed text-zinc-200">
          <p className="mb-3 text-sm uppercase tracking-widest text-amber-400">Read this out loud, in your normal voice</p>
          <p>
            “My name is <b>[your name]</b>. I’m <b>[your age]</b> years old and I live in <b>[your city]</b>. I work as a{" "}
            <b>[your job]</b>, and I’d say I’m the kind of person who <b>[values freedom / plays it safe / chases the big win /
            follows their gut]</b>. If I had to describe my life in one sentence, it would be…”
          </p>
          <p className="mt-4 text-zinc-400">Then keep talking: what decision are you stuck on? What’s the best that could happen? The worst?</p>
        </div>
      )}

      {phase === "intro" && (
        <button className="rounded-full bg-red-600 px-10 py-4 text-xl font-bold text-white hover:bg-red-500" onClick={start}>
          🎙 Start recording
        </button>
      )}

      {phase === "recording" && (
        <>
          <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-red-500 transition-[width]" style={{ width: `${Math.min(100, (seconds / MIN_SECONDS) * 100)}%` }} />
          </div>
          <p className="text-lg text-zinc-300" style={{ opacity: 0.6 + level * 0.4 }}>
            {seconds}s {seconds < MIN_SECONDS ? `— keep going, ${MIN_SECONDS - seconds}s more` : "— great, stop whenever you’re ready"}
          </p>
          <button
            className="rounded-full bg-zinc-200 px-10 py-4 text-xl font-bold text-black disabled:opacity-40"
            disabled={seconds < MIN_SECONDS}
            onClick={stop}
          >
            Done
          </button>
        </>
      )}

      {(phase === "processing" || phase === "preview") && <p className="text-2xl text-zinc-200" data-testid="voice-status">{status}</p>}
      {phase === "preview" && result?.error && (
        <p role="alert" data-testid="voice-error" className="max-w-xl rounded-xl border border-amber-500/60 bg-amber-500/10 px-4 py-3 text-left text-amber-200">
          ⚠️ We couldn’t use your voice: {result.error}
        </p>
      )}

      {phase === "preview" && result && (
        <div className="flex gap-3">
          <button className="rounded-full bg-zinc-700 px-6 py-3 text-white" onClick={() => preview.current?.play()}>↻ Hear again</button>
          <button className="rounded-full bg-red-600 px-8 py-3 font-bold text-white" onClick={() => onDone(result)}>Continue</button>
        </div>
      )}
    </div>
  );
}
