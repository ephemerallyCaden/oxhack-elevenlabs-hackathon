// Task C: Convert TrialState → UI component props.
// Pure functions, no side effects. Used by app/trial/page.tsx.

import type { TrialState } from '@/lib/debate/orchestrator';
import type { Scene, Speaker } from '@/types';
import type { CourtRole } from '@/components/courtroom/roles';
import type { BgmName } from '@/lib/audio/assets';

// ── Courtroom props ────────────────────────────────────────────────────────────

export interface CourtroomProps {
  speaker: CourtRole;
  text: string;
  round: number;
  tokens: number;
  names?: Partial<Record<CourtRole, string>>;
}

/** Map the full TrialState into the flat props the Courtroom component expects. */
export function mapToCourtroom(state: TrialState): CourtroomProps {
  const speaker = getCurrentSpeaker(state);
  const courtroomSpeaker: CourtRole =
    speaker === 'prosecution' || speaker === 'defense' || speaker === 'judge'
      ? speaker
      : 'judge'; // user / null default to judge view

  // Count remaining interrupt opportunities (the user gets 3 per trial, consumed when they interrupt YES/NO).
  const usedInterrupts = state.transcript.filter(
    (l) => l.speaker === 'user' && l.kind === 'user',
  ).length;
  const tokens = Math.max(0, 3 - usedInterrupts);

  // Current round = index of the active topic (1-based), total = agenda length.
  const doneOrActive = state.agenda.filter((t) => t.status === 'done' || t.status === 'active');
  const round = Math.max(1, doneOrActive.length);

  return {
    speaker: courtroomSpeaker,
    text: state.current?.text ?? state.status ?? '',
    round,
    tokens,
  };
}

// ── Camera / scene ─────────────────────────────────────────────────────────────

export type CameraPosition = 'prosecution-closeup' | 'defense-closeup' | 'judge-closeup' | 'wide' | 'cutscene';

const SCENE_CAMERA: Record<Scene, CameraPosition> = {
  yes: 'prosecution-closeup',
  no: 'defense-closeup',
  judge: 'judge-closeup',
  witness: 'wide',
  cutscene: 'cutscene',
};

export function sceneToCamera(scene: Scene): CameraPosition {
  return SCENE_CAMERA[scene] ?? 'wide';
}

// ── Current speaker ────────────────────────────────────────────────────────────

export function getCurrentSpeaker(state: TrialState): Speaker | null {
  if (state.phase === 'listening') return 'user';
  return state.current?.speaker ?? null;
}

// ── Interrupt guard ────────────────────────────────────────────────────────────

export function canUserInterrupt(state: TrialState): boolean {
  return state.canInterrupt && state.phase === 'speaking' && state.current?.speaker !== 'user';
}

// ── Music mapping ──────────────────────────────────────────────────────────────

export function sceneToMusic(state: TrialState): BgmName | null {
  if (state.phase === 'done') return null;
  if (state.verdict) return 'verdict';
  if (state.scene === 'cutscene') return 'cutscene';
  if (state.phase === 'speaking' || state.phase === 'listening') return 'trial';
  return 'cutscene'; // preparing / thinking
}
