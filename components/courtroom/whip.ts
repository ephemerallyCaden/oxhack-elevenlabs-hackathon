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

/* The OBJECTION! pull-back (animation-vision #5), tuned in public/mockups/interrupt-objection.html:
   a hard zoom out to the wide shot (overshooting it, then settling) while a radial black vignette
   closes in, and everyone turns to face the user, the interrupted lawyer first. */
export const OBJECTION = {
  shot: { S: 1.0, tx: 0, ty: -64 },
  ms: 420,
  overshoot: 0.1,
  vignette: { max: 0.9, inner: 18 },
  turnMs: 110,
  staggerMs: 70,
  shake: { px: 12, ms: 320 },
} as const;

export const shotCss = ({ S, tx, ty }: Shot) => `scale(${S}) translate(${tx}px, ${ty}px)`;

/** Very fast start, long settle. */
export const outExpo = (t: number) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const inOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** `p` of the way from `a` to `b` (zoom interpolated geometrically). */
function lerpShot(a: Shot, b: Shot, p: number): Shot {
  return {
    S: Math.exp(Math.log(a.S) + (Math.log(b.S) - Math.log(a.S)) * p),
    tx: a.tx + (b.tx - a.tx) * p,
    ty: a.ty + (b.ty - a.ty) * p,
  };
}

/** Camera pose `t` ∈ [0,1] of the way through a whip from `a` to `b`. */
export function whipAt(a: Shot, b: Shot, t: number): Shot {
  return lerpShot(a, b, outExpo(clamp01(t)));
}

/** Camera pose `t` ∈ [0,1] through the objection pull-back: past `b` by `overshoot` (in zoom), then back. */
export function objectionAt(a: Shot, b: Shot, t: number, overshoot: number = OBJECTION.overshoot): Shot {
  t = clamp01(t);
  if (t >= 1) return { ...b };
  const split = overshoot ? 0.7 : 1;
  const past = { ...b, S: Math.exp(Math.log(b.S) + (Math.log(b.S) - Math.log(a.S)) * overshoot) };
  return t < split ? lerpShot(a, past, outExpo(t / split)) : lerpShot(past, b, inOutQuad((t - split) / (1 - split)));
}

/** The vignette at zoom `S` during a pull-back that started at zoom `fromS`: the further out, the darker. */
export function vignetteAt(fromS: number, S: number, toS: number = OBJECTION.shot.S) {
  const span = Math.log(fromS) - Math.log(toS);
  const p = span < 1e-6 ? 1 : Math.min(1.15, Math.max(0, (Math.log(fromS) - Math.log(S)) / span));
  const { max, inner } = OBJECTION.vignette;
  return { alpha: Math.min(1, max * p), inner: 78 + (inner - 78) * Math.min(1, p) };
}

/** farthest-side: the gradient's 100% stop sits on the stage edges, so the darkness is on screen. */
export const vignetteCss = ({ alpha, inner }: { alpha: number; inner: number }) =>
  `radial-gradient(ellipse farthest-side at 50% 46%, rgba(0,0,0,0) ${inner}%, rgba(0,0,0,${(alpha * 0.6).toFixed(3)}) ${inner + (100 - inner) * 0.55}%, rgba(0,0,0,${alpha.toFixed(3)}) 100%)`;

/** Horizontal motion blur (px) at `t`: zero at both ends, peak mid-move. */
export const whipBlur = (t: number) => WHIP.blurPx * Math.sin(Math.PI * Math.min(1, Math.max(0, t)));

export const sameShot = (a: Shot, b: Shot) =>
  Math.abs(a.S - b.S) < 1e-6 && Math.abs(a.tx - b.tx) < 1e-3 && Math.abs(a.ty - b.ty) < 1e-3;
