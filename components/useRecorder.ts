'use client';
// Hold-to-talk recorder + STT helper, shared by /trial and /dev/trial.
import { useRef } from 'react';
import type { SttResponse } from '@/types';

/**
 * Hold-to-talk recorder. stop() waits for start() to finish, so a quick tap (or releasing while the
 * permission prompt is open) can't leave the mic recording. Resolves null if the mic is unavailable.
 */
export function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  const chunks = useRef<Blob[]>([]);
  return {
    start(): Promise<boolean> {
      starting.current = (async () => {
        try {
          // No echo cancellation: on macOS it switches on system voice processing, which ducks whatever is
          // playing; on an interrupt that's the OBJECTION sting. Noise suppression + auto gain don't duck.
          const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
          chunks.current = [];
          rec.current = new MediaRecorder(stream);
          rec.current.ondataavailable = (e) => chunks.current.push(e.data);
          rec.current.start();
          return true;
        } catch {
          rec.current = null;
          return false;
        }
      })();
      return starting.current;
    },
    async stop(): Promise<Blob | null> {
      if (starting.current) await starting.current;
      starting.current = null;
      const r = rec.current;
      rec.current = null;
      if (!r || r.state === 'inactive') return null;
      return new Promise((resolve) => {
        r.onstop = () => {
          r.stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks.current, { type: r.mimeType }));
        };
        r.stop();
      });
    },
  };
}

/** Scribe STT for a recorded clip; '' if it fails. */
export async function transcribe(blob: Blob): Promise<string> {
  try {
    const form = new FormData();
    form.append('audio', blob, 'question.webm');
    const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
    return res.ok ? ((await res.json()) as SttResponse).transcript.trim() : '';
  } catch {
    return '';
  }
}
