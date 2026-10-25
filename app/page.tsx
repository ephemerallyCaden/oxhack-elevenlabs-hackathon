"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { UserProfile } from "@/types";
import type { SavedUser } from "@/lib/users/store";
import VoiceStep, { sessionVoiceId, type VoiceStepResult } from "@/components/onboarding/VoiceStep";
import HoldToTalk from "@/components/HoldToTalk";
import SelfieStep, { sessionSelfie } from "@/components/onboarding/SelfieStep";
import { HEADS_KEY, useSessionHeads } from "@/components/onboarding/sessionHeads";
import Jury from "@/components/menu/Jury";
import "@/components/menu/court.css";
import ProfileChips from "@/components/menu/ProfileChips";
import { parsePastTrials, pastTrialsRaw, verdictSide } from "@/components/menu/pastTrials";
import { getProfile } from "@/lib/debate/orchestrator";
import { authConfigured, authedPost, signInWithGoogle, signOut, useSession } from "@/lib/auth/browser";
import {
  addToRoster,
  faceThumb,
  removeFromRoster,
  restoreSession,
  saveDraft,
  saveOnboarding,
  sessionProfile,
  takeDraft,
  type RosterEntry,
} from "@/lib/onboarding/session";

type Step = "welcome" | "back" | "voice" | "selfie" | "thinking" | "confirm";

/** Forget the last person's clone / selfie / profile (their clone may already be deleted). */
function clearSession() {
  try {
    for (const k of Object.keys(sessionStorage)) if (k.startsWith("roulette.")) sessionStorage.removeItem(k);
  } catch {
    // private mode
  }
}

function sessionHeadsJson() {
  try {
    return JSON.parse(sessionStorage.getItem(HEADS_KEY) ?? "null");
  } catch {
    return null;
  }
}

const noSubscribe = () => () => {};
const rosterRaw = () => {
  try {
    return localStorage.getItem("roulette.roster") ?? "[]";
  } catch {
    return "[]";
  }
};

function parseRoster(raw: string): RosterEntry[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}


