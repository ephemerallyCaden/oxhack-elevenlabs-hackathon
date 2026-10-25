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

/** Returning user: put their saved voice + faces back where VoiceStep / SelfieStep would have left them. */
export function restoreSession(u: { voiceId: string | null; selfie: string | null; heads?: { front: { src: string } } | null }) {
  try {
    if (u.voiceId) sessionStorage.setItem("roulette.voiceId", u.voiceId); // = VoiceStep's key
    if (u.selfie) sessionStorage.setItem("roulette.selfie", u.selfie); // = SelfieStep's key
    if (u.heads) sessionStorage.setItem("roulette.heads", JSON.stringify(u.heads)); // = sessionHeads' key
  } catch {
    // private mode: defaults
  }
}

// Faces on this laptop: who has signed in with Google and kept their voice + face here. Tapping a
// face starts Google sign-in for that account; "Forget me" or × removes it.
/** `key`: the opaque jury key from the save (so the jury doesn't seat you twice). */
export type RosterEntry = { email: string; name?: string; face?: string; key?: string };
const ROSTER_KEY = "roulette.roster";
export function readRoster(): RosterEntry[] {
  try {
    return JSON.parse(localStorage.getItem(ROSTER_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeRoster(r: RosterEntry[]) {
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(r));
  } catch {
    // private mode / full: not remembered on this laptop
  }
}
export function addToRoster(e: RosterEntry) {
  writeRoster([e, ...readRoster().filter((x) => x.email !== e.email)].slice(0, 8));
}
export function removeFromRoster(email: string) {
  writeRoster(readRoster().filter((x) => x.email !== email));
}

/** A small thumbnail of the face for the roster (the full cut-out stays server-side). */
export function faceThumb(src: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.height = 112;
      c.width = Math.round((112 * img.width) / img.height);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/webp", 0.8));
    };
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

// The confirm step survives the round trip to Google: saved before leaving, restored on return.
const DRAFT_KEY = "roulette.draft";
export function saveDraft(d: { profile: UserProfile; question: string }) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    // private mode: the confirm step starts empty again
  }
}
export function takeDraft(): { profile: UserProfile; question: string } | null {
  try {
    const d = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return d ? JSON.parse(d) : null;
  } catch {
    return null;
  }
}

/** The confirmed question, removed once read so a refresh doesn't restart the trial. */
export function takeSessionQuestion(): string | undefined {
  const h = read();
  if (h.question) saveOnboarding({ ...h, question: undefined });
  return h.question;
}
