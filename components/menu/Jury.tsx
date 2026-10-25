'use client';
/* eslint-disable @next/next/no-img-element -- head cut-outs and stored thumbnails */
// The jury box along the bottom of the menu: two pews of front-facing heads peeking over the
// backrests. People who kept their face on this laptop sit in colour with a nameplate (tap your
// face to sign in); empty seats are silhouettes, so the jury fills up as the court is used.
import type { RosterEntry } from '@/lib/onboarding/session';

const DEFAULT_HEAD = '/assets/heads/head-front.webp';
const BACK = 7; // seats per pew
const FRONT = 8;

// Small per-seat variety so the silhouettes don't read as one stamp: [dx px, dy px, scale, tilt deg].
const JITTER: [number, number, number, number][] = [
  [0, 2, 1, -2], [4, 0, 0.94, 1], [-3, 3, 1.04, 0], [2, 1, 0.97, 2], [-2, 0, 1.02, -1],
  [3, 2, 0.95, 0], [-4, 1, 1, 2], [1, 3, 1.03, -2], [-1, 0, 0.98, 1],
];

type Seat = { entry?: RosterEntry; signedIn?: boolean };

/** Nameplate text: the first name, else the email's name part; empty for an anonymous juror. */
const plate = (e: RosterEntry) => e.name || e.email.split('@')[0];

export default function Jury({
  roster,
  signedInAs,
  onPick,
  onRemove,
  leaning = false,
  compact = false,
}: {
  roster: RosterEntry[];
  signedInAs?: string;
  /** Tap a face: sign in as that person (absent when sign-in isn't available). */
  onPick?: (e: RosterEntry) => void;
  /** × on a kept face: take it off this laptop (no sign-in needed). */
  onRemove?: (e: RosterEntry) => void;
  /** The visitor is reaching for the main action: the jury leans in. */
  leaning?: boolean;
  /** Onboarding steps: just the front pew, lower. */
  compact?: boolean;
}) {
  // Kept faces take the middle of the front pew first, then the back pew.
  const front: Seat[] = Array.from({ length: FRONT }, () => ({}));
  const back: Seat[] = Array.from({ length: BACK }, () => ({}));
  const order = (n: number) => Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(a - (n - 1) / 2) - Math.abs(b - (n - 1) / 2));
  const slots = [...order(FRONT).map((i) => front[i]), ...order(BACK).map((i) => back[i])];
  roster.slice(0, slots.length).forEach((entry, i) => {
    slots[i].entry = entry;
    slots[i].signedIn = entry.email === signedInAs;
  });

  const pew = (seats: Seat[], row: 'back' | 'front') => (
    <div className={`jury-pew jury-${row}`}>
      <div className="jury-heads">
        {seats.map((s, i) => {
          const [dx, dy, k, rot] = JITTER[(i + (row === 'back' ? 4 : 0)) % JITTER.length];
          const style = { '--dx': `${dx}px`, '--dy': `${dy}px`, '--k': k, '--rot': `${rot}deg`, '--delay': `${-(i * 0.37 + (row === 'back' ? 0.2 : 0))}s` } as React.CSSProperties;
          const name = s.entry && (plate(s.entry) || 'a juror');
          if (!s.entry) return <span key={i} className="juror empty" style={style} aria-hidden="true"><img src={DEFAULT_HEAD} alt="" /></span>;
          const face = <img src={s.entry.face ?? DEFAULT_HEAD} alt="" />;
          const entry = s.entry;
          return (
            <span key={i} className={`juror kept${s.signedIn ? ' me' : ''}`} style={style}>
              {onPick && entry.email && !s.signedIn ? (
                <button className="juror-pick" onClick={() => onPick(entry)} aria-label={`Sign in as ${name}`}>{face}</button>
              ) : (
                face
              )}
              {onRemove && entry.email && (
                <button className="juror-x" onClick={() => onRemove(entry)} aria-label={`Remove ${name} from this laptop (they stay in the public jury until they use Forget me)`} title="Remove from this laptop">×</button>
              )}
            </span>
          );
        })}
      </div>
      <div className="jury-rail" />
      {/* Nameplates on the rail, one slot per seat (same widths as the heads row, so they line up). */}
      <div className="jury-plates" aria-hidden="true">
        {seats.map((s, i) => (
          <span key={i} className="jury-slot">{s.entry && plate(s.entry) && <span className="juror-plate">{plate(s.entry)}</span>}</span>
        ))}
      </div>
      <div className="jury-backrest" />
    </div>
  );

  return (
    <div className={`jury${leaning ? ' leaning' : ''}${compact ? ' compact' : ''}`}>
      {!compact && pew(back, 'back')}
      {pew(front, 'front')}
    </div>
  );
}
