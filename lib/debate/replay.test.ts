import { describe, expect, it } from 'vitest';
import type { TrialState } from './orchestrator';
import { applyFrame, diffState } from './replay';

describe('stored demo recordings', () => {
  it('a cleared field stays cleared after a JSON round trip (JSON drops undefined values)', () => {
    const base = { phase: 'listening', interruptTarget: 'defense', transcript: [] } as unknown as TrialState;
    const after = { ...base, phase: 'speaking', interruptTarget: undefined } as unknown as TrialState;
    const frame = JSON.parse(JSON.stringify(diffState(base, after, 10)));
    const replayed = applyFrame(base, frame);
    expect(replayed.phase).toBe('speaking');
    expect(replayed.interruptTarget).toBeUndefined();
  });
});
