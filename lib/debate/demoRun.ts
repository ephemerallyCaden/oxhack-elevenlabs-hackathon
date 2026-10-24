// D6: shape of public/demo/demo-run.json — one full real run of the demo decision, saved for offline playback.
import type { DebateEvent, InterruptResponse, ParsedDecision, SimulateResponse } from '@/types';

export interface DemoRun {
  createdAt: string;
  transcript: string;
  decision: ParsedDecision;
  sim: SimulateResponse;
  /** Voiced script: every speech/interrupt/verdict event has audioUrl under /demo/audio/. */
  events: DebateEvent[];
  elaborations: Record<string, DebateEvent[]>;
  /** The rehearsed interrupt and its voiced reply. */
  interrupt: { challenge: string; response: InterruptResponse };
  /** Re-ruled verdict that acknowledges the rehearsed interrupt (voiced). */
  verdictAfterInterrupt: DebateEvent[];
}

export const DEMO_RUN_URL = '/demo/demo-run.json';

export async function loadDemoRun(): Promise<DemoRun | null> {
  try {
    const res = await fetch(DEMO_RUN_URL, { cache: 'no-store' });
    return res.ok ? ((await res.json()) as DemoRun) : null;
  } catch {
    return null;
  }
}
