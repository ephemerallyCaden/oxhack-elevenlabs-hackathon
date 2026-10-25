// Screen shake: random decaying jolts on an element. Returns a cancel function.
export const SHAKE = { px: 11, ms: 220 } as const; // tuned in public/mockups/punch-shot-pick.html

export function shake(el: HTMLElement, px: number = SHAKE.px, ms: number = SHAKE.ms): () => void {
  let raf = 0;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    if (k >= 1) {
      el.style.transform = '';
      return;
    }
    const a = px * (1 - k) ** 2;
    const r = () => (Math.random() * 2 - 1) * a;
    el.style.transform = `translate(${r()}px, ${r()}px)`;
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    el.style.transform = '';
  };
}
