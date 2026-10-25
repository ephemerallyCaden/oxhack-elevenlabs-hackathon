'use client';
// The V3 layout (public/mockups/main-menu.html): the YES future on a blue field, the NO future on
// a red one, and the court between them as a band holding the page's content. Used by the
// homepage (menu + onboarding) and the verdict screen.
import { useEffect, useMemo, useState } from 'react';
import '@/components/courtroom/expressions.css';
import './court.css';
import Character, { artWidth } from '@/components/courtroom/Character';
import type { CharacterMood } from '@/components/courtroom/expressions';
import type { Heads } from '@/components/courtroom/heads';
import { POSE_ART, REST_POSE } from '@/components/courtroom/poses';

export interface SeamFigure {
  mood: CharacterMood;
  /** Pinned pose; omit to let it cycle while talking. */
  pose?: string;
}

type Side = 'prosecution' | 'defense';

/** Seeded so the server and client draw the same streaks. */
function streaks(dir: 1 | -1, seed: number) {
  let x = seed;
  const r = (a: number, b: number) => {
    x = (x * 16807) % 2147483647;
    return a + ((x - 1) / 2147483646) * (b - a);
  };
  const [from, to] = dir > 0 ? ['780px', 'calc(-100% - 20px)'] : ['calc(-100% - 20px)', '780px'];
  return Array.from({ length: 46 }, () => {
    const width = r(80, 260);
    const dur = (760 + width) / 1400;
    return { top: r(0, 98), width, height: r(1, 4), opacity: r(0.45, 0.9), dur, delay: -r(0, dur), from, to };
  });
}

/** Lawyer size: ~58% of the viewport width, like the mockup. */
function useFigureScale() {
  const [k, setK] = useState(3.2);
  useEffect(() => {
    const ro = new ResizeObserver(() => setK(Math.min(window.innerWidth * 0.58, 900) / artWidth('prosecution')));
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, []);
  return k;
}

function Half({ side, fig, heads, k }: { side: Side; fig: SeamFigure; heads?: Heads; k: number }) {
  const lines = useMemo(() => streaks(side === 'prosecution' ? 1 : -1, side === 'prosecution' ? 7 : 13), [side]);
  const art = POSE_ART[side];
  const s = artWidth(side) / art.width;
  const [, ay] = art.poses[REST_POSE].centres[0];
  // Face point: across the half (lawyers face the band), with the body's bottom on the screen's bottom.
  const x = side === 'prosecution' ? '39%' : '61%';
  const top = `calc(100% - ${(art.height * s - ay * s) * k - 2}px)`;
  return (
    <div className={`seam-half ${side === 'prosecution' ? 'seam-yes' : 'seam-no'}`} aria-hidden="true">
      {lines.map((l, i) => (
        <div
          key={i}
          className="seam-streak"
          style={{ top: `${l.top}%`, width: l.width, height: l.height, opacity: l.opacity, '--from': l.from, '--to': l.to, '--dur': `${l.dur}s`, '--delay': `${l.delay}s` } as React.CSSProperties}
        />
      ))}
      <div className="seam-word">{side === 'prosecution' ? 'YES' : 'NO'}</div>
      <div className="seam-fig" style={{ left: x, top, transform: `scale(${k})` }}>
        <Character role={side} mood={fig.mood} pose={fig.pose} heads={heads} />
      </div>
    </div>
  );
}

export default function Seam({
  yes,
  no,
  heads,
  wide = false,
  strip,
  stripOpen = false,
  children,
}: {
  yes: SeamFigure;
  no: SeamFigure;
  heads?: Heads;
  /** Onboarding steps need more room: the band widens. */
  wide?: boolean;
  /** A drawer along the bottom (past trials, the court record). */
  strip?: React.ReactNode;
  stripOpen?: boolean;
  children: React.ReactNode;
}) {
  const k = useFigureScale();
  return (
    <>
      <Half side="prosecution" fig={yes} heads={heads} k={k} />
      <Half side="defense" fig={no} heads={heads} k={k} />
      <div className={`seam-band${wide ? ' wide' : ''}`}>{children}</div>
      {strip && <div className={`seam-strip${stripOpen ? ' open' : ''}`} aria-hidden={!stripOpen} inert={!stripOpen}>{strip}</div>}
      <div className="scanlines" />
    </>
  );
}
