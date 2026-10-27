'use client';
// Manga-noir courtroom scene (960×540). Background depth planes, camera, characters + expressions,
// and the crane-up intro. Camera transforms precomputed with the validated formula from
// research/courtroom-manga-camera.html against the marker positions below.
import { useEffect, useId, useRef, useState } from 'react';
import './expressions.css';
import type { Scene } from '@/types';
import Character from './Character';
import Stage from './Stage';
import TextBox from './TextBox';
import type { CharacterMood, CourtActor } from './expressions';
import type { Heads } from './heads';
import { ALL_FRAMES, POSE_TUNING } from './poses';
import { PLANES } from './intro';
import { useIntroCrane, type IntroMode } from './useIntroCrane';
import PunchShot, { PUNCH_BG } from './PunchShot';
import { shake } from './shake';
import SpectrumBar, { type BarSfx } from './SpectrumBar';
import type { BarState } from './spectrumRules';
import { useWhipCamera } from './useWhipCamera';
import { OBJECTION, SHOT, vignetteAt, vignetteCss } from './whip';

/* Face points (stage px): the head marker of each character's rest pose sits here. From the
   #ff0000 markers measured in courtroom-bg.png; the tall background's planes keep that framing.
   The lawyers sit POSE_TUNING.lawyersY higher (their pedestals follow). */
const FACE: Record<CourtActor, [number, number]> = {
  prosecution: [223.7, 343.7 + POSE_TUNING.lawyersY],
  defense: [734.4, 343.7 + POSE_TUNING.lawyersY],
  judge: [480, 283],
};
const LAWYERS = ['prosecution', 'defense'] as const;

/* The Judge stands on the far plane, behind the bench (it hides the robe's cut-off edge). The
   lawyers get their own plane ABOVE every background segment, then their pedestals; both carry
   the desks' parallax weight so the intro still moves them together. */
const RIDES: Record<string, CourtActor[]> = { far: ['judge'] };
const DESK_WEIGHT = 0.3;

/* Camera shots + the whip pan between them: see whip.ts. */

function preloadPoses() {
  for (const src of ALL_FRAMES) new Image().src = src;
}

/** Jagged comic burst behind OBJECTION! (26 spikes, irregular but the same every render). */
const BURST = Array.from({ length: 52 }, (_, i) => {
  const a = (i / 52) * Math.PI * 2;
  const r = i % 2 ? 0.74 + 0.06 * Math.abs(Math.sin(i * 2.7)) : 1 + 0.12 * Math.abs(Math.sin(i * 1.3));
  return `${(280 + Math.cos(a) * 270 * r).toFixed(1)},${(125 + Math.sin(a) * 118 * r).toFixed(1)}`;
}).join(' ');

/** Who turns to face the user on an interrupt, in order: the interrupted one, then the rest. */
const turnOrder = (first?: CourtActor): CourtActor[] => {
  const all: CourtActor[] = ['prosecution', 'defense', 'judge'];
  return first ? [first, ...all.filter((r) => r !== first)] : all;
};

