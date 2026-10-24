'use client';

// Production trial page with full AudioEngine integration (Task B + D).
// Wires TrialOrchestrator -> Courtroom visuals + AudioEngine (panning, music, SFX).
// Audio features:
//   1. Scene-based BGM via engine.setMusic() on scene changes
//   2. OBJECTION sting via engine.objection() on user interrupt
//   3. Gavel slam via engine.gavel() on verdict phase
//   4. Crowd ambience via engine.setAmbience() during debate
//   5. Voice playback via engine.playVoice() with stereo panning

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Line, Scene, Speaker, SttResponse } from '@/types';
import { TrialOrchestrator } from '@/lib/debate/orchestrator';
import { sessionVoiceId } from '@/components/onboarding/VoiceStep';
import { sessionProfile, takeSessionQuestion } from '@/lib/onboarding/session';
import { useTrialState } from '@/lib/debate/useTrial';
import { footnotes } from '@/lib/debate/transcript';
import * as engine from '@/lib/audio/engine';
import type { BgmName } from '@/lib/audio/assets';
import Courtroom from '@/components/courtroom/Courtroom';
import { deriveMoods } from '@/components/courtroom/expressions';

// -- Scene -> BGM mapping --
const SCENE_MUSIC: Record<Scene, BgmName | null> = {
  yes: 'trial',
  no: 'trial',
  judge: 'trial',
  witness: 'trial',
  cutscene: 'cutscene',
};

// -- Speaker display config --
const WHO: Record<Line['speaker'], { name: string; color: string }> = {
  prosecution: { name: 'PROSECUTION \u00B7 YES', color: '#c2410c' },
  defense: { name: 'DEFENSE \u00B7 NO', color: '#2563eb' },
  judge: { name: 'THE JUDGE', color: '#a16207' },
  user: { name: 'YOU', color: '#e4e4e7' },
};

// -- Hold-to-talk recorder --
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

