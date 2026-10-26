'use client';
// "Use your own keys": the visitor pastes their own API keys (BYOK). They stay in this browser
// (lib/byok/browser.ts) and go only to this site's own server, for that visitor's requests (lib/keys.ts).
import { useEffect, useRef, useState } from 'react';
import { forgetKeys, getKeys, setKeys, type Keys, type Service } from '@/lib/byok/browser';

const FIELDS: { id: Service; name: string; what: string; href: string; get: string }[] = [
  {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    what: 'The voices, the transcription of what you say, and cloning your voice. The free plan speaks in a stock voice; cloning yours needs Starter or above.',
    href: 'https://elevenlabs.io/app/settings/api-keys',
    get: 'Get a key',
  },
  { id: 'groq', name: 'Groq', what: 'Writes the debate. Free, and fast.', href: 'https://console.groq.com/keys', get: 'Get a free key' },
  { id: 'gemini', name: 'Gemini', what: 'Writes the debate (instead of, or alongside, Groq). Free tier.', href: 'https://aistudio.google.com/apikey', get: 'Get a free key' },
  { id: 'anthropic', name: 'Anthropic (optional)', what: 'Writes the debate with Claude instead, if you prefer it. Paid.', href: 'https://console.anthropic.com/settings/keys', get: 'Get a key' },
];

export default function KeysPanel({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState<Keys>(() => getKeys());
  const [saved, setSaved] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', esc);
    return () => removeEventListener('keydown', esc);
  }, [onClose]);

  const save = () => {
    setKeys(draft);
    setSaved(true);
    setTimeout(onClose, 600);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="keys-title" className="ct-panel flex max-h-[90dvh] w-full max-w-xl flex-col gap-4 overflow-y-auto p-6 text-left" onClick={(e) => e.stopPropagation()}>
        <span className="ct-kicker">Bring your own keys</span>
        <h2 id="keys-title" className="ct-title-sm">Use your own keys</h2>
        <p className="ct-small">
          Your keys stay in this browser. They’re sent only to this site’s server, used for your own requests, and never stored or
          logged. <a className="ct-link" href="https://github.com/ephemerallyCaden/oxhack-elevenlabs-hackathon" target="_blank" rel="noreferrer">Read the code</a>.
          You need one key that writes the debate (Groq or Gemini are free) and ElevenLabs for the voices.
        </p>
        {FIELDS.map((f, i) => (
          <label key={f.id} className="flex flex-col gap-1">
            <span className="flex items-baseline justify-between gap-3">
              <b className="ct-body !max-w-none">{f.name}</b>
              <a className="ct-link !text-sm" href={f.href} target="_blank" rel="noreferrer">{f.get}</a>
            </span>
            <span className="ct-small">{f.what}</span>
            <input
              ref={i === 0 ? first : undefined}
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={draft[f.id] ?? ''}
              onChange={(e) => setDraft({ ...draft, [f.id]: e.target.value })}
              placeholder={`${f.name.replace(' (optional)', '')} API key`}
              className="min-h-10 border-2 border-[var(--c-oak)] bg-[var(--c-wood)] px-3 font-mono text-sm text-white"
            />
          </label>
        ))}
        <p className="ct-small">
          Tip: in ElevenLabs, make a restricted key just for this site (Text to Speech, Speech to Text and Voices) and give it a credit
          limit. A full trial uses a few thousand credits.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <button className="ct-primary" onClick={save}>{saved ? 'Saved' : 'Save keys'}</button>
          <button className="ct-ghost" onClick={() => (forgetKeys(), setDraft({}))}>Forget my keys</button>
          <button className="ct-link" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
