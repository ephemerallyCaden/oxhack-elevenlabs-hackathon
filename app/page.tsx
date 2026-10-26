"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { UserProfile } from "@/types";
import type { SavedUser } from "@/lib/users/store";
import VoiceStep, { sessionVoiceId, type VoiceStepResult } from "@/components/onboarding/VoiceStep";
import HoldToTalk from "@/components/HoldToTalk";
import SelfieStep, { sessionSelfie } from "@/components/onboarding/SelfieStep";
import { HEADS_KEY, useSessionHeads } from "@/components/onboarding/sessionHeads";
import Jury from "@/components/menu/Jury";
import { forgetError, seatJury } from "@/components/menu/seatJury";
import "@/components/menu/court.css";
import ProfileChips from "@/components/menu/ProfileChips";
import { parsePastTrials, pastTrialsRaw, verdictSide } from "@/components/menu/pastTrials";
import { getProfile } from "@/lib/debate/orchestrator";
import KeysPanel from "@/components/menu/KeysPanel";
import { setMockMode, useOwnKeys } from "@/lib/byok/browser";
import type { DemoListing } from "@/lib/debate/replay";
import { authConfigured, authedPost, signInWithGoogle, signOut, useSession } from "@/lib/auth/browser";
import {
  addToRoster,
  faceThumb,
  readRoster,
  removeFromRoster,
  restoreSession,
  saveDraft,
  saveOnboarding,
  sessionProfile,
  takeDraft,
  type RosterEntry,
} from "@/lib/onboarding/session";

type Step = "welcome" | "back" | "voice" | "selfie" | "thinking" | "confirm";

/** One click fills the question box: a spread of big, arguable life decisions (study, career, place, life). */
const SUGGESTED_QUESTIONS = [
  "Should I take a gap year before starting work?",
  "Should I quit my job to start my own company?",
  "Should I move to London after I graduate?",
  "Should I do a master's degree?",
  "Should I move abroad for two years?",
  "Should I get a dog?",
];

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

