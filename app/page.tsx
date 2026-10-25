"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { UserProfile } from "@/types";
import type { SavedUser } from "@/lib/users/store";
import VoiceStep, { sessionVoiceId, type VoiceStepResult } from "@/components/onboarding/VoiceStep";
import HoldToTalk from "@/components/HoldToTalk";
import SelfieStep, { sessionSelfie } from "@/components/onboarding/SelfieStep";
import { getProfile } from "@/lib/debate/orchestrator";
import { rememberedUserId, restoreSession, saveOnboarding, setRememberedUserId } from "@/lib/onboarding/session";

type Step = "welcome" | "back" | "voice" | "selfie" | "thinking" | "confirm";

/** Forget the last person's clone / selfie / profile (their clone may already be deleted). */
function clearSession() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("roulette.")) sessionStorage.removeItem(k);
  } catch {
    // private mode
  }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// Onboarding: read the script aloud (voice clone + transcript) → selfie → profile + question → the trial.
// Returning users ("Remember me") skip straight to their question.
export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [profile, setProfile] = useState<UserProfile>({});
  const [question, setQuestion] = useState("");
  const [remember, setRemember] = useState(false);
  const [returning, setReturning] = useState<SavedUser | null>(null);
  const profileCall = useRef<ReturnType<typeof getProfile> | null>(null);

  // Remembered on this device? → "Welcome back".
  useEffect(() => {
    const id = rememberedUserId();
    if (!id) return;
    post("/api/users/get", { id })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(({ user }: { user: SavedUser }) => {
        setReturning(user);
        setStep((s) => (s === "welcome" ? "back" : s));
      })
      .catch(() => setRememberedUserId(null)); // deleted or a different database
  }, []);

  function onVoice(r: VoiceStepResult) {
    profileCall.current = getProfile({ transcript: r.transcript }); // runs while they take the selfie
    setStep("selfie");
  }

  async function onSelfie() {
    setStep("thinking");
    const res = await (profileCall.current ?? getProfile({}));
    setProfile(res.profile);
    setQuestion(res.question ?? "");
    setStep("confirm");
  }

  function welcomeBack(u: SavedUser) {
    clearSession();
    restoreSession(u);
    setProfile(u.profile);
    setQuestion("");
    setRemember(true);
    setStep("confirm");
  }

  async function forgetMe() {
    if (returning) await post("/api/users/delete", { id: returning.id }).catch(() => {});
    setRememberedUserId(null);
    setReturning(null);
    setStep("welcome");
  }

  const leaving = useRef(false);
  // Browser Back restores this page (Cache Components / Activity) with the guard still set: release it when hidden.
  useEffect(() => () => void (leaving.current = false), []);
  async function toCourt() {
    const q = question.trim();
    if (!q || leaving.current) return; // Enter + click (or a double click) must not save twice
    leaving.current = true;
    saveOnboarding({ profile, question: q });
    if (remember) {
      const r = await post("/api/users", {
        id: returning?.id ?? rememberedUserId() ?? undefined,
        profile,
        voiceId: sessionVoiceId() ?? null,
        selfie: sessionSelfie() ?? null,
      }).catch(() => null);
      if (r?.ok) setRememberedUserId((await r.json()).id);
    }
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
            <button className="rounded-full bg-red-600 px-10 py-4 text-xl font-bold text-white hover:bg-red-500" onClick={() => { clearSession(); setStep("voice"); }}>
              Begin
            </button>
            <button className="text-sm text-zinc-500 underline-offset-4 hover:underline" onClick={() => { clearSession(); router.push("/trial"); }}>
              Skip setup — go straight to court
            </button>
          </div>
        </>
      )}

      {step === "back" && returning && (
        <div className="flex flex-col items-center gap-5">
          {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
          {returning.selfie && <img src={returning.selfie} alt="" className="h-32 rounded-full" />}
          <h1 className="text-4xl font-black sm:text-6xl">Welcome back{returning.profile.name ? `, ${returning.profile.name}` : ""}.</h1>
          <p className="text-zinc-400">The court remembers your voice and your face.</p>
          {/* Shared demo laptop: the next person must find "someone new" as easily as "that's me". */}
          <div className="flex flex-wrap justify-center gap-3">
            <button className="rounded-full bg-red-600 px-8 py-4 text-xl font-bold text-white hover:bg-red-500" onClick={() => welcomeBack(returning)}>
              That’s me: ask a new question
            </button>
            <button
              className="rounded-full border-2 border-zinc-500 px-8 py-4 text-xl font-bold text-white hover:border-white"
              onClick={() => { setRememberedUserId(null); setReturning(null); clearSession(); setStep("voice"); }}
            >
              I’m someone new
            </button>
          </div>
          <button className="text-sm text-zinc-500 underline-offset-4 hover:text-red-400 hover:underline" onClick={forgetMe}>
            Forget me (delete my voice &amp; face)
          </button>
        </div>
      )}

      {step === "voice" && (
        <>
          <VoiceStep onDone={onVoice} />
          <button className="text-sm text-zinc-500 underline-offset-4 hover:underline" onClick={() => setStep("selfie")}>
            Skip — use the default voice
          </button>
        </>
      )}

      {step === "selfie" && <SelfieStep onDone={onSelfie} />}

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
          <HoldToTalk label="Hold to say your question" spacebar={false} onTranscript={setQuestion} />
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember me on this device (saves your voice, face and profile)
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
