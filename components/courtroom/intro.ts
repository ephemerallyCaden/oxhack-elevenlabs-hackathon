// Crane-up intro: geometry + motion maths (pure, no DOM). Owner: C.
// Tuned in public/mockups/intro-crane.html ("★ Your pick"); depth planes are cut by
// scripts/make-intro-layers.py from public/assets/courtroom-bg-tall.png.
import layerMeta from '@/public/assets/intro-layers/layers.json';

/* Tall image px → stage px (960×540): x = KX·(X − OX), y = KY·(Y − OY) − 18.
   From template-matching the old courtroom-bg.png inside the tall image (score 0.994),
   so the planes at rest reproduce today's framing exactly. */
const KX = 0.978369;
const KY = 0.958622;
const OX = -45.18375;
const OY = 230.870625;

export const ORIGIN = { x: 480, y: 270 }; // camera transform-origin (stage centre)
export const VP = { x: 480.6, y: 259.2 }; // vanishing point (throne / centre window)
const IMG_BOTTOM = 1024.14; // stage y of the tall image's bottom row
const WITNESS = { S: 1.4, cx: ORIGIN.x - 0.96, cy: ORIGIN.y + 77.22 }; // = CAMERA.witness

export const INTRO = {
  parallax: 2.5, // global depth multiplier (P)
  craneParallax: 105, // px the nearest plane is lifted at the start (Dp)
  pushParallax: 0.14, // how much smaller the nearest plane starts (Zp)
  blur: 0.4,
  ghosts: 4,
  moveMs: 490,
  startZoom: 1.1,
  pullBack: 0.3, // mid-move zoom-out that opens the room up
  beatMs: 450,
  springMs: 300,
  shake: { px: 6, ms: 220 },
} as const;

export interface PlaneSpec {
  name: string;
  file: string;
  weight: number; // 0 = far wall … 1 = nearest carpet
  style: { left: number; top: number; width: number; height: number };
}

export const PLANES: PlaneSpec[] = layerMeta.layers.map((L) => ({
  name: L.name,
  file: L.file,
  weight: L.weight,
  style: { left: KX * (L.x - OX), top: KY * (L.y - OY) - 18, width: KX * L.w, height: KY * L.h },
}));

export interface CamPose {
  S: number;
  cx: number; // visible centre, stage px
  cy: number;
}

/** Flat camera along the carpet → witness path. e ∈ [0,1]; > 1 during the landing overshoot. */
export function pathAt(e: number): CamPose {
  const S0 = INTRO.startZoom;
  const c0 = { x: 480.6, y: IMG_BOTTOM - ORIGIN.y / S0 }; // start: bottom of the frame on the image's bottom row
  const dip = 1 - INTRO.pullBack * Math.sin(Math.PI * Math.min(1, Math.max(0, e)));
  return {
    S: Math.exp(Math.log(S0) + (Math.log(WITNESS.S) - Math.log(S0)) * e) * dip,
    cx: c0.x + (WITNESS.cx - c0.x) * e,
    cy: c0.y + (WITNESS.cy - c0.y) * e,
  };
}

export function camTransform({ S, cx, cy }: CamPose): string {
  return `scale(${S}) translate(${ORIGIN.x - cx}px, ${ORIGIN.y - cy}px)`;
}

/** Where the vanishing point lands on screen for a camera pose (centre of the zoom blur). */
export function vpOnScreen({ S, cx, cy }: CamPose) {
  return { x: ORIGIN.x + S * (VP.x - cx), y: ORIGIN.y + S * (VP.y - cy) };
}

/** Per-plane parallax around the vanishing point. r = 1 − e (0 at rest → identity). */
export function planeOffset(weight: number, r: number) {
  const k = INTRO.parallax * weight * r;
  return { dy: -k * INTRO.craneParallax, scale: 1 - k * INTRO.pushParallax };
}

export function planeTransform(weight: number, r: number): string {
  const { dy, scale } = planeOffset(weight, r);
  return `translateY(${dy}px) scale(${scale})`;
}

/** Zoom-blur strength from path velocity (path-lengths per move; 1 = constant speed). */
export function blurAmount(velocity: number): number {
  return INTRO.blur * Math.min(1, Math.abs(velocity) / 2.5);
}

/** Damped overshoot past the landing: path position for τ ms after arrival. */
export function springAt(tauMs: number): number {
  return 1 + 0.06 * Math.exp(-tauMs / 80) * Math.sin((2 * Math.PI * tauMs) / 220);
}
