// Head cut-outs from the onboarding photos: MediaPipe person segmentation (background removal)
// + face landmarks (eyes, mouth, chin). Each photo is cropped into the shared head frame
// (components/courtroom/heads.ts): front = hair to chin; side = hair at the top, chin at 287/347.
// No vision (blocked, offline, > 5s) → the guide box with an oval mask and the default calibration.
import { DEFAULT_HEADS, FRONT_FRAME, SIDE_FRAME, type HeadSpec } from '@/components/courtroom/heads';

export interface Mask {
  data: Float32Array; // person confidence 0..1, row-major
  width: number;
  height: number;
}
export interface Pt {
  x: number;
  y: number;
}
export interface Box {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}
/** Landmarks we need, in image px. */
export interface FacePts {
  chin: Pt;
  left: Pt; // cheek edges
  right: Pt;
  mouth: Pt;
  eyes: [Pt, Pt];
}
/** Proportions measured on the front photo, reused for the side photo (same person, same distance). */
export interface FrontFit {
  hc: number; // hair-to-chin height, image px
  lip: number; // mouth line, fraction of hair-to-chin
  eye: number; // eye line, fraction of hair-to-chin
}

const THR = 0.5;
const at = (m: Mask, x: number, y: number) =>
  m.data[Math.min(m.height - 1, Math.max(0, Math.round(y))) * m.width + Math.min(m.width - 1, Math.max(0, Math.round(x)))];

/** First row (from the top) where the person covers any column in [x0, x1]. */
export function hairTop(m: Mask, x0: number, x1: number, yMax = m.height): number {
  for (let y = 0; y < yMax; y++) {
    for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(m.width - 1, x1); x++) if (at(m, x, y) > THR) return y;
  }
  return 0;
}

/** Make sure the mask means "person" (high confidence on the face point); flip it if not. */
export function asPerson(m: Mask, face: Pt): Mask {
  if (at(m, face.x, face.y) >= THR) return m;
  return { ...m, data: m.data.map((v) => 1 - v) };
}

/** Leftmost / rightmost person pixel on a row. */
export function rowExtent(m: Mask, y: number): [number, number] | null {
  let l = -1;
  let r = -1;
  for (let x = 0; x < m.width; x++) {
    if (at(m, x, y) > THR) {
      if (l < 0) l = x;
      r = x;
    }
  }
  return l < 0 ? null : [l, r];
}

/** Front photo: crop hair → chin into the 248×287 frame, centred between the cheeks. */
export function frontFit(face: FacePts, hair: number): { box: Box; spec: Omit<HeadSpec, 'src'>; fit: FrontFit } {
  const hc = face.chin.y - hair;
  const sw = (hc * FRONT_FRAME.w) / FRONT_FRAME.h;
  const sx = (face.left.x + face.right.x) / 2 - sw / 2;
  const box = { sx, sy: hair, sw, sh: hc };
  const eyes = [...face.eyes].sort((a, b) => a.x - b.x).map((e) => [(e.x - sx) / sw, (e.y - hair) / hc] as [number, number]);
  const lip = (face.mouth.y - hair) / hc;
  const eye = (eyes[0][1] + eyes[1][1]) / 2;
  return { box, spec: { ...FRONT_FRAME, lipY: lip, anchorY: 0.5, eyes }, fit: { hc, lip, eye } };
}

/**
 * Side photo (the user turned to their right; the mirrored photo faces right): hair from the
 * mask, head height from the front photo, head centred on the mask between hair and chin.
 */
export function sideFit(m: Mask, front: FrontFit): { box: Box; spec: Omit<HeadSpec, 'src'> } | null {
  const hair = hairTop(m, m.width * 0.1, m.width * 0.9);
  const rows: [number, number][] = [];
  for (let y = hair; y < Math.min(m.height, hair + front.hc); y += 2) {
    const e = rowExtent(m, y);
    if (e) rows.push(e);
  }
  if (rows.length < 4) return null;
  const mids = rows.map(([l, r]) => (l + r) / 2).sort((a, b) => a - b);
  const cx = mids[Math.floor(mids.length / 2)];
  const k = front.hc / SIDE_FRAME.chin; // image px per frame px
  const sw = SIDE_FRAME.w * k;
  const sh = SIDE_FRAME.h * k;
  const sx = cx - sw / 2;
  const box = { sx, sy: hair, sw, sh };
  // The visible eye sits just behind the front of the face on the eye line.
  const eyeY = hair + front.eye * front.hc;
  const faceFront = rowExtent(m, eyeY)?.[1] ?? cx + sw * 0.35;
  const eyeX = Math.min(0.92, Math.max(0.55, (faceFront - sx) / sw - 0.12));
  const toFrame = SIDE_FRAME.chin / SIDE_FRAME.h;
  return {
    box,
    spec: { w: SIDE_FRAME.w, h: SIDE_FRAME.h, lipY: front.lip * toFrame, anchorY: 0.5 * toFrame, eyes: [[eyeX, front.eye * toFrame]] },
  };
}

