'use client';
/* eslint-disable @next/next/no-img-element -- layered sprites, sized by the stage maths */
// A courtroom character: pose art (poses.ts cycles it) with the head cut-out layered BEHIND
// the suit at the pose's head marker, so the neck comes out of the collar. Blue markers take
// the front head, red markers the side head. Expression particles ride the head.
// Tuned in public/mockups/pose-cycling.html; CSS in expressions.css (.pc).
//
// The root is positioned so the rest pose's head marker sits on the parent's origin: place
// the parent at the face point.
import { useRef } from 'react';
import type { CharacterMood, CourtActor } from './expressions';
import { DEFAULT_HEADS, type Heads } from './heads';
import { HEAD_ART_W, POSE_ART, POSE_TUNING, REST_POSE } from './poses';
import { usePoseCycle } from './usePoseCycle';
import { useTalkEngine } from './useTalkEngine';

/** Body width on stage. */
export const artWidth = (role: CourtActor) => POSE_TUNING.artW * (role === 'judge' ? POSE_TUNING.judgeK : 1);

// Particles, in face units from the head centre: [kind, dx, dy, size, image, delay s, keyframes, period s].
const FX: [string, number, number, number, string, number, string?, number?][] = [
  ['spark', 0.72, -0.44, 0.8, 'sparkle.png', 0], ['spark', -0.74, -0.18, 0.55, 'sparkle.png', 0.5],
  ['spark', 0.92, 0.14, 0.6, 'sparkle.png', 0.25], ['spark', -0.48, -0.72, 0.45, 'sparkle.png', 0.9],
  ['sweat', 0.57, -0.3, 0.27, 'sweat-drop.png', 0], ['sweat', 0.47, -0.36, 0.2, 'sweat-drop.png', 0.4],
  ['sweat', 0.72, -0.26, 0.17, 'sweat-drop.png', 0.9],
  ['vein', 0.6, -0.52, 1.05, 'anger-vein.png', 0, 'veinBounce1', 0.45], ['vein', -0.72, -0.34, 0.8, 'anger-vein.png', 0, 'veinBounce2', 0.55],
  ['vein', -0.34, -0.72, 0.65, 'anger-vein.png', 0, 'veinBounce3', 0.38],
  ['bang', 0, -0.86, 0.5, 'exclamation.png', 0],
];
// Breakdown crack fan: [angle deg, delay s].
const CRACKS = [[0, 0], [55, 0.1], [-50, 0.15], [120, 0.2], [-115, 0.25], [175, 0.3]];

type Vars = React.CSSProperties & Record<`--${string}`, string | number>;

export default function Character({
  role,
  mood,
  heads = DEFAULT_HEADS,
  interrupting = false,
  pose: forcedPose,
}: {
  role: CourtActor;
  mood: CharacterMood;
  heads?: Heads;
  /** The user is interrupting: everyone faces front in the neutral pose. */
  interrupting?: boolean;
  /** Pin one pose instead of cycling (menu + verdict screens). */
  pose?: string;
}) {
  const jawRef = useRef<HTMLImageElement>(null);
  useTalkEngine(jawRef, mood.talking, { maxRotation: 8, openDistance: 3 });
  const { pose, frame, spec } = usePoseCycle(role, mood, interrupting, forcedPose);

  const art = POSE_ART[role];
  const width = artWidth(role);
  const s = width / art.width;
  const [ax, ay] = art.poses[REST_POSE].centres[0];
  const [cx, cy] = spec.centres[frame];
  const kind = spec.head;
  const H = heads[kind];
  const mirror = art.faces === 'left' ? -1 : 1;
  // One px scale for both heads: their frames share a height, so head sizes always match.
  const k = (HEAD_ART_W[role] * POSE_TUNING.head * s) / heads.front.w;
  const off = POSE_TUNING[kind];
  const left = cx * s + off.x * s * mirror;
  const top = cy * s + off.y * s;
  const rot = role === 'judge' ? 0 : (POSE_TUNING.rot[pose] ?? 0);
  // The side photo faces right: mirror it for a character facing left (on a wrapper no
  // expression keyframe animates, so the flip can't be overridden mid-expression).
  const flip = kind === 'side' && mirror < 0 ? -1 : 1;
  const src = spec.frames[frame];
  const expr = mood.expression;
  const browW = ((heads.front.w * 0.32) / H.w) * 100;

  return (
    <div
      className={`pc x-${expr}${mood.talking ? ' talking' : ''}`}
      style={{ left: -ax * s, top: -ay * s, width, height: art.height * s }}
      data-role={role}
      data-expression={expr}
      data-talking={mood.talking || undefined}
      data-pose={pose}
      data-frame={frame}
      data-head={kind}
    >
      <div className="pc-bob">
        <div className="pc-head" style={{ left, top }}>
          <div
            className="pc-head-in"
            style={{
              width: H.w * k,
              height: H.h * k,
              transformOrigin: `50% ${H.anchorY * 100}%`,
              transform: `translate(-50%, ${-H.anchorY * 100}%) rotate(${rot * mirror}deg) scaleX(${flip})`,
            }}
          >
            <img className="pc-face" src={H.src} alt="" style={{ clipPath: `inset(0 0 ${((1 - H.lipY) * 100).toFixed(1)}% 0)` }} />
            <img
              ref={jawRef}
              className="pc-face pc-jaw"
              src={H.src}
              alt=""
              style={{ clipPath: `inset(${((H.lipY - 0.02) * 100).toFixed(1)}% 0 0 0)`, transformOrigin: `center ${(H.lipY * 100).toFixed(1)}%` }}
            />
            {H.eyes.map(([x, y], i) => (
              <img
                key={`${kind}${i}`}
                className="pc-brow"
                src="/assets/expressions/eyebrow.png"
                alt=""
                style={{ left: `${x * 100}%`, top: `${(y - 0.11) * 100}%`, width: `${browW}%`, '--bs': kind === 'front' && i === 1 ? -1 : 1 } as Vars}
              />
            ))}
          </div>
        </div>
        <img className="pc-pose" src={src} alt="" />
        <div className="pc-fx" style={{ left, top, '--F': (heads.front.w * k * 0.8).toFixed(2), '--m': mirror } as Vars}>
          {FX.map(([kind, dx, dy, w, img, d, anim, t], i) => (
            <div
              key={i}
              className={`fxp ${kind}`}
              style={{ '--dx': dx, '--dy': dy, '--w': w, '--d': `${d}s`, ...(anim && { '--anim': anim, '--t': `${t}s` }) } as Vars}
            >
              <img src={`/assets/expressions/${img}`} alt="" />
            </div>
          ))}
          {expr === 'breakdown' && (
            <div className="fxp crack" style={{ '--dx': 0, '--dy': 0, '--w': 0 } as Vars}>
              {CRACKS.map(([a, d]) => (
                <div key={a} className="crack-slot" style={{ '--a': `${a}deg`, '--d': `${d}s` } as Vars}>
                  <img src="/assets/expressions/crack-lines.png" alt="" />
                </div>
              ))}
            </div>
          )}
        </div>
        {expr === 'shocked' && <div className="pc-flash" style={{ maskImage: `url(${src})`, WebkitMaskImage: `url(${src})` }} />}
      </div>
    </div>
  );
}
