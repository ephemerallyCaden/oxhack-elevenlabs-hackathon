// The spectrum HUD's rules (pure, no DOM). Owner: C. Tuned in public/mockups/spectrum-bar.html.
// A diverging blocky meter: 10 blocks each side of a fixed centre notch, one block per 10 points;
// the fill grows from the centre toward whoever is winning (NO red left, YES blue right).
import { spectrumLabel } from '@/lib/debate/spectrum';

export const BAR = {
  side: 10, // blocks per side
  pitch: 14, // block 12px + 2px gap (stage px)
  blockMs: 45, // per block on a ruling
  reweighMs: 85, // per block on an agenda change (slower, so it reads differently)
  swingAt: 25, // a ruling this big also shakes the HUD
  chipMs: 900,
  holdMs: 55, // per strain step when the marker holds
} as const;

/** Blocks lit from the centre: −10 (all NO) … +10 (all YES). */
export const blocksOf = (value: number) => Math.sign(value) * Math.round(Math.min(100, Math.abs(value)) / 10);

export const labelOf = (value: number) => spectrumLabel(value).toUpperCase();

/** What moved the bar: a topic ruling, an agenda change (re-weigh), or the verdict. */
export type BarCause = 'ruling' | 'reweigh' | 'verdict';

export interface BarState {
  value: number;
  /** Topics with a score so far: a new one means a ruling just landed. */
  scored: number;
  verdict: boolean;
}

/** The event between two states, or null if nothing the bar shows changed. */
export function causeOf(prev: BarState, next: BarState): BarCause | null {
  if (next.verdict && !prev.verdict) return 'verdict';
  if (next.scored > prev.scored) return 'ruling'; // even with no change in value: the bar "holds"
  if (next.value !== prev.value) return 'reweigh';
  return null;
}

export type Tone = 'yes' | 'no' | 'gold' | 'grey';

export interface MovePlan {
  from: number;
  to: number;
  /** The fill doesn't change by a whole block: the marker strains and holds. */
  hold: boolean;
  /** Crosses the centre: drain to 0, burst, then fill the other side. */
  lead: boolean;
  /** Big ruling: shake the HUD. */
  swing: boolean;
  /** Ends against an end cap (±100): crash and bounce. */
  wall: boolean;
  chip: { text: string; tone: Tone; big: boolean } | null;
  /** Needle sound for a ruling/verdict move; re-weighs are quieter. */
  sound: 'needle_up' | 'needle_down' | 'blip';
}

const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;

export function planMove(from: number, to: number, cause: BarCause): MovePlan {
  to = Math.max(-100, Math.min(100, Math.round(to)));
  const d = to - from;
  const reweigh = cause === 'reweigh';
  const hold = blocksOf(to) === blocksOf(from);
  const lead = !hold && Math.sign(from) !== 0 && Math.sign(to) !== 0 && Math.sign(from) !== Math.sign(to) && blocksOf(from) !== 0;
  const swing = !reweigh && !hold && Math.abs(d) >= BAR.swingAt;
  const tone: Tone = d > 0 ? 'yes' : d < 0 ? 'no' : 'gold';
  const chip = hold
    ? { text: d === 0 ? 'HOLDS' : signed(d), tone, big: false }
    : lead
      ? { text: 'LEAD CHANGE!', tone: 'gold' as Tone, big: true }
      : reweigh
        ? { text: 'RE-WEIGHED', tone: 'grey' as Tone, big: false }
        : { text: swing ? `SWING! ${signed(d)}` : signed(d), tone, big: swing };
  return {
    from,
    to,
    hold,
    lead,
    swing,
    wall: !hold && Math.abs(blocksOf(to)) === BAR.side,
    chip: d === 0 && cause === 'verdict' ? null : chip,
    sound: reweigh ? 'blip' : d >= 0 ? 'needle_up' : 'needle_down',
  };
}

/** Who the verdict went to: a toss-up keeps the frame gold. */
export const verdictSide = (value: number): 'yes' | 'no' | 'tie' => (Math.abs(value) < 20 ? 'tie' : value > 0 ? 'yes' : 'no');