/** The on-screen guide (fallback crop): the frame's aspect, 55% of the photo height, centred. */
export function guideBox(kind: 'front' | 'side', w: number, h: number): Box {
  const f = kind === 'front' ? FRONT_FRAME : SIDE_FRAME;
  const sh = h * 0.55;
  const sw = (sh * f.w) / f.h;
  return { sx: (w - sw) / 2, sy: (h - sh) / 2, sw, sh };
}

export function fallbackSpec(kind: 'front' | 'side'): Omit<HeadSpec, 'src'> {
  const { w, h, lipY, anchorY, eyes } = DEFAULT_HEADS[kind];
  return { w, h, lipY, anchorY, eyes };
}

/** Crop `box` out of the (mirrored) photo at 2× frame size; alpha from the mask, else an oval. */
export function renderCut(photo: HTMLCanvasElement, box: Box, frame: { w: number; h: number }, mask: Mask | null): string {
  const W = frame.w * 2;
  const H = frame.h * 2;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (!mask) {
    g.beginPath();
    g.ellipse(W / 2, H * 0.47, W * 0.42, H * 0.47, 0, 0, Math.PI * 2);
    g.clip();
  }
  g.drawImage(photo, box.sx, box.sy, box.sw, box.sh, 0, 0, W, H);
  if (mask) {
    const img = g.getImageData(0, 0, W, H);
    const mx = mask.width / photo.width;
    const my = mask.height / photo.height;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const c0 = at(mask, (box.sx + (x / W) * box.sw) * mx, (box.sy + (y / H) * box.sh) * my);
        const a = Math.min(1, Math.max(0, (c0 - 0.35) / 0.3)); // soft edge
        img.data[(y * W + x) * 4 + 3] *= a;
      }
    }
    g.putImageData(img, 0, 0);
  }
  return c.toDataURL('image/png');
}

// ── MediaPipe (loaded on demand; the wasm + models come from their CDNs) ──
const MP_VERSION = '1.1.1'; // = package.json @mediapipe/tasks-vision
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export interface Vision {
  segment(photo: HTMLCanvasElement): Mask | null;
  face(photo: HTMLCanvasElement): FacePts | null;
}

/** Nearest-neighbour resize, so mask px = photo px. */
function resample(m: Mask, w: number, h: number): Mask {
  if (m.width === w && m.height === h) return m;
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = at(m, (x * m.width) / w, (y * m.height) / h);
  return { data, width: w, height: h };
}

let loading: Promise<Vision | null> | null = null;

export function loadVision(): Promise<Vision | null> {
  loading ??= (async () => {
    try {
      const mp = await import('@mediapipe/tasks-vision');
      const files = await mp.FilesetResolver.forVisionTasks(WASM);
      const [seg, lm] = await Promise.all([
        mp.ImageSegmenter.createFromOptions(files, {
          baseOptions: { modelAssetPath: SEG_MODEL },
          runningMode: 'IMAGE',
          outputConfidenceMasks: true,
          outputCategoryMask: false,
        }),
        mp.FaceLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: 'IMAGE', numFaces: 1 }),
      ]);
      return {
        segment(photo) {
          const r = seg.segment(photo);
          const masks = r.confidenceMasks ?? [];
          const m = masks[masks.length - 1]; // single-channel model: person confidence
          const out = m && resample({ data: new Float32Array(m.getAsFloat32Array()), width: m.width, height: m.height }, photo.width, photo.height);
          masks.forEach((x) => x.close());
          return out ?? null;
        },
        face(photo) {
          const p = lm.detect(photo).faceLandmarks[0];
          if (!p) return null;
          const P = (i: number) => ({ x: p[i].x * photo.width, y: p[i].y * photo.height });
          const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          return {
            chin: P(152),
            left: P(234),
            right: P(454),
            mouth: mid(P(13), P(14)),
            // Iris centres when present (478 points), else the eye-corner midpoints.
            eyes: p.length > 473 ? [P(468), P(473)] : [mid(P(33), P(133)), mid(P(362), P(263))],
          };
        },
      };
    } catch {
      loading = null; // allow a retry next time
      return null;
    }
  })();
  return loading;
}

export function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}