// -- Main trial page --
export default function TrialPage() {
  // Onboarding (/) leaves the user's cloned voice + profile in sessionStorage; none → presenter voice.
  const orch = useMemo(() => new TrialOrchestrator({ voiceId: sessionVoiceId(), profile: sessionProfile() }), []);
  const s = useTrialState(orch);
  const recorder = useRecorder();
  const [holding, setHolding] = useState(false);
  const held = useRef(false);
  const [typed, setTyped] = useState('');
  const [needTyping, setNeedTyping] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);

  // Track previous scene/phase for change detection
  const prevScene = useRef<Scene>(s.scene);
  const prevPhase = useRef(s.phase);

  // -- Audio unlock on first user gesture --
  const unlockAudio = useCallback(async () => {
    if (audioUnlocked) return;
    await engine.unlock();
    setAudioUnlocked(true);
  }, [audioUnlocked]);

  // -- 0. Arrived from onboarding: start straight away with the confirmed question --
  // (the "Take it to court" click on / counts as the user gesture for audio)
  const autoStarted = useRef(false);
  useEffect(() => {
    if (autoStarted.current) return;
    autoStarted.current = true;
    const q = takeSessionQuestion();
    if (!q) return;
    void engine.unlock().then(() => {
      setAudioUnlocked(true);
      orch.start(q);
    });
  }, [orch]);

  // -- 1. Scene-based BGM: change music when scene changes --
  useEffect(() => {
    if (!audioUnlocked) return;
    const scene = s.scene;
    const phase = s.phase;

    // On verdict, switch to verdict music
    if (s.verdict) {
      void engine.setMusic('verdict');
      prevScene.current = scene;
      prevPhase.current = phase;
      return;
    }

    // When done with no verdict (error state), silence
    if (phase === 'done') {
      void engine.setMusic(null);
      prevScene.current = scene;
      prevPhase.current = phase;
      return;
    }

    // Map the current scene to its BGM track
    if (scene !== prevScene.current || phase !== prevPhase.current) {
      const bgm = SCENE_MUSIC[scene];
      void engine.setMusic(bgm);
    }

    prevScene.current = scene;
    prevPhase.current = phase;
  }, [s.scene, s.phase, s.verdict, audioUnlocked]);

  // -- 4. Ambience: murmur during active debate, off during verdict/done --
  useEffect(() => {
    if (!audioUnlocked) return;
    const debating = s.phase === 'speaking' || s.phase === 'listening' || s.phase === 'thinking';
    void engine.setAmbience(debating);
  }, [s.phase, audioUnlocked]);

  // -- 3. Gavel slam on verdict (triple) --
  const verdictPlayed = useRef(false);
  useEffect(() => {
    if (!audioUnlocked) return;
    if (s.verdict && !verdictPlayed.current) {
      verdictPlayed.current = true;
      engine.gavel(3);
      void engine.setAmbience(false);
    }
  }, [s.verdict, audioUnlocked]);

  // -- Play current line via AudioEngine (with panning) --
  useEffect(() => {
    const line = s.current;
    if (s.phase !== 'speaking' || !line) return;
    if (line.speaker === 'user') {
      orch.lineEnded(line.id);
      return;
    }
    if (line.audioUrl) {
      const speaker = line.speaker as Exclude<Speaker, 'user'>;
      let cancelled = false;
      engine.playVoice(speaker, line.audioUrl)
        .then(() => {
          if (!cancelled) orch.lineEnded(line.id);
        })
        .catch(() => {
          if (!cancelled) orch.lineEnded(line.id);
        });
      return () => {
        cancelled = true;
        engine.stopVoice(); // the phase/line changed: cut (or cancel a still-loading) line
      };
    }
    // No audio URL: use estimated duration as fallback timer
    const t = setTimeout(() => orch.lineEnded(line.id), line.durationMs ?? 3000);
    return () => clearTimeout(t);
  }, [s.current, s.phase, orch]); // eslint-disable-line react-hooks/exhaustive-deps

  // -- Gavel on topic score (single slam) --
  const scoredTopicCount = useRef(0);
  useEffect(() => {
    if (!audioUnlocked) return;
    const scored = s.agenda.filter((t) => t.score != null).length;
    if (scored > scoredTopicCount.current) {
      engine.gavel(1);
      scoredTopicCount.current = scored;
    }
  }, [s.agenda, audioUnlocked]);

  // -- STT helper --
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

  // -- 2. OBJECTION sting on interrupt --
  async function down() {
    if (held.current) return;
    await unlockAudio();
    const phase = orch.getState().phase;
    if (phase === 'speaking') {
      if (!orch.beginInterrupt()) return;
      // Play OBJECTION sting (cuts voice, plays sfx, ducks music)
      engine.objection();
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
      if (q) {
        await unlockAudio();
        orch.start(q);
      } else setNeedTyping(true);
    } else if (phase === 'listening') {
      if (blob) orch.endInterrupt(blob);
      else setNeedTyping(true);
    }
  }

  const submitTyped = useCallback(() => {
    const text = typed.trim();
    const phase = orch.getState().phase;
    if (!text || (phase !== 'ask' && phase !== 'listening')) return; // don't swallow text mid-debate
    setTyped('');
    setNeedTyping(false);
    void unlockAudio();
    if (phase === 'ask') orch.start(text);
    else orch.endInterrupt(text);
  }, [typed, orch, unlockAudio]);

  // -- Keyboard handler: Space to hold-to-talk --
  useEffect(() => {
    const kd = (e: KeyboardEvent) =>
      e.code === 'Space' && !e.repeat && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && (e.preventDefault(), down());
    const ku = (e: KeyboardEvent) =>
      e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA' && (e.preventDefault(), up());
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


  // -- Expressions (sticky) + talking (independent), derived from the transcript --
  const moods = useMemo(() => deriveMoods(s), [s]);

  // -- Textbox content --
  const box =
    s.phase === 'speaking' && line
      ? { name: WHO[line.speaker].name, color: WHO[line.speaker].color, text: line.text }
      : s.phase === 'listening'
        ? {
            name: 'YOU',
            color: WHO.user.color,
            text: `Interrupting ${
              s.interruptTarget === 'judge'
                ? 'the Judge (add or remove a topic)'
                : s.interruptTarget === 'prosecution'
                  ? 'YES'
                  : 'NO'
            }… speak, then release.`,
          }
        : s.phase === 'ask'
          ? { name: 'THE COURT', color: '#a16207', text: 'Hold to talk and ask: "Should I …?"' }
          : undefined;

  const controls = (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!canTalk}
          onPointerDown={down}
          onPointerUp={up}
          onPointerLeave={() => held.current && up()}
          className="min-h-11 flex-1 rounded-full bg-red-600 px-4 py-2 text-xs font-bold uppercase tracking-wide disabled:opacity-40"
        >
          {holding ? 'Listening… release' : s.phase === 'ask' ? 'Hold to ask' : 'Hold to interrupt'}
        </button>
        <span className="text-[10px] text-zinc-500">or SPACE</span>
      </div>
      {(needTyping || s.phase === 'ask') && (
        <div className="flex gap-2">
          <label htmlFor="typed" className="sr-only">
            Type instead
          </label>
          <input
            type="text"
            id="typed"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitTyped();
              }
            }}
            placeholder={s.phase === 'ask' ? 'or type: Should I…?' : 'Type your interruption'}
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs"
          />
          <button type="button" onClick={submitTyped} className="min-h-9 rounded-lg border border-zinc-600 px-3 text-xs">
            Send
          </button>
        </div>
      )}
    </div>
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-zinc-100">
      {/* Full-bleed manga courtroom */}
      <div className="absolute inset-0">
        <Courtroom
          scene={s.scene}
          moods={moods}
          speakerName={box?.name}
          speakerColor={box?.color}
          text={box?.text}
          objection={s.phase === 'listening'}
          status={s.phase === 'preparing' || s.phase === 'thinking' ? s.status : undefined}
          controls={controls}
        />
      </div>

      {/* Top-left: question + topic/cycle */}
      <header className="absolute left-4 top-4 z-50 max-w-md rounded-lg bg-black/70 px-4 py-2">
        <h1 className="text-sm font-black tracking-tight">Court of Future Selves</h1>
        <p className="text-xs text-zinc-400">
          {s.question ? `"${s.question}"` : 'Ask a yes/no question to begin'}
        </p>
        {active && (
          <p className="mt-1 text-xs text-amber-500">
            {active.title} · cycle {s.cycle}/{s.totalCycles}
          </p>
        )}
      </header>

      {/* Top-right: spectrum + agenda */}
      <aside className="absolute right-4 top-4 z-50 w-72 rounded-lg bg-black/70 p-3">
        <div className="relative h-2 rounded-full bg-gradient-to-r from-blue-600 via-zinc-600 to-orange-600">
          <div className="absolute -top-1 h-4 w-1 rounded bg-white transition-all" style={{ left: pos }} />
        </div>
        <p className="mt-1 text-center text-xs font-bold">
          {s.spectrum.value > 0 ? '+' : ''}
          {s.spectrum.value} · {s.spectrum.label}
        </p>
        {s.agenda.length > 0 && (
          <ul className="mt-2 flex flex-col gap-1 text-xs">
            {s.agenda.map((t) => (
              <li
                key={t.id}
                className={`flex justify-between gap-2 ${
                  t.status === 'removed'
                    ? 'text-zinc-600 line-through'
                    : t.id === s.activeTopicId
                      ? 'font-bold text-white'
                      : 'text-zinc-400'
                }`}
              >
                <span>
                  {t.title}
                  {t.added_by === 'user' ? ' (yours)' : ''}
                </span>
                <span className="shrink-0">
                  {Math.round(t.importance * 100)}%
                  {t.score ? ` · ${t.score.t > 0 ? '+' : ''}${t.score.t.toFixed(2)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.fallbacks.length > 0 && (
          <p className="mt-2 text-[10px] text-zinc-500">
            Mock data: {[...new Set(s.fallbacks)].join(', ')}
          </p>
        )}
      </aside>

      {/* Verdict + transcript overlay */}
      {s.result && (
        <section className="absolute inset-x-4 bottom-4 top-20 z-[60] mx-auto flex max-w-3xl flex-col gap-4 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-950/95 p-6">
          <h2 className="text-xl font-black">
            Verdict: {s.result.verdict?.spectrum.label} ({s.spectrum.value > 0 ? '+' : ''}
            {s.spectrum.value})
          </h2>
          <p className="text-zinc-300">{s.result.verdict?.explanation}</p>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Transcript</h3>
          <ol className="flex flex-col gap-1 text-sm">
            {s.result.lines.map((l) => (
              <li key={l.id}>
                <strong style={{ color: WHO[l.speaker].color }}>{WHO[l.speaker].name}:</strong> {l.text}
                {footnotes(s.result!, l).map((n) => (
                  <sup key={n} className="ml-0.5 text-zinc-400">
                    [{n}]
                  </sup>
                ))}
              </li>
            ))}
          </ol>
          <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Sources</h3>
          <ol className="flex flex-col gap-1 text-sm text-zinc-300">
            {s.result.sources.map((c, i) => (
              <li key={c.id}>
                [{i + 1}] {c.evidence} ·{' '}
                {c.source_url ? (
                  <a className="underline" href={c.source_url} target="_blank" rel="noreferrer">
                    {c.source_name}
                  </a>
                ) : (
                  c.source_name
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </main>
  );
}
