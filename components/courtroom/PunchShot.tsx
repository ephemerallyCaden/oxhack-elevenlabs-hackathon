'use client';
// The surprise punch close-up: flat speaker colour, scrolling white streaks, the speaker
// head + shoulders (top of head cropped, face on the side it faces from). Tuned in
// public/mockups/punch-shot-pick.html. Sits inside the camera's blur wrapper so the whip
// out of it is motion-blurred too.
import { forwardRef, useMemo } from 'react';
import Character, { artWidth } from './Character';
import type { CharacterMood } from './expressions';
import type { Heads } from './heads';
import { POSE_ART, POSE_TUNING } from './poses';

type Who = 'prosecution' | 'defense';

// YES is blue, NO is red (the suits in the pose art).
export const PUNCH_BG: Record<Who, string> = { prosecution: '#1aa3ff', defense: '#ff3a3a' };

const STREAKS = { count: 91, thick: [1, 4], length: [80, 260], speed: 1400 } as const;
const ZOOM = 5.6;
const FACE_Y = 165; // head centre in the shot, px

/** The rest pose's side head centre, relative to the character's face point (Character.tsx). */
function headOffset(who: Who) {
  const s = artWidth(who) / POSE_ART[who].width;
  const m = POSE_ART[who].faces === 'left' ? -1 : 1;
  return { x: POSE_TUNING.side.x * s * m, y: POSE_TUNING.side.y * s };
}

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

const PunchShot = forwardRef<HTMLDivElement, { who: Who; mood: CharacterMood; heads?: Heads }>(function PunchShot(
  { who, mood, heads },
  ref,
) {
  const streaks = useMemo(makeStreaks, [who]);
  const facesRight = who === 'prosecution';
  // Streaks travel opposite to the way the speaker faces (the speaker "moves" toward the opponent).
  const [from, to] = facesRight ? ['980px', 'calc(-100% - 20px)'] : ['calc(-100% - 20px)', '980px'];
  const faceX = (facesRight ? 0.3 : 0.7) * 960;
  const head = headOffset(who);
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
        style={{ transform: `translate(${faceX - head.x * ZOOM}px, ${FACE_Y - head.y * ZOOM}px) scale(${ZOOM})` }}
      >
        <Character role={who} mood={mood} heads={heads} />
      </div>
    </div>
  );
});

export default PunchShot;
