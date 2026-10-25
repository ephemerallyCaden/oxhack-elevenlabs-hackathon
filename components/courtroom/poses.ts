// Pose cycling (animation-vision task 3), pure rules. Tuned in public/mockups/pose-cycling.html
// ("★ Your pick"). Art + head markers come from scripts/make-pose-sets.py (poses.json).
//
// While a lawyer talks, their pose changes every 1–3s, drawn from neutral poses plus poses for
// their current expression, never the same pose twice in a row. Not talking = hold the pose.
// A non-talking lawyer who becomes shocked or breaks down jumps to that pose at once.
// An interrupt sends everyone to the front-facing neutral.
import meta from '@/public/assets/poses/poses.json';
import type { CourtActor, Expression } from './expressions';

export type HeadKind = 'front' | 'side';
export type PoseAnim = 'static' | 'loop' | 'once-hold';

export interface PoseSpec {
  frames: string[];
  head: HeadKind;
  /** Head marker per frame, in the role's art px (already mirrored for the defense). */
  centres: number[][];
  anim: PoseAnim;
}

export interface RoleArt {
  width: number;
  height: number;
  faces: 'left' | 'right';
  poses: Record<string, PoseSpec>;
}

export const POSE_ART = meta.roles as Record<CourtActor, RoleArt>;
export const FRAME_MS = meta.frameMs;

/** The user's saved values from the mockup. */
export const POSE_TUNING = {
  head: 0.85, // head size ×
  front: { x: 0, y: -28 }, // front head offset from the marker, art px
  side: { x: 13, y: -46 }, // side head offset from the marker, art px
  tick: { min: 950, max: 3100 }, // ms between pose changes while talking
  artW: 250, // lawyer body width on stage, px
  judgeK: 0.66, // the Judge is drawn smaller (further back)
  /** Head rotation per pose (deg), shared by every frame; mirrored for the defense. */
  rot: { breakdown1: 45, confident1: -3.5, sweating2: 22 } as Record<string, number>,
  pedestal: { w: 181, x: -9, y: 126 }, // width, x from the face, top below the face (px)
  lawyersY: -10, // the lawyers sit 10px higher than the old placeholders
} as const;

/** Head width in pose-art px at head 1.0×. */
export const HEAD_ART_W: Record<CourtActor, number> = { prosecution: 270, defense: 270, judge: 250 };

export const REST_POSE = 'neutral1';
export const INTERRUPT_POSE = 'neutral2'; // the front-facing neutral

const NEUTRALS = ['neutral1', 'neutral2'];
type Pool = { all: string[] } | { own: string[]; weight: number; rest: string[] };
const POOLS: Record<Expression, Pool> = {
  idle: { all: NEUTRALS },
  confident: { all: ['confident1', 'confident2', ...NEUTRALS] },
  angry: { all: ['confident1', 'confident2', ...NEUTRALS] }, // no angry art: the confident set
  sweating: { all: ['sweating1', 'sweating2', ...NEUTRALS] },
  shocked: { own: ['shocked1'], weight: 0.7, rest: NEUTRALS },
  breakdown: { own: ['breakdown1'], weight: 0.7, rest: NEUTRALS },
};

const choose = (list: string[], rand: () => number) => list[Math.floor(rand() * list.length)];

/** The next pose for an expression; never `current` again. */
export function pickPose(expr: Expression, current: string, rand: () => number = Math.random): string {
  const pool = POOLS[expr] ?? POOLS.idle;
  if ('own' in pool) {
    const own = pool.own.filter((p) => p !== current);
    const rest = pool.rest.filter((p) => p !== current);
    const list = own.length && (rand() < pool.weight || !rest.length) ? own : rest;
    return choose(list, rand) ?? current;
  }
  return choose(pool.all.filter((p) => p !== current), rand) ?? current;
}

/** Delay before the next pose change while talking. */
export function nextTickMs(rand: () => number = Math.random): number {
  return POSE_TUNING.tick.min + rand() * (POSE_TUNING.tick.max - POSE_TUNING.tick.min);
}

/** Reactions jump straight to their pose (shocked → shocked1, breakdown → breakdown1). */
export function reactionPose(expr: Expression): string | undefined {
  const pool = POOLS[expr];
  return pool && 'own' in pool ? pool.own[0] : undefined;
}

/** Frame after `frame`, 200ms later: loops repeat, once-hold stops on the last frame. */
export function nextFrame(pose: PoseSpec, frame: number): number {
  const n = pose.frames.length;
  if (pose.anim === 'loop') return (frame + 1) % n;
  if (pose.anim === 'once-hold') return Math.min(n - 1, frame + 1);
  return 0;
}

export function poseOf(role: CourtActor, pose: string): PoseSpec {
  const art = POSE_ART[role];
  return art.poses[pose] ?? art.poses[REST_POSE];
}

/** Every frame image, for preloading (avoids a blank frame on the first swap). */
export const ALL_FRAMES: string[] = Object.values(POSE_ART).flatMap((r) =>
  Object.values(r.poses).flatMap((p) => p.frames),
);
