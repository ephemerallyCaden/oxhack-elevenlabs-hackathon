// The surprise punch, beat by beat (tuned in public/mockups/punch-shot-pick.html):
//   setup clip → hard cut + shake + sting → 600ms → punch clip + shake (types in)
//   → whip to the Judge → shocked + shake + gasp, 900ms → whip to the opponent → same → done.
// Dependencies are injected so the order and timing are testable without audio or DOM.
import type { Line } from '@/types';
import { WHIP } from './whip';

export type PunchStage = 'setup' | 'cut' | 'punch' | 'to-judge' | 'judge' | 'to-opponent' | 'opponent';

export const PUNCH_TIMING = { pauseMs: 600, holdMs: 900 } as const;

export interface PunchDeps {
  stage(s: PunchStage): void;
  /** Play a clip (or wait `fallbackMs` when there's no audio); resolves when it ends. */
  clip(audioUrl: string | undefined, fallbackMs: number): Promise<void>;
  sfx(name: 'scene_cut' | 'gasp'): void;
  shake(): void;
  sleep(ms: number): Promise<void>;
}

/** Runs the whole punch line. Stops at the next beat once `signal` aborts (e.g. a user interrupt). */
export async function runPunch(line: Line, d: PunchDeps, signal: AbortSignal): Promise<void> {
  const punch = line.punch;
  if (!punch) return;
  const go = async (p: Promise<void>) => {
    await p;
    if (signal.aborted) throw new DOMException('punch cancelled', 'AbortError');
  };
  try {
    d.stage('setup');
    await go(d.clip(line.audioUrl, line.durationMs ?? 2000));
    d.stage('cut');
    d.shake();
    d.sfx('scene_cut');
    await go(d.sleep(PUNCH_TIMING.pauseMs));
    d.stage('punch');
    d.shake();
    await go(d.clip(punch.audioUrl, punch.durationMs ?? 1400));
    for (const who of ['judge', 'opponent'] as const) {
      d.stage(`to-${who}`);
      await go(d.sleep(WHIP.ms));
      d.stage(who);
      d.shake();
      d.sfx('gasp');
      await go(d.sleep(PUNCH_TIMING.holdMs));
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'AbortError')) throw e;
  }
}
