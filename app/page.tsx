"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { UserProfile } from "@/types";
import VoiceStep, { type VoiceStepResult } from "@/components/onboarding/VoiceStep";
import { getProfile } from "@/lib/debate/orchestrator";
import { saveOnboarding } from "@/lib/onboarding/session";

type Step = "welcome" | "voice" | "thinking" | "confirm";

// Onboarding: read the script aloud (voice clone + transcript) → profile + question → the trial.
export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [profile, setProfile] = useState<UserProfile>({});
  const [question, setQuestion] = useState("");

  async function onVoice(r: VoiceStepResult) {
    setStep("thinking");
    const res = await getProfile({ transcript: r.transcript });
    setProfile(res.profile);
    setQuestion(res.question ?? "");
    setStep("confirm");
  }

  function toCourt() {
    const q = question.trim();
    if (!q) return;
    saveOnboarding({ profile, question: q });
    router.push("/trial");
  }

  const facts = [profile.name, profile.age && `${profile.age}`, profile.situation, profile.location, profile.risk_tolerance && `${profile.risk_tolerance} with risk`].filter(Boolean);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6 py-12 text-center">
      <header className="flex flex-col items-center gap-3">
        <p className="text-sm uppercase tracking-[0.4em] text-amber-400">Court of Future Selves</p>
        {step === "welcome" && <h1 className="text-5xl font-black tracking-tight sm:text-7xl">Your future is on trial.</h1>}
      </header>

      {step === "welcome" && (
        <>
          <p className="max-w-xl text-lg text-zinc-400">
            Read one short paragraph out loud. Three future versions of you, in your own voice, will argue your decision in court.
          </p>
          <div className="flex flex-col items-center gap-3">
            <button className="rounded-full bg-red-600 px-10 py-4 text-xl font-bold text-white hover:bg-red-500" onClick={() => setStep("voice")}>
              Begin
            </button>
            <button className="text-sm text-zinc-500 underline-offset-4 hover:underline" onClick={() => router.push("/trial")}>
              Skip — use the default voice
            </button>
          </div>
        </>
      )}

      {step === "voice" && <VoiceStep onDone={onVoice} />}

      {step === "thinking" && <p className="text-2xl text-zinc-300">The court is reading your file…</p>}

      {step === "confirm" && (
        <div className="flex w-full max-w-2xl flex-col items-center gap-6">
          {facts.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {facts.map((f) => (
                <span key={String(f)} className="rounded-full bg-zinc-800 px-4 py-1 text-sm text-zinc-300">{f}</span>
              ))}
            </div>
          )}
          <label className="flex w-full flex-col gap-2 text-left">
            <span className="text-sm uppercase tracking-widest text-amber-400">The question before the court</span>
            <input
              className="rounded-xl bg-zinc-900 px-4 py-4 text-xl text-white"
              placeholder="Should I …?"
              value={question}
              autoFocus
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && toCourt()}
            />
          </label>
          <button
            className="rounded-full bg-red-600 px-10 py-4 text-xl font-bold text-white hover:bg-red-500 disabled:opacity-40"
            disabled={!question.trim()}
            onClick={toCourt}
          >
            Take it to court
          </button>
        </div>
      )}
    </main>
  );
}
