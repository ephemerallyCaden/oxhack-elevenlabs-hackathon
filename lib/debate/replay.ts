// Stored demo trials: a real trial recorded once (scripts/record-demo.mjs) and replayed with no API
// calls at all, so visitors can watch the court without any keys.
//
// A recording is the orchestrator's state over time (only what changed at each step). ReplayTrial has
// the orchestrator's public surface, so /trial plays it exactly like a live trial: it shows each line
// and calls lineEnded() when the line's audio (or its timer) finishes, and the replay moves on.
import type { TrialOrchestrator, TrialState } from './orchestrator';

/** What /trial needs from a trial: a live TrialOrchestrator or a ReplayTrial. */
export type Trial = Pick<TrialOrchestrator, 'subscribe' | 'getState' | 'start' | 'lineEnded' | 'beginInterrupt' | 'endInterrupt' | 'stop'>;

/**
 * One step of a recording: keys replaced (`set`), arrays appended to (`add`), keys cleared (`unset`: JSON
 * drops undefined values, so a cleared key can't live in `set`), ms since the step before.
 */
export interface DemoFrame {
  set?: Partial<TrialState>;
  add?: Partial<Record<ArrayKey, unknown[]>>;
  unset?: (keyof TrialState)[];
  ms: number;
}

export interface Demo {
  id: string;
  title: string;
  question: string;
  recordedAt: string;
  /** Lines carry recorded audio (public/demos/<id>/…); otherwise they're shown for their estimated length. */
  voiced: boolean;
  frames: DemoFrame[];
}

export interface DemoListing {
  id: string;
  title: string;
  question: string;
  voiced: boolean;
}

type ArrayKey = 'transcript' | 'ledger' | 'cards' | 'fallbacks';
const APPENDED: ArrayKey[] = ['transcript', 'ledger', 'cards', 'fallbacks'];

/** The steps between two states: what changed (arrays that only grew are stored as their new items). */
export function diffState(prev: TrialState | undefined, next: TrialState, ms: number): DemoFrame {
  const frame: DemoFrame = { ms: Math.round(ms) };
  for (const k of Object.keys(next) as (keyof TrialState)[]) {
    const a = prev?.[k], b = next[k];
    if (a === b) continue;
    if (b === undefined) {
      (frame.unset ??= []).push(k);
      continue;
    }
    if (APPENDED.includes(k as ArrayKey) && Array.isArray(a) && Array.isArray(b) && b.length >= a.length && a.every((x, i) => x === b[i])) {
      if (b.length > a.length) (frame.add ??= {})[k as ArrayKey] = b.slice(a.length);
    } else (frame.set ??= {})[k] = b as never;
  }
  for (const k of Object.keys(prev ?? {}) as (keyof TrialState)[]) if (!(k in next) && prev?.[k] !== undefined) (frame.unset ??= []).push(k);
  return frame;
}

export function applyFrame(state: TrialState, f: DemoFrame): TrialState {
  const next = { ...state, ...f.set } as TrialState;
  for (const k of f.unset ?? []) delete next[k];
  for (const [k, items] of Object.entries(f.add ?? {})) (next as unknown as Record<string, unknown[]>)[k] = [...(state[k as ArrayKey] as unknown[]), ...(items ?? [])];
  return next;
}

/** How long a non-line step is held on replay (loading moments are trimmed; the objection is held to be seen). */
const MAX_GAP_MS = 1600;
const LISTEN_MS = 2600;

const INITIAL: TrialState = {
  phase: 'ask', scene: 'witness', question: '', agenda: [], cycle: 0, totalCycles: 2, canInterrupt: false,
  spectrum: { value: 0, label: 'Toss-up' }, transcript: [], cards: [], ledger: [], fallbacks: [],
};

export class ReplayTrial implements Trial {
  private state: TrialState = INITIAL;
  private listeners = new Set<() => void>();
  private stopped = false;
  private lineDone?: () => void;
  private waiting?: string; // id of the line we're waiting on

  constructor(private demo: Demo | (() => Promise<Demo>)) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  /** Plays the recording (the question argument is ignored: it's the demo's own). */
  async start() {
    if (this.state.phase !== 'ask' || this.stopped) return;
    const demo = typeof this.demo === 'function' ? await this.demo() : this.demo;
    const frames = demo.frames;
    for (let i = 0; i < frames.length && !this.stopped; i++) {
      const before = this.state.current?.id;
      // A replay can't be interrupted: the recorded objection plays instead.
      this.state = { ...applyFrame(this.state, frames[i]), canInterrupt: false };
      this.emit();
      const s = this.state;
      if (s.phase === 'speaking' && s.current && s.current.id !== before && s.current.speaker !== 'user') await this.untilLineEnds(s.current.id);
      else await this.pause(s.phase === 'listening' ? LISTEN_MS : Math.min(MAX_GAP_MS, frames[i + 1]?.ms ?? 0));
    }
  }

  private untilLineEnds(id: string) {
    return new Promise<void>((r) => {
      this.waiting = id;
      this.lineDone = r;
    });
  }
  private pause(ms: number) {
    return ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve();
  }

  lineEnded = (id: string) => {
    if (this.waiting !== id) return;
    this.waiting = undefined;
    this.lineDone?.();
  };
  beginInterrupt() {
    return null;
  }
  endInterrupt() {}
  stop() {
    this.stopped = true;
    this.listeners.clear();
    this.lineDone?.();
  }
}

/** The stored demo `id` (fetched from /demos/<id>.json when the replay starts). */
export const loadDemo = (id: string) => () =>
  fetch(`/demos/${encodeURIComponent(id)}.json`).then((r) => {
    if (!r.ok) throw new Error(`no demo "${id}"`);
    return r.json() as Promise<Demo>;
  });
