'use client';
// Letterboxed stage: a fixed 960×540 scene scaled to fit its container.
// Fixed internal px keep the camera math and expression keyframes identical
// to the validated research mockups (see research/courtroom-manga-camera.html).
import { useEffect, useRef, useState } from 'react';

export const STAGE_W = 960;
export const STAGE_H = 540;

export default function Stage({ children }: { children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={wrap} className="flex h-full w-full items-center justify-center overflow-hidden bg-black">
      <div style={{ width: STAGE_W, height: STAGE_H, transform: `scale(${scale})`, flex: 'none' }}>
        {children}
      </div>
    </div>
  );
}
