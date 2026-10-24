'use client';
// Manga-noir courtroom scene (960×540). Background, camera, characters + expressions.
// Camera transforms precomputed with the validated formula from
// research/courtroom-manga-camera.html against the marker positions below.
import './expressions.css';
import type { Scene } from '@/types';
import Character, { type Facing } from './Character';
import Stage from './Stage';
import TextBox from './TextBox';
import type { CharacterMood, CourtActor } from './expressions';

/* Character torso centers — the #ff0000 markers measured in courtroom-bg.png,
   adjusted for `background-size: cover` crop (image 5:3 → container 16:9). */
const MARKER: Record<CourtActor, { x: string; y: string }> = {
  prosecution: { x: '23.3%', y: '78%' },
  defense: { x: '76.5%', y: '78%' },
  judge: { x: '50%', y: '62.5%' },
};

/* Precomputed from face centers at the markers:
   prosecution face (223.7, 343.7), defense (734.4, 343.7), judge (480, 283).
   Lawyers framed 11% off-center ("facing each other"), judge centered,
   faces at the effective-viewport vertical center (210.6px, textbox excluded).
   Zoomed out: 1.4×, lawyers' midpoint pulled up, clamped to image bounds. */
const CAMERA: Record<Scene, string> = {
  yes: 'scale(2.2) translate(21.7%, -18.6%)',
  no: 'scale(2.2) translate(-21.5%, -18.6%)',
  judge: 'scale(2.0) translate(0%, -7.9%)',
  witness: 'scale(1.4) translate(0.1%, -14.3%)',
  cutscene: 'scale(1.4) translate(0.1%, -14.3%)',
};

/* Side profiles in close-ups (facing courtroom center), front otherwise. */
function facingFor(role: CourtActor, scene: Scene): Facing {
  if (scene === 'yes' && role === 'prosecution') return 'right';
  if (scene === 'no' && role === 'defense') return 'left';
  return 'front';
}

export default function Courtroom({
  scene,
  moods,
  speakerName,
  speakerColor,
  text,
  objection,
  status,
  controls,
}: {
  scene: Scene;
  moods: Record<CourtActor, CharacterMood>;
  speakerName?: string;
  speakerColor?: string;
  text?: string;
  objection?: boolean;
  status?: string;
  /** Rendered inside the textbox (right side) so it scales with the stage. */
  controls?: React.ReactNode;
}) {
  return (
    <Stage>
      <div className="manga-stage">
        <div className="manga-camera" style={{ transform: CAMERA[scene] }}>
          <div className="manga-bg" />
          <div className="manga-speedlines" />
          <div className="manga-halftone" />
          <div className="manga-ink" />
          {(['prosecution', 'judge', 'defense'] as const).map((role) => (
            <div
              key={role}
              className="absolute z-10"
              style={{ left: MARKER[role].x, top: MARKER[role].y, transform: 'translate(-50%, -50%)' }}
            >
              <Character role={role} mood={moods[role]} facing={facingFor(role, scene)} />
            </div>
          ))}
        </div>

        {/* Viewport-fixed overlays (not affected by camera) */}
        <div className="manga-scanlines" />
        <div className="manga-vignette" />
        {objection && (
          <div
            className="absolute left-1/2 top-[30%] z-40 -translate-x-1/2 -rotate-3 border-4 border-white bg-[#08080e] px-6 py-2 font-mono text-4xl font-black tracking-widest text-white"
          >
            OBJECTION!
          </div>
        )}
        {status && (
          <div className="absolute inset-x-0 top-[8%] z-40 text-center font-mono text-lg text-zinc-200 [text-shadow:0_2px_8px_#000]">
            {status}
          </div>
        )}
        {(text || controls) && (
          <TextBox name={speakerName} color={speakerColor ?? '#e0e0e0'} text={text} controls={controls} />
        )}
      </div>
    </Stage>
  );
}
