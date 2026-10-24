'use client';
// React binding for the orchestrator's state (phase, round, tokens, current event…).
import { useSyncExternalStore } from 'react';
import type { DebateOrchestrator, OrchestratorState } from './orchestrator';

export function useOrchestratorState(orch: DebateOrchestrator): OrchestratorState {
  return useSyncExternalStore(orch.subscribe, orch.getState, orch.getState);
}
