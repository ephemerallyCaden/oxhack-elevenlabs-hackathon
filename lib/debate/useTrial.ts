'use client';
// React binding: const state = useTrialState(orch)
import { useSyncExternalStore } from 'react';
import type { TrialState } from './orchestrator';
import type { Trial } from './replay';

/** A live trial or a stored demo's replay (replay.ts). */
export function useTrialState(orch: Pick<Trial, 'subscribe' | 'getState'>): TrialState {
  return useSyncExternalStore(orch.subscribe, orch.getState, orch.getState);
}
