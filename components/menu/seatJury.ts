// Who sits in the jury, in seat order: your new face (onboarding, no account yet), then the faces kept
// on this laptop (tappable), then everyone saved on the server. Each person sits once: a server seat
// is dropped when this laptop already shows that person (same jury key), or when it's your own seat
// while your new face is on show as "You".
import type { RosterEntry } from '@/lib/onboarding/session';

export function seatJury(opts: {
  yours: RosterEntry[];
  roster: RosterEntry[];
  stored: RosterEntry[];
  signedInAs?: string;
  myKey?: string;
}): RosterEntry[] {
  const { yours, roster, stored, signedInAs, myKey } = opts;
  const onLaptop = new Set(roster.map((r) => r.key).filter(Boolean));
  return [
    ...yours,
    ...roster,
    ...stored.filter((j) => !(j.key && onLaptop.has(j.key)) && !(signedInAs && myKey && j.key === myKey && yours.length)),
  ];
}

/** What "Forget me" tells the user when it failed. */
export function forgetError(status: number | undefined): string {
  return status === 401
    ? "Your sign-in had expired, so you've been signed out. Sign in with Google again, then use Forget me."
    : "The court couldn’t delete your voice and face just now. Nothing was removed; try again.";
}
