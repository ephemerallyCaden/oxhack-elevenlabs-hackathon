'use client';
// The surprise punch close-up: flat speaker colour, scrolling white streaks, the speaker
// head + shoulders (top of head cropped, face on the side it faces from). Tuned in
// public/mockups/punch-shot-pick.html. Sits inside the camera's blur wrapper so the whip
// out of it is motion-blurred too.
import { forwardRef, useMemo } from 'react';
import Character from './Character';
import type { CharacterMood } from './expressions';

type Who = 'prosecution' | 'defense';

export const PUNCH_BG: Record<Who, string> = { prosecution: '#ff3a3a', defense: '#1aa3ff' };

const STREAKS = { count: 91, thick: [1, 4], length: [80, 260], speed: 1400 } as const;
// Character geometry (Character.tsx, lawyers): 160 wide, face 65px at top 10.
const ZOOM = 5.6;
const FACE_Y = 165;

interface Streak {
  top: number;
  width: number;
  height: number;
  opacity: number;
  dur: number;
  delay: number;
}

function makeStreaks(): Streak[] {
  const r = (a: number, b: number) => a + Math.random() * (b - a);
  return Array.from({ length: STREAKS.count }, () => {
    const width = r(STREAKS.length[0], STREAKS.length[1]);
    const dur = (960 + width + 40) / STREAKS.speed;
    return { top: r(0, 98), width, height: r(STREAKS.thick[0], STREAKS.thick[1]), opacity: r(0.55, 0.95), dur, delay: -Math.random() * dur };
  });
}

const PunchShot = forwardRef<HTMLDivElement, { who: Who; mood: CharacterMood; faceSrc?: string }>(function PunchShot(
  { who, mood, faceSrc },
  ref,
) {
  const streaks = useMemo(makeStreaks, [who]);
  const facesRight = who === 'prosecution';
  // Streaks travel opposite to the way the speaker faces (the speaker "moves" toward the opponent).
  const [from, to] = facesRight ? ['980px', 'calc(-100% - 20px)'] : ['calc(-100% - 20px)', '980px'];
  const faceX = (facesRight ? 0.3 : 0.7) * 960;
  return (
    <div ref={ref} className="punch-shot" style={{ background: PUNCH_BG[who] }} data-punch-shot={who}>
      {streaks.map((s, i) => (
        <div
          key={i}
          className="punch-streak"
          style={
            {
              top: `${s.top}%`,
              width: s.width,
              height: s.height,
              opacity: s.opacity,
              '--op': s.opacity,
              '--from': from,
              '--to': to,
              '--dur': `${s.dur}s`,
              '--delay': `${s.delay}s`,
            } as React.CSSProperties
          }
        />
      ))}
      <div
        className="punch-char"
        style={{ transform: `translate(${faceX - 80 * ZOOM}px, ${FACE_Y - (10 + 65 / 2) * ZOOM}px) scale(${ZOOM})` }}
      >
        <Character role={who} mood={mood} facing={facesRight ? 'right' : 'left'} faceSrc={faceSrc} />
      </div>
    </div>
  );
});

export default PunchShot;
