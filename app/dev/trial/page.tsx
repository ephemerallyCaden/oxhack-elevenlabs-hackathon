'use client';
// MVP harness for the trial engine (D). Plain scenes; C replaces these with the real 2D courtroom.
// Hold the button (or SPACE) to talk: asks the question, or interrupts whoever is speaking.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Line, Scene, SttResponse } from '@/types';
import { TrialOrchestrator } from '@/lib/debate/orchestrator';
import { useTrialState } from '@/lib/debate/useTrial';
import { footnotes } from '@/lib/debate/transcript';

const WHO: Record<Line['speaker'], { name: string; color: string }> = {
  prosecution: { name: 'PROSECUTION · YES', color: '#c2410c' },
  defense: { name: 'DEFENSE · NO', color: '#2563eb' },
  judge: { name: 'THE JUDGE', color: '#a16207' },
  user: { name: 'YOU', color: '#e4e4e7' },
};
const SCENE_LABEL: Record<Scene, string> = {
  yes: 'S1 · Prosecution close-up',
  no: 'S2 · Defense close-up',
  judge: 'S3 · Judge close-up',
  witness: 'S4 · Witness view (all three face you)',
  cutscene: 'Cut-scene',
};

/**
 * Hold-to-talk recorder. stop() waits for start() to finish, so a quick tap (or releasing while the
 * permission prompt is open) can't leave the mic recording. Resolves null if the mic is unavailable.
 */
