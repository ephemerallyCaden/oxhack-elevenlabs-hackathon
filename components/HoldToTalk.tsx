"use client";

import { useEffect, useRef, useState } from "react";
import type { SttResponse } from "@/types";

type Props = {
  /** Called with the final transcript (after the user edits it, if `editable`). */
  onTranscript: (text: string) => void;
  label?: string;
  /** Hold Space to talk too (ignored while typing in an input). */
  spacebar?: boolean;
  /** Show the transcript in an editable box with a confirm button instead of submitting straight away. */
  editable?: boolean;
  disabled?: boolean;
};

type Phase = "idle" | "recording" | "transcribing" | "review" | "typed";
const now = () => performance.now();

// B6: hold the button (or Space) to record, release to transcribe with Scribe via /api/voice/stt.
// Falls back to a text box when there's no mic or permission is denied.
export default function HoldToTalk({ onTranscript, label = "Hold to talk", spacebar = true, editable = false, disabled = false }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [level, setLevel] = useState(0);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; started: number; raf: number } | null>(null);
  const phaseRef = useRef<Phase>("idle");
  // True while the button/Space is held. Opening the mic is async (and the first time shows a
  // permission prompt), so a release can arrive before recording starts.
  const holding = useRef(false);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  async function start() {
    if (disabled || holding.current || rec.current || phaseRef.current === "transcribing") return;
    holding.current = true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch {
      holding.current = false;
      setNote("No microphone access — type instead.");
      setPhase("typed");
      return;
    }
    if (!holding.current) {
      // Released before the mic opened.
      stream.getTracks().forEach((t) => t.stop());
      setNote("Hold the button while you speak.");
      return;
    }
    const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => transcribe(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));

    // Level meter
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      setLevel(Math.min(1, Math.sqrt(buf.reduce((a, v) => a + v * v, 0) / buf.length) * 4));
      if (rec.current) rec.current.raf = requestAnimationFrame(tick);
    };

    recorder.start();
    rec.current = { recorder, stream, ctx, started: now(), raf: 0 };
    rec.current.raf = requestAnimationFrame(tick);
    setNote("");
    setPhase("recording");
  }

  function stop() {
    holding.current = false;
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    cancelAnimationFrame(r.raf);
    r.ctx.close();
    r.stream.getTracks().forEach((t) => t.stop());
    setLevel(0);
    if (now() - r.started < 400) {
      r.recorder.onstop = null;
      r.recorder.stop();
      setNote("Hold the button while you speak.");
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    r.recorder.stop(); // → onstop → transcribe
  }

  async function transcribe(audio: Blob) {
    const t0 = now();
    const form = new FormData();
    form.append("audio", audio, "speech.webm");
    try {
      const res = await fetch("/api/voice/stt", { method: "POST", body: form });
      const out: SttResponse = await res.json();
      setNote(`${out.fallback ? "Mock transcript (no API key)" : "Transcribed"} in ${((now() - t0) / 1000).toFixed(1)}s`);
      if (!out.transcript.trim()) {
        setNote("Didn't catch that — try again.");
        setPhase("idle");
      } else if (editable) {
        setText(out.transcript);
        setPhase("review");
      } else {
        onTranscript(out.transcript);
        setPhase("idle");
      }
    } catch {
      setNote("Transcription failed — type instead.");
      setPhase("typed");
    }
  }

  // Hold Space to talk (not while typing in a field).
  useEffect(() => {
    if (!spacebar) return;
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement)?.closest("input, textarea, [contenteditable]");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e)) return;
      e.preventDefault();
      start();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || typing(e)) return;
      e.preventDefault();
      stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  if (phase === "review" || phase === "typed") {
    return (
      <form
        className="flex w-full flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onTranscript(text.trim());
          setText("");
          setPhase("idle");
        }}
      >
        <textarea
          className="rounded-lg bg-zinc-900 p-3 text-lg text-white"
          rows={2}
          autoFocus
          placeholder="Type what you want to say…"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex gap-2">
          <button type="submit" className="rounded-full bg-red-600 px-6 py-2 font-bold text-white">Confirm</button>
          <button type="button" className="rounded-full bg-zinc-700 px-6 py-2 text-white" onClick={() => { setText(""); setPhase("idle"); }}>
            Re-record
          </button>
        </div>
        {note && <p className="text-sm text-zinc-400">{note}</p>}
      </form>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={disabled || phase === "transcribing"}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); start(); }}
        onPointerUp={stop}
        onPointerCancel={stop}
        onContextMenu={(e) => e.preventDefault()}
        className={`relative select-none rounded-full px-8 py-4 text-lg font-bold text-white transition-colors touch-none ${
          phase === "recording" ? "bg-red-500" : "bg-red-700 hover:bg-red-600"
        } disabled:opacity-50`}
        style={phase === "recording" ? { boxShadow: `0 0 0 ${4 + level * 24}px rgba(239,68,68,0.35)` } : undefined}
      >
        {phase === "recording" ? "Listening… release to send" : phase === "transcribing" ? "Transcribing…" : `🎙 ${label}`}
      </button>
      <p className="h-5 text-sm text-zinc-400">{note || (spacebar && phase === "idle" ? "or hold Space" : "")}</p>
    </div>
  );
}
