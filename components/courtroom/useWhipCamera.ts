'use client';
// Owns the courtroom camera outside the intro: every change of shot is a whip pan
// (whip.ts). While `target` is null the intro (useIntroCrane) drives the camera instead;
// it always lands on the witness shot, so the next whip starts from there.
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { SHOT, WHIP, sameShot, shotCss, whipAt, whipBlur, type Shot } from './whip';

interface Refs {
  camera: RefObject<HTMLDivElement | null>;
  /** Element the horizontal motion blur is applied to (camera + punch layer). */
  blur: RefObject<HTMLDivElement | null>;
  /** The <feGaussianBlur> inside the SVG filter `filterId`. */
  blurStd: RefObject<SVGFEGaussianBlurElement | null>;
  filterId: string;
}

/** Optional layer that slides off-screen during the whip (the punch shot leaving). */
export interface Slide {
  ref: RefObject<HTMLElement | null>;
  dir: -1 | 1;
}

export function useWhipCamera(refs: Refs, target: Shot | null, slide?: Slide) {
  const at = useRef<Shot | null>(null); // where the camera is now
  const slideRef = useRef<Slide | undefined>(undefined);
  useEffect(() => {
    slideRef.current = slide;
  });

  useLayoutEffect(
    () => moveTo(refs, at, target, slideRef),
    [target?.S, target?.tx, target?.ty, target === null], // eslint-disable-line react-hooks/exhaustive-deps
  );
}

/** Snap (first frame, or same shot) or whip the camera to `target`. Returns a cancel function. */
function moveTo(refs: Refs, at: { current: Shot | null }, target: Shot | null, slide: { current: Slide | undefined }) {
  const cam = refs.camera.current;
  if (!cam) return;
  if (!target) {
    at.current = SHOT.witness; // the intro owns the camera and lands here
    return;
  }
  const from = at.current;
  if (!from || sameShot(from, target)) {
    cam.style.transform = shotCss(target);
    at.current = target;
    return;
  }
  let raf = 0;
  const t0 = performance.now();
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / WHIP.ms);
    const pose = whipAt(from, target, t);
    cam.style.transform = shotCss(pose);
    at.current = pose;
    setBlur(refs, whipBlur(t));
    const s = slide.current, el = s?.ref.current;
    if (s && el) el.style.transform = `translateX(${s.dir * 110 * (1 - 2 ** (-10 * t))}%)`;
    if (t < 1) raf = requestAnimationFrame(step);
    else {
      setBlur(refs, 0);
      at.current = target;
    }
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    setBlur(refs, 0);
  };
}

function setBlur(refs: Refs, px: number) {
  refs.blurStd.current?.setAttribute('stdDeviation', `${px.toFixed(2)} ${(px * 0.08).toFixed(2)}`);
  if (refs.blur.current) refs.blur.current.style.filter = px > 0.3 ? `url(#${refs.filterId})` : '';
}
