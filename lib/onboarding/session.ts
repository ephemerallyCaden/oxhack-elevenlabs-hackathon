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

/** The confirmed question, removed once read so a refresh doesn't restart the trial. */
export function takeSessionQuestion(): string | undefined {
  const h = read();
  if (h.question) saveOnboarding({ ...h, question: undefined });
  return h.question;
}