function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const starting = useRef<Promise<boolean> | null>(null);
  const chunks = useRef<Blob[]>([]);
  return {
    start(): Promise<boolean> {
      starting.current = (async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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

export default function TrialHarness() {
  const orch = useMemo(() => new TrialOrchestrator(), []);
  const s = useTrialState(orch);
  const recorder = useRecorder();
  const [holding, setHolding] = useState(false);
  // Ref mirror: pointer/key handlers must see a press immediately, before React re-renders.
  const held = useRef(false);
  const [typed, setTyped] = useState('');
  const [needTyping, setNeedTyping] = useState(false);
  const audio = useRef<HTMLAudioElement | null>(null);

  // Play the current line: its audio if voiced, else a timer for its estimated length.
  useEffect(() => {
    const line = s.current;
    if (s.phase !== 'speaking' || !line) return;
    if (line.audioUrl) {
      const a = new Audio(line.audioUrl);
      audio.current = a;
      a.onended = () => orch.lineEnded(line.id);
      a.onerror = () => orch.lineEnded(line.id);
      a.play().catch(() => setTimeout(() => orch.lineEnded(line.id), line.durationMs ?? 3000));
      return () => a.pause();
    }
    const t = setTimeout(() => orch.lineEnded(line.id), line.durationMs ?? 3000);
    return () => clearTimeout(t);
  }, [s.current, s.phase, orch]); // eslint-disable-line react-hooks/exhaustive-deps

  async function transcribe(blob: Blob): Promise<string> {
    try {
      const form = new FormData();
      form.append('audio', blob, 'question.webm');
      const res = await fetch('/api/voice/stt', { method: 'POST', body: form });
      return res.ok ? ((await res.json()) as SttResponse).transcript.trim() : '';
    } catch {
      return '';
    }
  }

  async function down() {
    if (held.current) return;
    const phase = orch.getState().phase; // live state, not this render's snapshot
    if (phase === 'speaking') {
      if (!orch.beginInterrupt()) return;
      audio.current?.pause();
    } else if (phase !== 'ask') return;
    held.current = true;
    setHolding(true);
    if (!(await recorder.start())) setNeedTyping(true);
  }

  async function up() {
    if (!held.current) return;
    held.current = false;
    setHolding(false);
    const blob = await recorder.stop();
    const phase = orch.getState().phase;
    if (phase === 'ask') {
      const q = blob ? await transcribe(blob) : '';
      if (q) orch.start(q);
      else setNeedTyping(true);
    } else if (phase === 'listening') {
      if (blob) orch.endInterrupt(blob);
      else setNeedTyping(true);
    }
  }

  function submitTyped() {
    const text = typed.trim();
    if (!text) return;
    setTyped('');
    setNeedTyping(false);
    const phase = orch.getState().phase;
    if (phase === 'ask') orch.start(text);
    else if (phase === 'listening') orch.endInterrupt(text);
  }

  useEffect(() => {
    const kd = (e: KeyboardEvent) => e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT' && (e.preventDefault(), down());
    const ku = (e: KeyboardEvent) => e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && (e.preventDefault(), up());
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  const line = s.current;
  const active = s.agenda.find((t) => t.id === s.activeTopicId);
  const pos = `${(s.spectrum.value + 100) / 2}%`;
  const canTalk = s.phase === 'ask' || (s.phase === 'speaking' && s.canInterrupt) || holding;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 p-4 text-zinc-100">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-black tracking-tight">Court of Future Selves · MVP</h1>
        <span className="text-sm text-zinc-400">{s.question ? `“${s.question}”` : 'Ask a yes/no question to begin'}</span>
      </header>

      <div className="flex flex-wrap gap-4">
        {/* Scene */}
        <section className="flex min-w-0 flex-[999_1_560px] flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-xs uppercase tracking-widest text-zinc-400">
            <span>{SCENE_LABEL[s.scene]}</span>
            <span>{active ? `${active.title} · cycle ${s.cycle}/3` : s.phase}</span>
          </div>
          <div className="relative flex h-72 items-end justify-center gap-10 p-6">
            {(['prosecution', 'judge', 'defense'] as const).map((who) => {
              const focus =
                s.scene === 'witness' || s.scene === 'cutscene' ? true : (s.scene === 'yes' && who === 'prosecution') || (s.scene === 'no' && who === 'defense') || (s.scene === 'judge' && who === 'judge');
              const target = s.phase === 'listening' && s.interruptTarget === who;
              return (
                <div key={who} className="flex flex-col items-center gap-2 transition-all" style={{ opacity: s.scene === 'cutscene' ? 0.15 : focus ? 1 : 0.2, transform: focus && s.scene !== 'witness' ? 'scale(1.25)' : undefined }}>
                  <div className="h-16 w-16 rounded-full border-4 bg-zinc-800" style={{ borderColor: WHO[who].color, boxShadow: target ? `0 0 24px ${WHO[who].color}` : undefined }} />
                  <div className="h-20 w-28 rounded-t-3xl border-4 bg-zinc-800" style={{ borderColor: WHO[who].color }} />
                  <span className="text-xs font-bold" style={{ color: WHO[who].color }}>{WHO[who].name}</span>
                </div>
              );
            })}
            {s.phase === 'listening' && (
              <div className="absolute top-6 -rotate-3 border-4 border-white bg-zinc-950 px-6 py-1 text-4xl font-black">OBJECTION!</div>
            )}
            {(s.phase === 'preparing' || s.phase === 'thinking') && (
              <div className="absolute inset-x-0 top-6 text-center text-lg text-zinc-300">{s.status}</div>
            )}
          </div>
          <div className="min-h-32 border-t border-zinc-800 bg-zinc-950 p-4">
            {line && s.phase === 'speaking' ? (
              <>
                <div className="mb-1 text-xs font-bold tracking-widest" style={{ color: WHO[line.speaker].color }}>{WHO[line.speaker].name}</div>
                <p className="text-lg leading-snug">{line.text}</p>
              </>
            ) : s.phase === 'listening' ? (
              <p className="text-lg text-zinc-300">Interrupting {s.interruptTarget === 'judge' ? 'the Judge (add or remove a topic)' : s.interruptTarget === 'prosecution' ? 'YES' : 'NO'}… speak, then release.</p>
            ) : s.phase === 'ask' ? (
              <p className="text-lg text-zinc-300">Hold to talk and ask: “Should I …?”</p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-zinc-800 p-4">
            <button
              type="button"
              disabled={!canTalk}
              onPointerDown={down}
              onPointerUp={up}
              onPointerLeave={() => held.current && up()}
              className="min-h-11 rounded-full bg-red-600 px-6 py-3 font-bold uppercase tracking-wide disabled:opacity-40"
            >
              {holding ? 'Listening… release to send' : s.phase === 'ask' ? 'Hold to ask' : 'Hold to interrupt'}
            </button>
            <span className="text-xs text-zinc-500">or hold SPACE</span>
            {(needTyping || s.phase === 'ask') && (
              <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => (e.preventDefault(), submitTyped())}>
                <label htmlFor="typed" className="sr-only">Type instead</label>
                <input id="typed" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={s.phase === 'ask' ? 'or type: Should I…?' : 'Type your interruption'} className="min-h-11 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3" />
                <button type="submit" className="min-h-11 rounded-lg border border-zinc-600 px-4">Send</button>
              </form>
            )}
          </div>
        </section>

        {/* Judge's board */}
        <aside className="flex flex-[1_1_300px] flex-col gap-4">
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-500">Where the court stands</h2>
            <div className="relative h-3 rounded-full bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-600">
              <div className="absolute -top-1.5 h-6 w-1.5 rounded bg-white transition-all" style={{ left: pos }} />
            </div>
            <div className="mt-1 flex justify-between text-xs text-zinc-400"><span>NO −100</span><span>0</span><span>+100 YES</span></div>
            <p className="mt-2 font-bold">{s.spectrum.value > 0 ? '+' : ''}{s.spectrum.value} · {s.spectrum.label}</p>
          </div>
          <div className="rounded-xl border border-zinc-700 bg-zinc-900 p-4">
            <h2 className="mb-2 text-xs font-bold uppercase tracking-widest text-amber-500">Agenda</h2>
            <ul className="flex flex-col gap-2 text-sm">
              {s.agenda.map((t) => (
                <li key={t.id} className={`flex justify-between gap-2 ${t.status === 'removed' ? 'text-zinc-600 line-through' : t.id === s.activeTopicId ? 'font-bold' : ''}`}>
                  <span>{t.title}{t.added_by === 'user' ? ' (yours)' : ''}</span>
                  <span className="shrink-0 text-zinc-400">{Math.round(t.importance * 100)}%{t.score ? ` · ${t.score.t > 0 ? '+' : ''}${t.score.t.toFixed(2)}` : ''}</span>
                </li>
              ))}
            </ul>
          </div>
          {s.fallbacks.length > 0 && (
            <p className="text-xs text-zinc-500">Mock data used for: {[...new Set(s.fallbacks)].join(', ')}</p>
          )}
        </aside>
      </div>

      {s.result && (
        <section className="flex flex-col gap-4 rounded-xl border border-zinc-700 bg-zinc-900 p-4">
          <h2 className="text-xl font-black">Verdict: {s.result.verdict?.spectrum.label} ({s.spectrum.value > 0 ? '+' : ''}{s.spectrum.value})</h2>
          <p className="text-zinc-300">{s.result.verdict?.explanation}</p>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Transcript</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {s.result.lines.map((l) => (
              <li key={l.id}>
                <strong style={{ color: WHO[l.speaker].color }}>{WHO[l.speaker].name}:</strong> {l.text}
                {footnotes(s.result!, l).map((n) => <sup key={n} className="ml-0.5 text-zinc-400">[{n}]</sup>)}
              </li>
            ))}
          </ol>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Sources</h3>
          <ol className="flex flex-col gap-1 text-sm text-zinc-300">
            {s.result.sources.map((c, i) => (
              <li key={c.id}>
                [{i + 1}] {c.evidence} · {c.source_url ? <a className="underline" href={c.source_url} target="_blank" rel="noreferrer">{c.source_name}</a> : c.source_name}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
