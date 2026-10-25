'use client';
// Expressive character: pose body + split face (upper/jaw) + expression overlays.
// Replaces the colored-silhouette placeholder (C6). CSS states live in expressions.css.
import { useRef } from 'react';
import { FACE_CAL, type CharacterMood, type CourtActor } from './expressions';
import { useTalkEngine } from './useTalkEngine';

export type Facing = 'front' | 'left' | 'right';

const POSE_FILE: Record<CourtActor, string> = {
  prosecution: 'prosecutor',
  defense: 'defendant',
  judge: 'judge',
};

// Internal px coordinate system (stage scales the whole 960×540 scene).
const SIZE: Record<CourtActor, { w: number; h: number; face: number; faceTop: number }> = {
  prosecution: { w: 160, h: 240, face: 65, faceTop: 10 },
  defense: { w: 160, h: 240, face: 65, faceTop: 10 },
  judge: { w: 120, h: 180, face: 55, faceTop: 8 },
};

const upperClip = `inset(0 0 ${((1 - FACE_CAL.lipY) * 100).toFixed(1)}% 0)`;
const jawClip = `inset(${((FACE_CAL.lipY - FACE_CAL.jawOverlap) * 100).toFixed(1)}% 0 0 0)`;
const jawOrigin = `center ${(FACE_CAL.lipY * 100).toFixed(1)}%`;
const eyeVars = {
  '--eye-left-x': `${(FACE_CAL.eyeViewerLeft.x * 100).toFixed(1)}%`,
  '--eye-left-y': `${((FACE_CAL.eyeViewerLeft.y - FACE_CAL.browLift) * 100).toFixed(1)}%`,
  '--eye-right-x': `${(FACE_CAL.eyeViewerRight.x * 100).toFixed(1)}%`,
  '--eye-right-y': `${((FACE_CAL.eyeViewerRight.y - FACE_CAL.browLift) * 100).toFixed(1)}%`,
} as React.CSSProperties;

export default function Character({
  role,
  mood,
  facing = 'front',
  faceSrc = '/assets/face.png',
}: {
  role: CourtActor;
  mood: CharacterMood;
  facing?: Facing;
  faceSrc?: string;
}) {
  const jawRef = useRef<HTMLImageElement>(null);
  useTalkEngine(jawRef, mood.talking);

  const { w, h, face, faceTop } = SIZE[role];
  const pose = `/assets/pose-bodies/${POSE_FILE[role]}-${facing === 'front' ? 'front' : 'side'}.svg`;
  const mirror = facing === 'left'; // side assets face right; mirror for facing-left
  const expr = mood.expression;
  const cls = `char state-${expr}${mood.talking ? ' state-talking' : ''}`;
  const facingCls = facing === 'front' ? '' : facing === 'right' ? ' facing-right' : ' facing-left';

  return (
    <div
      className={cls}
      style={{ width: w, height: h, ...eyeVars }}
      data-role={role}
      data-expression={expr}
      data-talking={mood.talking || undefined}
    >
      <div className="char-bob">
      {expr === 'shocked' && <div className="flash-overlay" />}
      {/* Mirror on a wrapper: expression keyframes animate .char-pose's transform. */}
      <div className="char-mirror" style={mirror ? { transform: 'scaleX(-1)' } : undefined}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="char-pose" src={pose} alt="" />
      </div>
      <div
        className={`face-container${facingCls}`}
        style={{ width: face, height: face, top: faceTop }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="face-upper" src={faceSrc} alt="" style={{ clipPath: upperClip }} />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={jawRef}
          className="face-jaw"
          src={faceSrc}
          alt=""
          style={{ clipPath: jawClip, transformOrigin: jawOrigin }}
        />
        {expr === 'angry' && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="face-eyebrow face-eyebrow-left" src="/assets/expressions/eyebrow.png" alt="" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="face-eyebrow face-eyebrow-right" src="/assets/expressions/eyebrow.png" alt="" />
          </>
        )}
      </div>
      {expr === 'angry' && (
        <>
          <div className="face-tint" style={{ width: face, height: face, top: faceTop, left: '50%', transform: 'translateX(-50%)' }} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-vein1" src="/assets/expressions/anger-vein.png" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-vein2" src="/assets/expressions/anger-vein.png" alt="" />
        </>
      )}
      {expr === 'confident' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-sparkle1" src="/assets/expressions/sparkle.png" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-sparkle2" src="/assets/expressions/sparkle.png" alt="" />
        </>
      )}
      {expr === 'sweating' && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-sweat1" src="/assets/expressions/sweat-drop.png" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-sweat2" src="/assets/expressions/sweat-drop.png" alt="" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="overlay overlay-sweat3" src="/assets/expressions/sweat-drop.png" alt="" />
        </>
      )}
      {expr === 'shocked' && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img className="overlay overlay-exclamation" src="/assets/expressions/exclamation.png" alt="" />
      )}
      {expr === 'breakdown' && (
        <div className="crack-fan">
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className={`crack-slot crack-${n}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/expressions/crack-lines.png" alt="" />
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
