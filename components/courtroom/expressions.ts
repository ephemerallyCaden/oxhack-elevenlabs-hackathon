// Expression derivation + face calibration. Owner: C.
// Expressions are DERIVED from the Line stream — no contract change in types.ts.
//
// Two independent channels per character:
//   expression — sticky reaction state, set by events, held until cleared
//   talking    — mouth/jaw + body bob, on while that character's line plays
// They compose: a shocked character stays shocked while delivering a comeback.
import type { Line, Spectrum, Speaker, Topic, Verdict } from '@/types';

export type Expression = 'idle' | 'confident' | 'sweating' | 'shocked' | 'angry' | 'breakdown';
export type CourtActor = Exclude<Speaker, 'user'>;

export interface CharacterMood {
  expression: Expression;
  talking: boolean;
}

/**
 * Precomputed MediaPipe calibration for the demo face (public/assets/face.png).
 * Measured once from mockup-expressions.html (headless run, 2026-10-24):
 *   upper lip 87.0%, eyes viewer-left (36.8%, 53.3%) / viewer-right (62.3%, 54.0%).
 * When live onboarding selfies land, detection runs once at onboarding and
 * replaces these per-user.
 */
export const FACE_CAL = {
  lipY: 0.87,
  /** jaw clip overlaps the upper part by 2% to hide the seam */
  jawOverlap: 0.02,
  eyeViewerLeft: { x: 0.368, y: 0.533 },
  eyeViewerRight: { x: 0.623, y: 0.54 },
  /** eyebrows sit 14% of face height above the eye line */
  browLift: 0.14,
} as const;

/** The slice of TrialState the derivation needs (keeps tests tiny). */
export interface MoodInputs {
  phase: 'ask' | 'preparing' | 'speaking' | 'listening' | 'thinking' | 'done';
  current?: Line;
  /** Every line said so far, oldest first (includes `current`). */
  transcript: Line[];
  interruptTarget?: Speaker;
  agenda: Topic[];
  spectrum: Spectrum;
  verdict?: Verdict;
}

const TOSS_UP_SPECTRUM = 10; // |spectrum| below this → nobody gloats
const TOSS_UP_TOPIC = 0.1; // |topic t| below this → no reaction

type Exprs = Record<CourtActor, Expression>;

const other = (who: 'prosecution' | 'defense') => (who === 'prosecution' ? 'defense' : 'prosecution');

/** Winner/loser reaction for a signed result (+ = YES/prosecution). */
function react(e: Exprs, value: number, threshold: number, loserExpr: Expression) {
  if (Math.abs(value) < threshold) {
    e.prosecution = 'idle';
    e.defense = 'idle';
    return;
  }
  const winner = value > 0 ? 'prosecution' : 'defense';
  e[winner] = 'confident';
  e[other(winner)] = loserExpr;
}

/**
 * Event rules (applied in transcript order; state persists between lines):
 *   argument      → a fresh turn: all reactions clear
 *   cut_in by X   → X angry, the cut-off lawyer shocked
 *   resume        → no change (the cut-off side stays shocked while it talks back)
 *   answer by X   → X angry (answering the user's challenge)
 *   score         → topic winner confident, loser sweating (held through the next intro)
 *   verdict       → winner confident, loser breakdown
 *   opening / intro / user / agenda_change → no change
 * Overlay: while the user is interrupting (listening), the target is angry.
 */
export function deriveMoods(s: MoodInputs): Record<CourtActor, CharacterMood> {
  const e: Exprs = { prosecution: 'idle', defense: 'idle', judge: 'idle' };

  for (const line of s.transcript) {
    switch (line.kind) {
      case 'argument':
        e.prosecution = e.defense = e.judge = 'idle';
        break;
      case 'cut_in':
        if (line.speaker === 'prosecution' || line.speaker === 'defense') {
          e[line.speaker] = 'angry';
          e[other(line.speaker)] = 'shocked';
        }
        break;
      case 'answer':
        if (line.speaker !== 'user') e[line.speaker] = 'angry';
        break;
      case 'score': {
        const t = s.agenda.find((topic) => topic.id === line.topic_id)?.score?.t ?? 0;
        react(e, t, TOSS_UP_TOPIC, 'sweating');
        break;
      }
      case 'verdict':
        react(e, (s.verdict?.spectrum ?? s.spectrum).value, TOSS_UP_SPECTRUM, 'breakdown');
        break;
    }
  }

  if (s.phase === 'listening' && s.interruptTarget && s.interruptTarget !== 'user') {
    e[s.interruptTarget] = 'angry';
  }

  const talking = (who: CourtActor) => s.phase === 'speaking' && s.current?.speaker === who;
  return {
    prosecution: { expression: e.prosecution, talking: talking('prosecution') },
    defense: { expression: e.defense, talking: talking('defense') },
    judge: { expression: e.judge, talking: talking('judge') },
  };
}