// The menu + onboarding, in the YES | NO seam: read the script aloud (voice clone + transcript) →
// two photos → check the court's file on you + the question → the trial. Signed-in users who kept
// their voice and face skip straight to their question.
export default function Home() {
  const router = useRouter();
  const { session, ready } = useSession();
  const heads = useSessionHeads();
  const [step, setStep] = useState<Step>("welcome");
  const [profile, setProfile] = useState<UserProfile>({});
  const [question, setQuestion] = useState("");
  const [remember, setRemember] = useState(false);
  const [returning, setReturning] = useState<SavedUser | null>(null);
  const [aim, setAim] = useState(false); // pointer on the main action: both futures turn to you
  const [pastOpen, setPastOpen] = useState(false);
  const [, bump] = useState(0); // re-read localStorage lists after we change them
  const [error, setError] = useState("");
  const [stored, setStored] = useState<RosterEntry[]>([]); // everyone saved (the jury), from the server
  const [busy, setBusy] = useState(false);
  const profileCall = useRef<ReturnType<typeof getProfile> | null>(null);

  const rosterJson = useSyncExternalStore(noSubscribe, rosterRaw, () => "[]");
  const roster = useMemo(() => parseRoster(rosterJson), [rosterJson]);
  const pastJson = useSyncExternalStore(noSubscribe, () => pastTrialsRaw(), () => "[]");
  const past = useMemo(() => parsePastTrials(pastJson), [pastJson]);

  // Back from Google mid-onboarding (the draft), or "New case" from the verdict (keeps voice + face).
  useEffect(() => {
    void Promise.resolve().then(() => {
      const draft = takeDraft();
      const again = new URLSearchParams(location.search).has("again");
      if (draft) {
        setProfile(draft.profile);
        setQuestion(draft.question);
        setRemember(true);
        setStep("confirm");
      } else if (again) {
        setProfile(sessionProfile() ?? {});
        setStep("confirm");
        history.replaceState(null, "", "/");
      }
    });
  }, []);

  // The jury: every saved face (thumbnail + first name). Decoration: a slow or failed fetch leaves silhouettes.
  useEffect(() => {
    fetch("/api/jury", { method: "POST", signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : { jurors: [] }))
      .then(({ jurors }: { jurors: { name?: string; face: string }[] }) => setStored(jurors.map((j) => ({ email: "", name: j.name, face: j.face }))))
      .catch(() => {});
  }, []);

  // Signed in → their saved file, if they kept one → "Welcome back".
  useEffect(() => {
    if (!ready || !session) return;
    let live = true;
    authedPost("/api/users/get", session)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { user: SavedUser } | null) => {
        if (!live || !res) return;
        setReturning(res.user);
        setStep((s) => (s === "welcome" ? "back" : s));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, session]);

  function begin() {
    clearSession();
    setStep("voice");
  }

  function onVoice(r: VoiceStepResult) {
    profileCall.current = getProfile({ transcript: r.transcript }); // runs while they take the photos
    setStep("selfie");
  }

  async function onSelfie() {
    setStep("thinking");
    const res = await (profileCall.current ?? getProfile({}));
    setProfile(res.profile);
    setQuestion(res.question ?? "");
    setRemember(false); // opt-in: never save into whoever happens to be signed in
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

  async function someoneNew() {
    await signOut();
    setReturning(null);
    clearSession();
    setStep("voice");
  }

  async function forgetMe() {
    if (!session) return;
    setError("");
    const r = await authedPost("/api/users/delete", session, {}, AbortSignal.timeout(8000)).catch(() => null);
    if (!r?.ok) {
      setError("The court couldn’t delete your voice and face just now. Nothing was removed; try again.");
      return;
    }
    if (session.user.email) removeFromRoster(session.user.email);
    await signOut();
    setReturning(null);
    clearSession();
    bump((n) => n + 1);
    setStep("welcome");
  }

  function forgetFace(email: string) {
    removeFromRoster(email);
    bump((n) => n + 1);
  }

  /** Sign in from the confirm step: keep what they've told us across the trip to Google. */
  function signInToKeep() {
    saveDraft({ profile, question });
    void signInWithGoogle();
  }

  const leaving = useRef(false);
  async function toCourt() {
    const q = question.trim();
    if (!q || leaving.current) return; // Enter + click (or a double click) must not save twice
    leaving.current = true;
    setBusy(true);
    saveOnboarding({ profile, question: q });
    if (remember && session) {
      // Never hold the visitor at the door: a slow save is skipped after 5s (the trial still starts).
      const selfie = sessionSelfie() ?? null;
      const heads = sessionHeadsJson();
      const body = { profile, voiceId: sessionVoiceId() ?? null, ...(heads ? { heads } : { selfie }) };
      const r = await authedPost("/api/users", session, body, AbortSignal.timeout(5000)).catch(() => null);
      if (r?.ok && session.user.email) addToRoster({ email: session.user.email, name: profile.name, face: selfie ? await faceThumb(selfie) : undefined });
    }
    router.push("/trial");
  }

  const aimProps = { onMouseEnter: () => setAim(true), onMouseLeave: () => setAim(false), onFocus: () => setAim(true), onBlur: () => setAim(false) };

  const signedInAs = session?.user.email;
  const menu = step === "welcome" || step === "back";
  // The jury: faces kept on this laptop, plus yours once the photos are taken (not clickable).
  const yours = !menu && heads ? [{ email: "", name: profile.name || "You", face: heads.front.src }] : [];
  const pickJuror = authConfigured ? (e: RosterEntry) => e.email && e.email !== signedInAs && void signInWithGoogle(e.email) : undefined;

  return (
    <main className="court-ui">
      <div className="menu-bg" />
      {menu ? (
        <div className="menu-grid">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo, sized by the layout */}
          <img className="menu-seal" src="/assets/logo/roulette-seal-1200.webp" alt="Roulette: the Court of Future Selves" />
          <div className="menu-actions">
            {step === "welcome" && (
              <>
                <span className="ct-kicker">Court of Future Selves</span>
                <h1 className="ct-title-sm">Your future is on trial.</h1>
                <p className="ct-body">Read one short paragraph out loud, then put your decision before the court.</p>
                <div className="flex flex-col items-start gap-4">
                  <button className="ct-primary" onClick={begin} {...aimProps}>Begin</button>
                  <button className="ct-link" onClick={() => { clearSession(); router.push("/trial"); }}>Skip setup: go straight to court</button>
                  {past.length > 0 && (
                    <button className="ct-link" aria-expanded={pastOpen} onClick={() => setPastOpen((o) => !o)}>
                      Watch a past trial {pastOpen ? "▴" : "▾"}
                    </button>
                  )}
                </div>
                {/* Always shown; greyed out until Supabase Auth is configured (NEXT_PUBLIC_SUPABASE_*). */}
                {(
                  <div className="flex flex-col gap-3 border-t-2 border-[var(--c-oak)] pt-5">
                    {signedInAs ? (
                      <p className="ct-small">
                        Signed in as {signedInAs}. <button className="ct-link" onClick={() => void signOut()}>Sign out</button>
                      </p>
                    ) : (
                      <>
                        <span className="ct-small">{roster.length ? "Been here before? Find your face in the jury, or:" : "Been here before?"}</span>
                        <button className="ct-google self-start" disabled={!authConfigured} onClick={() => void signInWithGoogle()}>
                          <b aria-hidden="true">G</b> Sign in with Google
                        </button>
                        {!authConfigured && <span className="ct-small">Sign-in isn’t switched on for this build yet.</span>}
                      </>
                    )}
                  </div>
                )}
              </>
            )}

            {step === "back" && returning && (
              <>
                <div className="flex items-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
                  {returning.selfie && <img src={returning.selfie} alt="Your saved face" className="h-[92px] w-20 border-2 border-[var(--c-oak)] bg-[var(--c-wood)] object-contain" />}
                  <span className="ct-kicker">Court of Future Selves</span>
                </div>
                <h1 className="ct-title-sm">Welcome back{returning.profile.name ? `, ${returning.profile.name}` : ""}.</h1>
                <p className="ct-body">The court remembers your voice and your face.</p>
                {/* Shared demo laptop: the next person must find "someone new" as easily as "that's me". */}
                <div className="flex flex-col items-start gap-3">
                  <button className="ct-primary" onClick={() => welcomeBack(returning)} {...aimProps}>That’s me: ask a new question</button>
                  <button className="ct-ghost" onClick={() => void someoneNew()}>I’m someone new</button>
                </div>
                <button className="ct-link danger self-start" onClick={() => void forgetMe()}>Forget me (delete my voice &amp; face)</button>
                {error && <p role="alert" className="ct-alert">{error}</p>}
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="menu-step">
          {/* eslint-disable-next-line @next/next/no-img-element -- the logo badge */}
          <img className="menu-step-seal" src="/assets/logo/roulette-seal-600.webp" alt="Roulette" />
          <div className="menu-step-panel">
            {step === "voice" && (
              <>
                <VoiceStep onDone={onVoice} />
                <button className="ct-link self-start" onClick={() => setStep("selfie")}>Skip: use the default voice</button>
              </>
            )}

            {step === "selfie" && <SelfieStep onDone={onSelfie} />}

            {step === "thinking" && <p className="ct-title-sm" role="status">The court is reading your file…</p>}

            {step === "confirm" && (
              <>
                <span className="ct-kicker">Your file · click to correct</span>
                <ProfileChips profile={profile} onChange={setProfile} />
                <label className="flex flex-col gap-2">
                  <span className="ct-kicker">The question before the court</span>
                  <input
                    className="ct-input"
                    placeholder="Should I …?"
                    value={question}
                    autoFocus
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && toCourt()}
                  />
                </label>
                <div className="ct-htt self-start">
                  <HoldToTalk label="Hold to say your question" spacebar={false} onTranscript={setQuestion} />
                </div>
                {authConfigured &&
                  (session ? (
                    <label className="ct-small flex items-center gap-2.5">
                      <input type="checkbox" className="size-4 accent-[var(--c-brass)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                      Keep my voice, face and file with {session.user.email}
                    </label>
                  ) : (
                    <p className="ct-small">
                      Want to come back as yourself?{" "}
                      <button className="ct-link" onClick={signInToKeep}>Sign in with Google to keep your voice and face</button>
                    </p>
                  ))}
                <button className="ct-primary self-start" disabled={!question.trim() || busy} onClick={toCourt} {...aimProps}>
                  {busy ? "Entering the court…" : "Take it to court"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      <Jury roster={[...yours, ...roster, ...stored]} signedInAs={signedInAs} onPick={pickJuror} onRemove={(e) => forgetFace(e.email)} leaning={aim} compact={!menu} />
      {past.length > 0 && (
        <div className={`seam-strip${pastOpen ? " open" : ""}`} aria-hidden={!pastOpen} inert={!pastOpen}>
          <div className="grid grid-cols-2 md:grid-cols-4">
            {past.slice(0, 4).map((t) => (
              <a key={t.id} href={`/t/${t.id}`} className="flex flex-col gap-2.5 border-r border-[#2a2722] px-5 py-4 hover:bg-[#1f1b16]">
                <span className="ct-speech text-sm">{t.question}</span>
                <span className="ct-meter" aria-hidden="true"><i style={{ left: `${(t.value + 100) / 2}%` }} /></span>
                <span className={`ct-kicker ${verdictSide(t.label) === "yes" ? "!text-[var(--c-yes)]" : verdictSide(t.label) === "no" ? "!text-[var(--c-no)]" : "!text-[var(--c-stone)]"}`}>
                  {t.label} {t.value > 0 ? "+" : ""}{t.value}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}
      <div className="menu-ink" />
      <div className="scanlines" />
    </main>
  );
}
