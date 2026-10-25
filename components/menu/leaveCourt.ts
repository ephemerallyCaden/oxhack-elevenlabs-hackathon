// Leaving the court from the verdict (or a broken trial): always a full page load, never router.push,
// because Cache Components would restore the kept-alive menu and trial pages with the last person's
// state. sessionStorage survives it, so "New case" (/?again=1) keeps the voice, faces and profile.
// "Main menu" (/) means this person is done: sign out (never waiting more than 1.5s on the network)
// and clear this tab's trial hand-off, so the next person at the laptop starts clean.

export interface LeaveDeps {
  signOut: () => Promise<void>;
  assign: (href: string) => void;
  storage?: Storage;
  waitMs?: number;
}

let leaving = false;

export async function leaveCourt(href: string, deps: LeaveDeps): Promise<void> {
  if (leaving) return; // a second click while signing out
  leaving = true;
  try {
    if (href === '/') {
      await Promise.race([deps.signOut().catch(() => {}), new Promise((r) => setTimeout(r, deps.waitMs ?? 1500))]);
      try {
        const s = deps.storage ?? sessionStorage;
        for (const k of Object.keys(s)) if (k.startsWith('roulette.') || k.startsWith('sb-roulette-auth')) s.removeItem(k);
      } catch {
        // private mode: nothing stored anyway
      }
    }
  } finally {
    leaving = false;
    deps.assign(href);
  }
}

/** A page restored from the back/forward cache (Back after "Main menu") reloads instead. Returns the cleanup. */
export function reloadIfRestored(win: Pick<Window, 'addEventListener' | 'removeEventListener' | 'location'> = window): () => void {
  const onShow = (e: PageTransitionEvent) => {
    if (e.persisted) win.location.reload();
  };
  win.addEventListener('pageshow', onShow as EventListener);
  return () => win.removeEventListener('pageshow', onShow as EventListener);
}
