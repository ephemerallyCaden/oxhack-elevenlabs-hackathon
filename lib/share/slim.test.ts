import { describe, expect, it } from 'vitest';
import { slimTranscript } from './slim';
import type { Transcript } from '@/types';

describe('slimTranscript', () => {
  it('drops voice audio and TTS text everywhere: lines, punches, the verdict line', () => {
    const voice = 'data:audio/mpeg;base64,AAAA';
    const t = {
      question: 'Should I?',
      lines: [{ id: 'l', speaker: 'prosecution', kind: 'argument', text: 'It pays everything.', tts: '[x] It pays', cites: [], audioUrl: voice, durationMs: 900, punch: { text: 'everything.', tts: '[x] every...', audioUrl: voice, durationMs: 400 } }],
      sources: [],
      verdict: { spectrum: { value: 30, label: 'Lean yes' }, explanation: 'e', breakdown: [], line: { id: 'v', speaker: 'judge', kind: 'verdict', text: 'Yes.', tts: '[calm] Yes.', cites: [], audioUrl: voice } },
    } as unknown as Transcript;
    const out = JSON.stringify(slimTranscript(t));
    expect(out).not.toContain('data:audio');
    expect(out).not.toContain('[x]');
    expect(out).not.toContain('[calm]');
    const s = slimTranscript(t);
    expect(s.lines[0].punch).toEqual({ text: 'everything.' });
    expect(s.lines[0].text).toBe('It pays everything.');
    expect(s.verdict?.line.text).toBe('Yes.');
  });
});
