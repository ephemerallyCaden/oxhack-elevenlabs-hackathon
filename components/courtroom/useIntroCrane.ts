'use client';
// Drives the crane-up intro imperatively (one rAF loop, no React re-renders per frame).
//   'hold' → dead still on the carpet (start frame) while the trial loads
//   'play' → crane (rise + push, parallax, zoom blur) → overshoot + shake → beat → onDone()
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import {
  INTRO, blurAmount, camTransform, pathAt, planeTransform, springAt, vpOnScreen,
} from './intro';

export type IntroMode = 'hold' | 'play' | null;

interface Refs {
  stage: RefObject<HTMLDivElement | null>;
  camera: RefObject<HTMLDivElement | null>;
  shaker: RefObject<HTMLDivElement | null>;
  ghosts: RefObject<HTMLDivElement | null>;
  lines: RefObject<HTMLDivElement | null>;
}

const frame = () => new Promise<number>((r) => requestAnimationFrame(r));

export function useIntroCrane(refs: Refs, mode: IntroMode, onDone?: () => void) {
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  // Paint the start frame before the browser shows the first intro frame.
  useLayoutEffect(() => {
    if (mode) render(refs, 0, 0);
    refs.stage.current?.setAttribute('data-ready', '');
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const stage = refs.stage.current;
    if (!stage) return;
    if (!mode) {
      // The intro ended early (the trial ended or crashed while holding on the carpet or mid-crane): put
      // the planes and camera back at rest, or the court shows half-lifted planes.
      if (stage.dataset.intro && stage.dataset.intro !== 'done') render(refs, 1, 0);
      stage.dataset.intro = 'done';
      return;
    }
    stage.dataset.intro = mode === 'hold' ? 'hold' : 'crane';
    if (mode === 'hold') return;

    let cancelled = false;
    const alive = () => !cancelled;
    void (async () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        render(refs, 1, 0);
        if (refs.camera.current) refs.camera.current.style.transition = '';
        done.current?.();
        return;
      }
      // 1. Crane: one fast constant-speed move with ghost-copy zoom blur.
      makeGhosts(refs, INTRO.ghosts);
      const t0 = performance.now();
      for (;;) {
        await frame();
        if (!alive()) return;
        const t = Math.min(1, (performance.now() - t0) / INTRO.moveMs);
        render(refs, t, t < 1 ? blurAmount(1) : 0); // linear easing: e = t, velocity = 1
        if (t >= 1) break;
      }
      clearGhosts(refs);
      render(refs, 1, 0);
      // 2. Landing: overshoot + settle, with a small shake.
      stage.dataset.intro = 'landing';
      await Promise.all([spring(refs, alive), shake(refs, alive)]);
      if (!alive()) return;
      render(refs, 1, 0);
      // 3. Beat on the witness view, then hand back to the scene camera.
      stage.dataset.intro = 'beat';
      await new Promise((r) => setTimeout(r, INTRO.beatMs));
      if (!alive()) return;
      stage.dataset.intro = 'done';
      if (refs.camera.current) refs.camera.current.style.transition = ''; // scene pans use the CSS transition again
      done.current?.();
    })();
    return () => {
      cancelled = true;
      clearGhosts(refs);
      if (refs.shaker.current) refs.shaker.current.style.transform = '';
      if (refs.camera.current) refs.camera.current.style.transition = '';
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** One frame of the move at path position e (blur strength 0..1). */
function render(refs: Refs, e: number, blur: number) {
  const cam = refs.camera.current, stage = refs.stage.current;
  if (!cam || !stage) return;
  const pose = pathAt(e);
  const tf = camTransform(pose);
  cam.style.transition = 'none';
  cam.style.transform = tf;
  const r = 1 - e;
  stage.querySelectorAll<HTMLElement>('[data-plane]').forEach((p) => {
    p.style.transform = planeTransform(Number(p.dataset.weight), r);
  });
  const vp = vpOnScreen(pose);
  const lines = refs.lines.current;
  if (lines) {
    lines.style.setProperty('--vpx', `${vp.x}px`);
    lines.style.setProperty('--vpy', `${vp.y}px`);
    lines.style.opacity = String(Math.min(1, blur * 0.9));
  }
  const ghosts = refs.ghosts.current;
  if (ghosts) {
    const n = ghosts.children.length;
    [...ghosts.children].forEach((g, i) => {
      const j = i + 1;
      const el = g as HTMLElement;
      el.style.transform = `translate(${vp.x}px, ${vp.y}px) scale(${1 + j * 0.022 * blur}) translate(${-vp.x}px, ${-vp.y}px)`;
      el.style.opacity = String(blur * 0.5 * (1 - (j - 1) / n));
      (el.firstChild as HTMLElement).style.transform = tf;
    });
  }
  cam.parentElement!.style.filter = blur > 0.02 ? `blur(${blur * 1.4}px)` : '';
}

function makeGhosts(refs: Refs, n: number) {
  const ghosts = refs.ghosts.current, cam = refs.camera.current;
  if (!ghosts || !cam) return;
  ghosts.replaceChildren();
  for (let i = 0; i < n; i++) {
    const g = document.createElement('div');
    g.className = 'absolute inset-0';
    g.style.transformOrigin = '0 0';
    const c = cam.cloneNode(true) as HTMLElement;
    c.removeAttribute('data-camera');
    g.appendChild(c);
    ghosts.appendChild(g);
  }
}

function clearGhosts(refs: Refs) {
  refs.ghosts.current?.replaceChildren();
  if (refs.lines.current) refs.lines.current.style.opacity = '0';
  if (refs.camera.current?.parentElement) refs.camera.current.parentElement.style.filter = '';
}

async function spring(refs: Refs, alive: () => boolean) {
  const t0 = performance.now();
  for (;;) {
    await frame();
    if (!alive()) return;
    const tau = performance.now() - t0;
    if (tau >= INTRO.springMs) return;
    render(refs, springAt(tau), 0);
  }
}

async function shake(refs: Refs, alive: () => boolean) {
  const el = refs.shaker.current;
  if (!el) return;
  const t0 = performance.now();
  for (;;) {
    await frame();
    if (!alive()) return;
    const k = Math.min(1, (performance.now() - t0) / INTRO.shake.ms);
    if (k >= 1) {
      el.style.transform = '';
      return;
    }
    const a = INTRO.shake.px * (1 - k) ** 2;
    const rnd = () => (Math.random() * 2 - 1) * a;
    el.style.transform = `translate(${rnd()}px, ${rnd()}px)`;
  }
}
