'use client';
// The user's head cut-outs, handed from onboarding (SelfieStep) to the trial in sessionStorage.
//   roulette.selfie — the front cut-out (PNG data URL); also what "Remember me" saves
//   roulette.heads  — both cut-outs + their calibration (this tab only)
// A returning user only gets the front cut-out back: it stands in for the side head too.
import { useMemo, useSyncExternalStore } from 'react';
import { DEFAULT_HEADS, type HeadSpec, type Heads } from '@/components/courtroom/heads';

export const SELFIE_KEY = 'roulette.selfie';
export const HEADS_KEY = 'roulette.heads';

export function saveHeads(h: { front: HeadSpec; side?: HeadSpec }) {
  try {
    sessionStorage.setItem(SELFIE_KEY, h.front.src);
    sessionStorage.setItem(HEADS_KEY, JSON.stringify(h));
  } catch {
    // storage full / private mode: default heads
  }
}

const read = (key: string) => {
  try {
    return sessionStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
};

/** Parse what onboarding left; undefined = the default heads. */
export function parseHeads(heads: string, selfie: string): Heads | undefined {
  try {
    if (heads) {
      const h = JSON.parse(heads) as { front: HeadSpec; side?: HeadSpec };
      return { front: h.front, side: h.side ?? h.front };
    }
  } catch {
    // corrupt: fall through
  }
  if (!selfie) return undefined;
  const front = { ...DEFAULT_HEADS.front, src: selfie };
  return { front, side: front };
}

const noSubscribe = () => () => {};

/** Client-only (the server render keeps the default heads). */
export function useSessionHeads(): Heads | undefined {
  const heads = useSyncExternalStore(noSubscribe, () => read(HEADS_KEY), () => '');
  const selfie = useSyncExternalStore(noSubscribe, () => read(SELFIE_KEY), () => '');
  return useMemo(() => parseHeads(heads, selfie), [heads, selfie]);
}