export default function Courtroom({
  scene,
  moods,
  speakerName,
  speakerColor,
  text,
  objection,
  status,
  controls,
  heads,
  interrupting = false,
  interrupted,
  intro = null,
  onIntroDone,
  shot,
  punch,
  shakeKey = 0,
  spectrum,
  sfx,
}: {
  scene: Scene;
  moods: Record<CourtActor, CharacterMood>;
  speakerName?: string;
  speakerColor?: string;
  text?: string;
  objection?: boolean;
  status?: string;
  /** The user’s head cut-outs (onboarding); the default heads when absent. */
  heads?: Heads;
  /** The user is interrupting: everyone turns to face front. */
  interrupting?: boolean;
  /** Who the user interrupted: they turn to face the user first. */
  interrupted?: CourtActor;
  /** Rendered inside the textbox (right side) so it scales with the stage. */
  controls?: React.ReactNode;
  /** Crane-up intro: 'hold' = still on the carpet (loading), 'play' = run it. */
  intro?: IntroMode;
  onIntroDone?: () => void;
  /** Camera override (punch reactions); defaults to the scene's shot. */
  shot?: Scene;
  /** Surprise punch: 'cut'/'punch' show the close-up, 'out' whips away from it, 'gone' = reactions (textbox stays punch-styled). */
  punch?: { who: 'prosecution' | 'defense'; stage: 'cut' | 'punch' | 'out' | 'gone'; mood: CharacterMood; typeMs?: number };
  /** Bump to shake the screen once. */
  shakeKey?: number;
  /** The spectrum HUD (top centre); omitted = no HUD. */
  spectrum?: BarState & { visible: boolean };
  /** Sound effects for the HUD (the audio engine). */
  sfx?: BarSfx;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const camera = useRef<HTMLDivElement>(null);
  const shaker = useRef<HTMLDivElement>(null);
  const ghosts = useRef<HTMLDivElement>(null);
  const lines = useRef<HTMLDivElement>(null);
  const blur = useRef<HTMLDivElement>(null);
  const blurStd = useRef<SVGFEGaussianBlurElement>(null);
  const punchLayer = useRef<HTMLDivElement>(null);
  const vignette = useRef<HTMLDivElement>(null);
  const filterId = `whip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  useIntroCrane({ stage, camera, shaker, ghosts, lines }, intro, onIntroDone);

  // OBJECTION!: each interrupt (rising edge of `objection`) gets a number, which keys its one-shot effects.
  const pullBack = !!objection && !intro;
  const [hit, setHit] = useState({ on: false, n: 0 });
  if (hit.on !== pullBack) setHit({ on: pullBack, n: pullBack ? hit.n + 1 : hit.n });
  // How many of turnOrder() have turned to face the user so far in interrupt `n` (staggered).
  const [turned, setTurned] = useState({ n: 0, count: 0 });
  const order = turnOrder(interrupted);
  const facing = (role: CourtActor) => pullBack && turned.n === hit.n && order.indexOf(role) < turned.count;
  useEffect(() => {
    if (!pullBack) return;
    const n = hit.n;
    const ids = [1, 2, 3].map((count) =>
      setTimeout(() => setTurned({ n, count }), OBJECTION.turnMs + (count - 1) * OBJECTION.staggerMs),
    );
    if (shaker.current) shake(shaker.current, OBJECTION.shake.px, OBJECTION.shake.ms);
    return () => ids.forEach(clearTimeout);
  }, [pullBack, hit.n]);

  // Every change of shot outside the intro is a whip pan; the punch shot slides off with it.
  // An interrupt instead pulls back hard to the wide shot, the vignette darkening with the zoom.
  const view = shot ?? scene;
  useWhipCamera(
    { camera, blur, blurStd, filterId },
    intro ? null : pullBack ? OBJECTION.shot : SHOT[view],
    punch?.stage === 'out' ? { ref: punchLayer, dir: punch.who === 'prosecution' ? -1 : 1 } : undefined,
    {
      pullBack,
      onFrame: (now, from) => {
        if (vignette.current) vignette.current.style.background = vignetteCss(vignetteAt(from.S, now.S));
      },
    },
  );
  useEffect(() => {
    if (shakeKey && shaker.current) return shake(shaker.current);
  }, [shakeKey]);
  useEffect(preloadPoses, []);
  const at = (role: CourtActor) => ({ left: FACE[role][0], top: FACE[role][1] });
  const ped = POSE_TUNING.pedestal;

  return (
    <Stage>
      <div className="manga-stage" ref={stage}>
        <svg width="0" height="0" className="absolute">
          <filter id={filterId} x="-20%" y="-5%" width="140%" height="110%">
            <feGaussianBlur ref={blurStd} stdDeviation="0 0" />
          </filter>
        </svg>
        <div className="absolute inset-0" ref={shaker}>
          <div className="absolute inset-0" ref={blur}>
            {/* The intro, then the whip camera, own the camera transform (no React style). */}
            <div className="manga-camera" ref={camera} data-camera>
              {PLANES.map((p) => (
                <div key={p.name} className="manga-plane" data-plane={p.name} data-weight={p.weight}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="manga-plane-img" src={p.file} alt="" style={p.style} />
                  {RIDES[p.name]?.map((role) => (
                    <div key={role} className={`absolute${facing(role) ? ' pc-jolt' : ''}`} style={at(role)}>
                      <Character role={role} mood={moods[role]} heads={heads} interrupting={pullBack ? facing(role) : interrupting} />
                    </div>
                  ))}
                </div>
              ))}
              <div className="manga-plane" data-plane="lawyers" data-weight={DESK_WEIGHT}>
                {LAWYERS.map((role) => (
                  <div key={role} className={`absolute${facing(role) ? ' pc-turn-pop' : ''}`} style={at(role)}>
                    <Character role={role} mood={moods[role]} heads={heads} interrupting={pullBack ? facing(role) : interrupting} />
                  </div>
                ))}
              </div>
              <div className="manga-plane" data-plane="pedestals" data-weight={DESK_WEIGHT}>
                {LAWYERS.map((role) => {
                  const m = role === 'defense' ? -1 : 1;
                  return (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={role}
                      className="pc-pedestal"
                      src="/assets/pedestal.webp"
                      alt=""
                      style={{ width: ped.w, left: FACE[role][0] + ped.x * m - ped.w / 2, top: FACE[role][1] + ped.y, transform: `scaleX(${m})` }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="absolute inset-0" ref={ghosts} />
            {punch && punch.stage !== 'gone' && <PunchShot ref={punchLayer} who={punch.who} mood={punch.mood} heads={heads} />}
          </div>
          <div className="manga-speedlines" />
          <div className="manga-zoomlines" ref={lines} />
          <div className="manga-halftone" />
          <div className="manga-ink" />
          <div className={`objection-vignette${pullBack ? ' on' : ''}`} ref={vignette} />
          {pullBack && <div key={`burst-${hit.n}`} className="objection-burst" />}
        </div>

        {/* Viewport-fixed overlays (not affected by camera) */}
        <div className="manga-scanlines" />
        <div className="manga-vignette" />
        {spectrum && <SpectrumBar {...spectrum} sfx={sfx} />}
        {pullBack && <div key={`flash-${hit.n}`} className="objection-flash" />}
        {pullBack && (
          <div key={`word-${hit.n}`} className="objection-word" role="img" aria-label="Objection!">
            <svg viewBox="0 0 560 250" aria-hidden>
              <polygon points={BURST} fill="#c81e1e" stroke="#08080e" strokeWidth={8} strokeLinejoin="round" transform="rotate(-6 280 125)" />
            </svg>
            <span aria-hidden>OBJECTION!</span>
          </div>
        )}
        {status && (
          <div className="absolute inset-x-0 top-[21%] z-40 text-center font-mono text-lg text-zinc-200 [text-shadow:0_2px_8px_#000]">
            {status}
          </div>
        )}
        {(text || controls || punch) && (
          <TextBox
            name={speakerName}
            color={speakerColor ?? '#e0e0e0'}
            text={text}
            controls={controls}
            punch={punch && { color: PUNCH_BG[punch.who], typeMs: punch.typeMs ?? 0 }}
            rec={pullBack}
          />
        )}
      </div>
    </Stage>
  );
}