// The title page's jury: a full gallery, seats per pew from the back row to the front.
const GALLERY = [12, 13, 14, 15];
const noSubscribe = () => () => {};
const hasRestore = () => {
  try {
    return !!sessionStorage.getItem("roulette.draft") || new URLSearchParams(location.search).has("again");
  } catch {
    return false;
  }
};
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
  const [keysOpen, setKeysOpen] = useState(false);
  const ownKeys = useOwnKeys();
  // Which services this site has its own keys for (none on a bring-your-own-keys deployment).
  const [house, setHouse] = useState<Record<string, boolean> | null>(null);
  useEffect(() => {
    fetch("/api/keys", { method: "POST" })
      .then((r) => r.json())
      .then((d: { house: Record<string, boolean> }) => setHouse(d.house))
      .catch(() => setHouse(null));
  }, []);
  const ownAny = Object.values(ownKeys).some(Boolean);
  // Stored demo trials (public/demos): watchable with no keys at all.
  const [demos, setDemos] = useState<DemoListing[]>([]);
  const [demosOpen, setDemosOpen] = useState(false);
  useEffect(() => {
    fetch("/demos/index.json")
      .then((r) => (r.ok ? r.json() : []))
      .then((d: DemoListing[]) => setDemos(d))
      .catch(() => setDemos([]));
  }, []);
  const houseLlm = !!house && (house.groq || house.gemini || house.anthropic);
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
  // Only when there is something to restore (a draft, or ?again), the page waits for it, so "New case"
  // doesn't flash the title page on its way to the confirm step. The server render is always visible.
  const [restored, setRestored] = useState(false);
  const needsRestore = useSyncExternalStore(noSubscribe, hasRestore, () => false);
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
        setQuestion("");
        setStep("confirm");
        history.replaceState(null, "", "/");
      }
      setRestored(true);
    });
  }, []);

  // The jury: every saved face (thumbnail + first name). Decoration: a slow or failed fetch leaves silhouettes.
  const juryRequest = useRef(0);
  const forgotten = useRef(new Set<string>()); // seats removed by Forget me: other instances may still cache them
  const [myKey, setMyKey] = useState<string | undefined>(); // your own seat, while signed in
  const loadJury = useCallback(() => {
    const n = ++juryRequest.current; // a slow earlier reply must not overwrite a newer one
    fetch("/api/jury", { method: "POST", signal: AbortSignal.timeout(5000) })
      .then((r) => (r.ok ? r.json() : { jurors: [] }))
      .then(({ jurors }: { jurors: { key: string; name?: string; face: string }[] }) => {
        if (n === juryRequest.current) setStored(jurors.filter((j) => !forgotten.current.has(j.key)).map((j) => ({ email: "", key: j.key, name: j.name, face: j.face })));
      })
      .catch(() => {});
  }, []);
  useEffect(loadJury, [loadJury]);

  // Signed in → their saved file, if they kept one → "Welcome back".
  useEffect(() => {
    if (!ready || !session) return;
    let live = true;
    authedPost("/api/users/get", session)
      .then((r) => (r.ok ? r.json() : null))
      .then((res: { user: SavedUser; juryKey?: string } | null) => {
        if (!live || !res) return;
        setMyKey(res.juryKey);
        // Faces kept before jury keys existed learn theirs now, so the jury stops seating them twice.
        const mine = session.user.email && readRoster().find((r) => r.email === session.user.email);
        if (mine && res.juryKey && mine.key !== res.juryKey) {
          addToRoster({ ...mine, key: res.juryKey });
          bump((n) => n + 1);
        }
        setReturning(res.user);
        setStep((s) => (s === "welcome" ? "back" : s));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [ready, session]);

  function begin() {
    setMockMode(false); // a real trial (a mock trial earlier in this tab must not carry over)
    clearSession();
    setError(""); // a message meant for the last person
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

  const forgetting = useRef(false);
  async function forgetMe() {
    if (!session || forgetting.current) return; // a double click sends one request
    forgetting.current = true;
    setError("");
    const r = await authedPost("/api/users/delete", session, {}, AbortSignal.timeout(8000)).catch(() => null);
    forgetting.current = false;
    if (!r?.ok) {
      setError(forgetError(r?.status));
      if (r?.status === 401) {
        // Expired: this screen has no sign-in button, so sign out and show the title page (with the message).
        await signOut();
        setReturning(null);
        setStep("welcome");
      }
      return;
    }
    // Other server instances may still cache the jury for a minute: take your seat out here and now.
    const { juryKey } = (await r.json().catch(() => ({}))) as { juryKey?: string };
    if (juryKey) {
      forgotten.current.add(juryKey);
      setStored((js) => js.filter((j) => j.key !== juryKey));
    }
    setMyKey(undefined);
    if (session.user.email) removeFromRoster(session.user.email);
    await signOut();
    setReturning(null);
    clearSession();
    bump((n) => n + 1);
    setStep("welcome");
    loadJury(); // your face leaves the jury now, not in a minute
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
  // Browser Back restores this page (Cache Components / Activity) with the guard still set: release it when hidden.
  useEffect(
    () => () => {
      leaving.current = false;
      setBusy(false); // and the "Entering the court…" label
    },
    [],
  );
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
      if (r?.ok && session.user.email) {
        const { juryKey } = (await r.json().catch(() => ({}))) as { juryKey?: string };
        addToRoster({ email: session.user.email, name: profile.name, face: selfie ? await faceThumb(selfie) : undefined, key: juryKey });
      } else if (r?.status === 503) console.warn("[menu] sign-in isn't configured on the server: your voice and face weren't kept");
      else console.warn(`[menu] couldn't keep your voice and face (${r ? r.status : "timed out"}); the trial goes ahead without saving`);
    } else if (remember) {
      // Not signed in: a new jury row the visitor can't come back to (app/api/users/guest).
      const heads = sessionHeadsJson();
      const body = { profile, voiceId: sessionVoiceId() ?? null, ...(heads ? { heads } : { selfie: sessionSelfie() ?? null }) };
      const r = await fetch("/api/users/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (!r?.ok) console.warn(`[menu] couldn't put your face on the jury (${r ? r.status : "timed out"}); the trial goes ahead without saving`);
    }
    router.push("/trial");
  }

  const aimProps = { onMouseEnter: () => setAim(true), onMouseLeave: () => setAim(false), onFocus: () => setAim(true), onBlur: () => setAim(false) };

  const signedInAs = session?.user.email;
  const menu = step === "welcome" || step === "back";
  // The jury: faces kept on this laptop, plus yours once the photos are taken (not clickable).
  const yours = !menu && heads && !(signedInAs && roster.some((r) => r.email === signedInAs)) ? [{ email: "", name: profile.name || "You", face: heads.front.src }] : [];
  const pickJuror = authConfigured ? (e: RosterEntry) => e.email && e.email !== signedInAs && void signInWithGoogle(e.email) : undefined;

  return (
    <main className="court-ui" style={needsRestore && !restored ? { visibility: "hidden" } : undefined}>
      <div className="menu-bg" />
      {menu ? (
        <div className="menu-title">
          <div className="menu-actions">
            {step === "welcome" && (
              <>
                <span className="ct-kicker">Court of Future Selves</span>
                <h1 className="ct-title-sm">Your future is on trial.</h1>
                <p className="ct-body">Read one short paragraph out loud, then put your decision before the court.</p>
                {error && <p role="alert" className="ct-alert">{error}</p>}
                {house && !houseLlm && !ownAny && (
                  <p className="ct-small">This court runs on your own API keys: add yours, or watch a demo trial. Without keys the court plays its mock script.</p>
                )}
                {keysOpen && <KeysPanel onClose={() => setKeysOpen(false)} />}
                {demosOpen && (
                  <ul className="flex flex-col items-center gap-2" aria-label="Demo trials">
                    {demos.map((d) => (
                      <li key={d.id}>
                        <a className="ct-link" href={`/trial?demo=${encodeURIComponent(d.id)}`} onClick={() => setMockMode(false)}>
                          ▶ {d.title}
                        </a>
                      </li>
                    ))}
                    <li className="ct-small">Recorded from real trials{demos.some((d) => d.voiced) ? "" : " (shown as text, no voices)"}. No keys needed.</li>
                  </ul>
                )}
                <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
                  <button className="ct-primary" onClick={begin} {...aimProps}>Begin</button>
                  <button className="ct-link" onClick={() => setKeysOpen(true)}>{ownAny ? "Your keys ✓" : "Use your own keys"}</button>
                  <button className="ct-link" onClick={() => { setMockMode(false); clearSession(); router.push("/trial"); }}>Skip setup: go straight to court</button>
                  {demos.length > 0 && (
                    <button className="ct-link" aria-expanded={demosOpen} onClick={() => setDemosOpen((o) => !o)}>
                      Watch a demo trial {demosOpen ? "▴" : "▾"}
                    </button>
                  )}
                  <button className="ct-link" onClick={() => { clearSession(); setMockMode(true); router.push("/trial"); }}>Try a mock trial (no keys)</button>
                  {past.length > 0 && (
                    <button className="ct-link" aria-expanded={pastOpen} onClick={() => setPastOpen((o) => !o)}>
                      Watch a past trial {pastOpen ? "▴" : "▾"}
                    </button>
                  )}
                </div>
                {/* Always shown; greyed out until Supabase Auth is configured (NEXT_PUBLIC_SUPABASE_*). */}
                {(
                  <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t-2 border-[var(--c-oak)] pt-4">
                    {signedInAs ? (
                      <p className="ct-small">
                        Signed in as {signedInAs}. <button className="ct-link" onClick={() => (setMyKey(undefined), void signOut())}>Sign out</button>
                      </p>
                    ) : (
                      <>
                        <span className="ct-small">{roster.length ? "Been here before? Find your face in the jury, or:" : "Been here before?"}</span>
                        <button className="ct-google" disabled={!authConfigured} onClick={() => (setError(""), void signInWithGoogle())}>
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
                <div className="flex items-center justify-center gap-4">
                  {/* eslint-disable-next-line @next/next/no-img-element -- stored data URL */}
                  {returning.selfie && <img src={returning.selfie} alt="Your saved face" className="h-[92px] w-20 border-2 border-[var(--c-oak)] bg-[var(--c-wood)] object-contain" />}
                  <span className="ct-kicker">Court of Future Selves</span>
                </div>
                <h1 className="ct-title-sm">Welcome back{returning.profile.name ? `, ${returning.profile.name}` : ""}.</h1>
                <p className="ct-body">The court remembers your voice and your face.</p>
                {/* Shared demo laptop: the next person must find "someone new" as easily as "that's me". */}
                <div className="flex flex-wrap items-center justify-center gap-3">
                  <button className="ct-primary" onClick={() => welcomeBack(returning)} {...aimProps}>That’s me: ask a new question</button>
                  <button className="ct-ghost" onClick={() => void someoneNew()}>I’m someone new</button>
                </div>
                <button className="ct-link danger" onClick={() => void forgetMe()}>Forget me (delete my voice &amp; face)</button>
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
                <button className="ct-link self-start" onClick={() => {
                // The default voice means the default: drop a clone made before they changed their mind.
                try {
                  sessionStorage.removeItem("roulette.voiceId");
                } catch {}
                setStep("selfie");
              }}>Skip: use the default voice</button>
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
                    disabled={busy} // already handed to the trial: typing now would be lost
                    autoFocus
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && toCourt()}
                  />
                </label>
                <div className="flex flex-col gap-2">
                  <span className="ct-kicker">Stuck? Try one</span>
                  <div className="ct-chips">
                    {SUGGESTED_QUESTIONS.map((q) => (
                      <button key={q} type="button" className="ct-chip cursor-pointer hover:border-[var(--c-brass)]" disabled={busy} onClick={() => setQuestion(q)}>
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ct-htt self-start">
                  <HoldToTalk label="Hold to say your question" spacebar={false} onTranscript={setQuestion} />
                </div>
                {session ? (
                  <label className="ct-small flex items-center gap-2.5">
                    <input type="checkbox" className="size-4 accent-[var(--c-brass)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                    Keep my voice, face and file with {session.user.email}
                  </label>
                ) : (
                  <>
                    {heads && (
                      <label className="ct-small flex items-center gap-2.5">
                        <input type="checkbox" className="size-4 accent-[var(--c-brass)]" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                        Put my face and first name on the public jury
                      </label>
                    )}
                    {authConfigured && (
                      <p className="ct-small">
                        Want to come back as yourself?{" "}
                        <button className="ct-link" onClick={signInToKeep}>Sign in with Google to keep your voice and face</button>
                      </p>
                    )}
                  </>
                )}
                <button className="ct-primary self-start" disabled={!question.trim() || busy} onClick={toCourt} {...aimProps}>
                  {busy ? "Entering the court…" : "Take it to court"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
      {/* Kept faces are also saved users: seat each person once. Taps only on the title page (mid-onboarding a tap would throw the progress away). */}
      <Jury
        roster={seatJury({ yours, roster, stored, signedInAs, myKey })}
        signedInAs={signedInAs}
        onPick={menu ? pickJuror : undefined}
        onRemove={menu ? (e) => forgetFace(e.email) : undefined}
        leaning={aim}
        compact={!menu}
        pews={menu ? GALLERY : undefined}
      />
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
