// Head cut-outs sitting behind the pose art: a front head (blue markers) and a side head
// (red markers, facing right; mirrored for the defense). Onboarding captures both from the
// user's photos (components/onboarding/SelfieStep.tsx); the defaults were captured once.
//
// Both heads share one frame so their heights always match: the front head fills 248×287
// (hair to chin); the side head is 305×347 with hair at the top and the chin at 287px (the
// neck hangs below). Coordinates are fractions of the frame, so any image resolution works.
export interface HeadSpec {
  src: string;
  /** Frame size in head px (fixed per kind; see above). */
  w: number;
  h: number;
  /** Upper lip line: the jaw splits here. */
  lipY: number;
  /** Head centre, as a fraction of the frame height (the side frame has a neck below). */
  anchorY: number;
  /** Eye centres [x, y]: two for the front head, the one visible eye for the side head. */
  eyes: [number, number][];
}

export interface Heads {
  front: HeadSpec;
  side: HeadSpec;
}

export const FRONT_FRAME = { w: 248, h: 287 } as const;
export const SIDE_FRAME = { w: 305, h: 347, chin: 287 } as const;

export const DEFAULT_HEADS: Heads = {
  front: { src: '/assets/heads/head-front.webp', ...FRONT_FRAME, lipY: 0.858, anchorY: 0.5, eyes: [[0.33, 0.482], [0.687, 0.49]] },
  side: { src: '/assets/heads/head-side.webp', w: SIDE_FRAME.w, h: SIDE_FRAME.h, lipY: 0.662, anchorY: 0.414, eyes: [[0.85, 0.445]] },
};
