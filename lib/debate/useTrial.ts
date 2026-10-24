'use client';
// React binding: const state = useTrialState(orch)
import { useSyncExternalStore } from 'react';
import type { TrialOrchestrator, TrialState } from './orchestrator';

export function useTrialState(orch: TrialOrchestrator): TrialState {
  return useSyncExternalStore(orch.subscribe, orch.getState, orch.getState);
}
