// Camera shots + the whip pan between them (pure maths, no DOM). Owner: C.
// Tuned in public/mockups/punch-shot-pick.html: every move between camera states is a
// 200ms very-fast-start (outExpo) pan with a horizontal motion blur that peaks mid-move.
import type { Scene } from '@/types';

export interface Shot {
  S: number; // zoom
  tx: number; // translate px, applied before the zoom (CSS: scale(S) translate(tx, ty))
  ty: number;
}

/* From the face centres at the markers (prosecution (223.7, 343.7), defense (734.4, 343.7),
   judge (480, 283)): lawyers framed 11% off-centre ("facing each other"), judge centred, faces
   at the effective-viewport vertical centre (210.6px, textbox excluded). Witness: 1.4×, lawyers'
   midpoint pulled up. Originally translate(%) of the 960×540 stage; stored here in px. */
export const SHOT: Record<Scene, Shot> = {
  yes: { S: 2.2, tx: 0.217 * 960, ty: -0.186 * 540 },
  no: { S: 2.2, tx: -0.215 * 960, ty: -0.186 * 540 },
  judge: { S: 2.0, tx: 0, ty: -0.079 * 540 },
  witness: { S: 1.4, tx: 0.001 * 960, ty: -0.143 * 540 },
  cutscene: { S: 1.4, tx: 0.001 * 960, ty: -0.143 * 540 },
};

export const WHIP = { ms: 200, blurPx: 10 } as const;

export const shotCss = ({ S, tx, ty }: Shot) => `scale(${S}) translate(${tx}px, ${ty}px)`;

/** Very fast start, long settle. */
export const outExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));

/** Camera pose `t` ∈ [0,1] of the way through a whip from `a` to `b` (zoom interpolated geometrically). */
export function whipAt(a: Shot, b: Shot, t: number): Shot {
  const p = outExpo(Math.min(1, Math.max(0, t)));
  return {
    S: Math.exp(Math.log(a.S) + (Math.log(b.S) - Math.log(a.S)) * p),
    tx: a.tx + (b.tx - a.tx) * p,
    ty: a.ty + (b.ty - a.ty) * p,
  };
}

/** Horizontal motion blur (px) at `t`: zero at both ends, peak mid-move. */
export const whipBlur = (t: number) => WHIP.blurPx * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

export const sameShot = (a: Shot, b: Shot) =>
  Math.abs(a.S - b.S) < 1e-6 && Math.abs(a.tx - b.tx) < 1e-3 && Math.abs(a.ty - b.ty) < 1e-3;
