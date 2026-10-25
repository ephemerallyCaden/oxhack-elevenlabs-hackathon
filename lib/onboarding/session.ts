// Hand-off from onboarding (/) to the trial (/trial), kept in sessionStorage for this tab only.
// The cloned voice id itself is stored by VoiceStep (sessionVoiceId()).
import type { UserProfile } from "@/types";

const KEY = "roulette.onboarding";

type Handoff = { profile?: UserProfile; question?: string };

function read(): Handoff {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function saveOnboarding(h: Handoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(h));
  } catch {
    // private mode: the trial just starts without a profile
  }
}

export function sessionProfile(): UserProfile | undefined {
  return read().profile;
}

/** Returning user: put their saved voice + selfie back where VoiceStep / SelfieStep would have left them. */
export function restoreSession(u: { voiceId: string | null; selfie: string | null }) {
  try {
    if (u.voiceId) sessionStorage.setItem("roulette.voiceId", u.voiceId); // = VoiceStep's key
    if (u.selfie) sessionStorage.setItem("roulette.selfie", u.selfie); // = SelfieStep's key
  } catch {
    // private mode: defaults
  }
}

// "Remember me": this browser's user id, in localStorage (survives closing the tab).
const USER_KEY = "roulette.userId";
export function rememberedUserId(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}
export function setRememberedUserId(id: string | null) {
  try {
    if (id) localStorage.setItem(USER_KEY, id);
    else localStorage.removeItem(USER_KEY);
  } catch {
    // private mode: not remembered
  }
}

/** The confirmed question, removed once read so a refresh doesn't restart the trial. */
export function takeSessionQuestion(): string | undefined {
  const h = read();
  if (h.question) saveOnboarding({ ...h, question: undefined });
  return h.question;
}
