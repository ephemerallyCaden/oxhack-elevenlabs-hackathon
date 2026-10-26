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
import type { Scene, Speaker } from '@/types';
import { TrialOrchestrator } from '@/lib/debate/orchestrator';
import { ReplayTrial, loadDemo, type Trial } from '@/lib/debate/replay';
import { useMockMode } from '@/lib/byok/browser';
import { sessionVoiceId } from '@/components/onboarding/VoiceStep';
import { useSessionHeads } from '@/components/onboarding/sessionHeads';
import VerdictScreen from '@/components/menu/VerdictScreen';
import { signOut } from '@/lib/auth/browser';
import { leaveCourt, reloadIfRestored } from '@/components/menu/leaveCourt';
import { unlockSoon as unlockSoonWith } from '@/components/courtroom/audioUnlock';
import { sessionProfile, takeSessionQuestion } from '@/lib/onboarding/session';
import { useTrialState } from '@/lib/debate/useTrial';
import * as engine from '@/lib/audio/engine';
import type { BgmName } from '@/lib/audio/assets';
import Courtroom from '@/components/courtroom/Courtroom';
import { deriveMoods, type CharacterMood } from '@/components/courtroom/expressions';
import { runPunch, type PunchStage } from '@/components/courtroom/punchSequence';
import { setupText } from '@/lib/debate/punch';
import { SPEAKER_SCENE } from '@/types';
import { WHO } from '@/components/courtroom/roles';
import { useRecorder, transcribe } from '@/components/useRecorder';

// -- Scene -> BGM mapping --
const SCENE_MUSIC: Record<Scene, BgmName | null> = {
  yes: 'trial',
  no: 'trial',
  judge: 'trial',
  witness: 'trial',
  cutscene: 'cutscene',
};

/**
 * The "type instead" box. Owns the typed text so a keystroke re-renders only this box, not the
 * courtroom. The box unmounts (intro, between asks), so the page keeps the draft across mounts.
 */
function TypedInput({
  loadDraft,
  saveDraft,
  placeholder,
  onSubmit,
}: {
  loadDraft: () => string;
  saveDraft: (text: string) => void;
  placeholder: string;
  onSubmit: (text: string) => boolean;
}) {
  const [typed, setTyped] = useState(loadDraft);
  const change = (text: string) => {
    saveDraft(text);
    setTyped(text);
  };
  const submit = () => {
    if (onSubmit(typed)) change('');
  };
  return (
    <div className="flex gap-2">
      <label htmlFor="typed" className="sr-only">
        Type instead
      </label>
      <input
        type="text"
        id="typed"
        value={typed}
        onChange={(e) => change(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="min-h-9 min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-xs"
      />
      <button type="button" onClick={submit} className="min-h-9 rounded-lg border border-zinc-600 px-3 text-xs">
        Send
      </button>
    </div>
  );
}

/** The trial on screen. A new trial page (layout.tsx remounts it per push) stops the one it replaces. */
let live: Trial | null = null;

/** ?demo=<id>: replay a stored demo trial (public/demos) instead of running one. Client only. */
const demoParam = () => (typeof window === 'undefined' ? null : new URLSearchParams(location.search).get('demo'));

const unlockSoon = () => unlockSoonWith(engine.unlock);

// -- Main trial page --
export default function TrialPage() {
  // Onboarding (/) leaves the user's cloned voice + profile in sessionStorage; none → presenter voice.
  // State, not memo: a memo is recomputed on Fast Refresh, which would orphan a running trial.
  const [demo] = useState(demoParam);
  const [orch] = useState<Trial>(() => (demo ? new ReplayTrial(loadDemo(demo)) : new TrialOrchestrator({ voiceId: sessionVoiceId(), profile: sessionProfile() })));
  const mock = useMockMode();
  const s = useTrialState(orch);
  // Head cut-outs from onboarding (client-only, so the server render keeps the default heads)
  const heads = useSessionHeads();
  const recorder = useRecorder();
  const [holding, setHolding] = useState(false);
  const held = useRef(false);
  const typedDraft = useRef('');
  const loadDraft = useCallback(() => typedDraft.current, []);
  const saveDraft = useCallback((text: string) => {
    typedDraft.current = text;
  }, []);
  const [needTyping, setNeedTyping] = useState(false);
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  // Crane-up intro: hold on the carpet while the trial loads (no line yet), play as soon as
  // the first line is ready (so the hold lasts exactly the loading time), once per trial.
  // The court is only revealed by the crane, so it holds through 'ask' too.
  const [introFinished, setIntroFinished] = useState(false);
  const introMode = introFinished || s.phase === 'done' ? null : s.current ? 'play' : 'hold';
  // The ask prompt stays hidden until we know no question arrived from onboarding (that one starts by itself).
  const [askOpen, setAskOpen] = useState(false);
  const asking = s.phase === 'ask' && askOpen;
  const finishIntro = useCallback(() => setIntroFinished(true), []);
  // Surprise punch: which beat of the sequence is on screen, and a counter that shakes the screen.
  const [punchStage, setPunchStage] = useState<PunchStage | null>(null);
  const [shakeKey, setShakeKey] = useState(0);

  // Track previous scene/phase for change detection
  const prevScene = useRef<Scene | undefined>(s.scene);
  const prevPhase = useRef<typeof s.phase | undefined>(s.phase);

  // Leaving the court (Back, or the route kept alive in the background): stop the music, crowd and
  // voice. Coming back re-runs the music effect (the refs are cleared so it picks the track again).
  useEffect(
    () => () => {
      void engine.setMusic(null);
      void engine.setAmbience(false);
      engine.stopVoice();
      prevScene.current = undefined;
      prevPhase.current = undefined;
      if (held.current) {
        // Left mid-hold: turn the mic off (and don't come back half-holding).
        held.current = false;
        setHolding(false);
        void recorder.stop();
      }
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps -- unmount/hide only
  );

  // Leaving the court (verdict screen, or a broken trial): silence, then a full load (leaveCourt.ts).
  const leave = (href: string) => {
    void engine.setMusic(null);
    void engine.setAmbience(false);
    // Main menu replaces the history entry: Back from the menu never returns to the finished trial.
    void leaveCourt(href, { signOut, assign: (h) => (h === '/' ? location.replace(h) : location.assign(h)) });
  };

  // -- Audio unlock on first user gesture --
  /** Resolves true once audio can play (now or within the wait). */
  const unlockAudio = useCallback(async (): Promise<boolean> => {
    if (audioUnlocked) return true;
    if (await unlockSoon()) {
      setAudioUnlocked(true);
      return true;
    }
    void engine.unlock().then(() => setAudioUnlocked(true), () => {}); // a late resume() still counts
    return false;
  }, [audioUnlocked]);
  // Lines read this (not the state) so an unlock mid-line doesn't replay it.
  const audioOn = useRef(audioUnlocked);
  useEffect(() => {
    audioOn.current = audioUnlocked;
  }, [audioUnlocked]);
  // Still locked (Safari didn't count the click on "/" as permission): any tap or key brings the sound back.
  useEffect(() => {
    if (audioUnlocked) return;
    // Every gesture tries again until it works (iOS only counts touchend/click, not pointerdown).
    const unlock = () => void unlockAudio();
    const events = ['pointerdown', 'pointerup', 'click', 'keydown'] as const;
    for (const e of events) window.addEventListener(e, unlock);
    return () => {
      for (const e of events) window.removeEventListener(e, unlock);
    };
  }, [audioUnlocked, unlockAudio]);

  // -- 0. Arrived from onboarding: start straight away with the confirmed question --
  // (the "Take it to court" click on / counts as the user gesture for audio)
  // Back after "Main menu" can restore this whole page from the browser's back/forward cache (verdict,
  // faces, the signed-out session in memory): reload it instead, so the next person starts clean.
  useEffect(() => reloadIfRestored(), []);

  const autoStarted = useRef(false);
  useEffect(() => {
    if (live !== orch) {
      live?.stop(); // e.g. Back during "preparing", then a new question: the old trial must not keep calling APIs
      live = orch;
    }
    if (autoStarted.current) return;
    autoStarted.current = true;
    const q = demo ? '' : takeSessionQuestion(); // a demo plays its own recorded question
    if (!q && !demo) {
      queueMicrotask(() => setAskOpen(true));
      return;
    }
    // Start even if the browser won't unlock audio (no gesture, Safari): a silent trial beats a stuck carpet.
    void unlockSoon().then((ok) => {
      if (ok) setAudioUnlocked(true);
      else void engine.unlock().then(() => setAudioUnlocked(true), () => {}); // late unlock still gets the music
      orch.start(q ?? '');
    });
  }, [orch, demo]);

  // -- 1. Scene-based BGM: change music when scene changes --
  const verdictMusic = useRef(false);
  useEffect(() => {
    if (!audioUnlocked) return;
    const scene = s.scene;
    const phase = s.phase;

    // On verdict, switch to verdict music (once: it doesn't loop, so a Back/forward reveal mustn't restart it)
    if (s.verdict) {
      if (!verdictMusic.current) void engine.setMusic('verdict');
      verdictMusic.current = true;
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
    if (s.phase !== 'speaking' || !line || introMode) return; // the first line waits for the intro
    if (line.speaker === 'user') {
      orch.lineEnded(line.id);
      return;
    }
    if (line.punch && (line.speaker === 'prosecution' || line.speaker === 'defense')) {
      const speaker = line.speaker;
      const ctl = new AbortController();
      const sleep = (ms: number) =>
        new Promise<void>((done) => {
          const t = setTimeout(done, ms);
          ctl.signal.addEventListener('abort', () => (clearTimeout(t), done()), { once: true });
        });
      void runPunch(
        line,
        {
          stage: setPunchStage,
          // Locked audio never finishes a clip: play the beat silently on its timing instead.
          clip: (url, ms) => (url && audioOn.current ? engine.playVoice(speaker, url).catch(() => {}) : sleep(ms)),
          sfx: (name) => void (audioOn.current && engine.playSfx(name)), // locked: they'd all fire at once on unlock
          shake: () => setShakeKey((k) => k + 1),
          sleep,
        },
        ctl.signal,
      ).then(() => {
        if (ctl.signal.aborted) return;
        setPunchStage(null);
        orch.lineEnded(line.id);
      });
      return () => {
        ctl.abort();
        engine.stopVoice(); // interrupted mid-punch: cut the clip
        setPunchStage(null);
      };
    }
    // Locked audio (no gesture yet) would never end the clip: fall through to the timer and play silently.
    if (line.audioUrl && audioOn.current) {
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
  }, [s.current, s.phase, orch, introMode]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // -- 2. OBJECTION sting on interrupt --
  async function down() {
    if (held.current) return;
    const unlocking = unlockAudio(); // not awaited: a locked unlock can take 1.5s, and a quick release must still end the hold
    const phase = orch.getState().phase;
    if (phase === 'speaking') {
      if (!orch.beginInterrupt()) return;
      // Play OBJECTION sting (cuts voice, plays sfx, ducks music); still locked: as soon as it unlocks
      if (audioOn.current) engine.objection();
      else void unlocking.then((ok) => ok && orch.getState().phase === 'listening' && engine.objection()); // only if still interrupting
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

  /** Returns whether the text was taken (the box then clears). */
  const submitTyped = useCallback(
    (raw: string) => {
      const text = raw.trim();
      const phase = orch.getState().phase;
      if (!text || (phase !== 'ask' && phase !== 'listening')) return false; // don't swallow text mid-debate
      setNeedTyping(false);
      void unlockAudio();
      if (phase === 'ask') orch.start(text);
      else orch.endInterrupt(text);
      return true;
    },
    [orch, unlockAudio],
  );

  // -- Keyboard handler: Space to hold-to-talk --
  useEffect(() => {
    // Space is hold-to-talk, except in a text field or on the verdict screen's buttons (they take Space),
    // and not while the court is still hidden behind the intro (nothing on screen to talk to).
    const free = () => {
      const el = document.activeElement;
      if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return false;
      return !el?.closest('[aria-label="Verdict"]') && !(introMode && !asking) && orch.getState().phase !== 'done'; // done: Space is the focused button's
    };
    const kd = (e: KeyboardEvent) => e.code === 'Space' && !e.repeat && free() && (e.preventDefault(), down());
    const ku = (e: KeyboardEvent) => e.code === 'Space' && free() && (e.preventDefault(), up());
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
    };
  });

  const line = s.current;
  const active = s.agenda.find((t) => t.id === s.activeTopicId);
  const canTalk = s.phase === 'ask' || (s.phase === 'speaking' && s.canInterrupt) || holding;


  // -- Expressions (sticky) + talking (independent), derived from the transcript --
  // Surprise punch on screen: who punched, who reacts, which shot.
  const punchLine = punchStage && s.phase === 'speaking' && line?.punch ? line : undefined;
  const punchWho = punchLine?.speaker === 'prosecution' || punchLine?.speaker === 'defense' ? punchLine.speaker : undefined;
  const punchOpp = punchWho === 'prosecution' ? 'defense' : 'prosecution';
  const shot =
    !punchWho ? undefined
      : punchStage === 'to-judge' || punchStage === 'judge' ? ('judge' as const)
        : punchStage === 'to-opponent' || punchStage === 'opponent' ? SPEAKER_SCENE[punchOpp]
          : undefined;

  const moods = useMemo(() => {
    const m = deriveMoods(s);
    if (introMode) for (const who of ['prosecution', 'defense', 'judge'] as const) m[who] = { ...m[who], talking: false };
    if (punchWho && punchStage) {
      const shocked: CharacterMood = { expression: 'shocked', talking: false };
      m[punchWho] = { ...m[punchWho], talking: punchStage === 'setup' };
      if (punchStage === 'judge' || punchStage === 'to-opponent' || punchStage === 'opponent') m.judge = shocked;
      if (punchStage === 'opponent') m[punchOpp] = shocked;
    }
    return m;
  }, [s, introMode, punchWho, punchOpp, punchStage]);

  const punch =
    punchWho && punchLine?.punch && punchStage && punchStage !== 'setup'
      ? {
          who: punchWho,
          stage: punchStage === 'cut' || punchStage === 'punch' ? punchStage : punchStage === 'to-judge' ? ('out' as const) : ('gone' as const),
          // The speaker keeps their current expression; talks while the punch plays.
          mood: { expression: moods[punchWho].expression, talking: punchStage === 'punch' },
          typeMs: punchStage === 'punch' ? (punchLine.punch.durationMs ?? 1400) * 0.9 : 0,
        }
      : undefined;

  // -- Textbox content --
  const box =
    s.phase === 'speaking' && line
      ? {
          name: WHO[line.speaker].name,
          color: WHO[line.speaker].color,
          text: !line.punch ? line.text : !punchStage || punchStage === 'setup' ? setupText(line) : punchStage === 'cut' ? '' : line.punch.text,
        }
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
        <TypedInput
          loadDraft={loadDraft}
          saveDraft={saveDraft}
          placeholder={s.phase === 'ask' ? 'or type: Should I…?' : 'Type your interruption'}
          onSubmit={submitTyped}
        />
      )}
    </div>
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black text-zinc-100" data-punch-stage={punchStage ?? undefined}>
      {/* Full-bleed manga courtroom */}
      <div className="absolute inset-0">
        <Courtroom
          scene={s.scene}
          moods={moods}
          speakerName={introMode && !asking ? undefined : box?.name}
          speakerColor={box?.color}
          text={introMode && !asking ? undefined : box?.text}
          objection={s.phase === 'listening'}
          status={
            introMode === 'play' ? undefined : s.phase === 'preparing' || s.phase === 'thinking' || (s.phase === 'done' && !s.result) ? s.status : undefined
          }
          controls={(introMode && !asking) || s.phase === 'done' ? undefined : controls}
          heads={heads}
          interrupting={s.phase === 'listening'}
          interrupted={s.interruptTarget === 'user' ? undefined : s.interruptTarget}
          intro={introMode}
          onIntroDone={finishIntro}
          shot={shot}
          punch={punch}
          shakeKey={shakeKey}
          spectrum={{
            value: s.spectrum.value,
            scored: s.agenda.filter((t) => t.score != null).length,
            verdict: !!s.verdict,
            visible: !introMode && s.phase !== 'ask',
          }}
          sfx={(name, volume) => void engine.playSfx(name, { volume })}
        />
      </div>

      {/* Top-left: question + topic/cycle (hidden through the intro, shown while asking) */}
      {(!introMode || asking) && (
        <header className="absolute left-4 top-4 z-50 max-w-md rounded-lg bg-black/70 px-4 py-2">
          <h1 className="text-sm font-black tracking-tight">Court of Future Selves</h1>
          {demo ? (
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Recorded demo · no keys used</p>
          ) : mock ? (
            <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Mock trial · scripted lines, no AI or voices</p>
          ) : null}
          <p className="text-xs text-zinc-400">
            {s.question ? `"${s.question}"` : 'Ask a yes/no question to begin'}
          </p>
          {active && (
            <p className="mt-1 text-xs text-amber-500">
              {active.title} · cycle {s.cycle}/{s.totalCycles}
            </p>
          )}
        </header>
      )}

      {/* Top-right: agenda (hidden through the intro); the spectrum is the HUD in the courtroom */}
      {!introMode && (s.agenda.length > 0 || s.fallbacks.length > 0) && (
        <aside className="absolute right-4 top-4 z-50 w-72 rounded-lg bg-black/70 p-3">
          {s.agenda.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
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
      )}

      {/* Verdict: the end of the loop (new case / save & share / court record / main menu) */}
      {s.result && (
        <VerdictScreen
          transcript={s.result}
          value={(s.result.verdict?.spectrum ?? s.spectrum).value}
          label={(s.result.verdict?.spectrum ?? s.spectrum).label}
          heads={heads}
          onLeave={leave}
        />
      )}

      {/* The trial broke (no verdict): still a way out, same as the verdict screen's. */}
      {s.phase === 'done' && !s.result && (
        <div className="absolute inset-x-0 bottom-[24%] z-[60] flex justify-center gap-3">
          <button type="button" className="min-h-11 rounded bg-zinc-100 px-5 font-mono text-sm font-bold text-black" onClick={() => leave('/?again=1')}>
            Try a new case
          </button>
          <button type="button" className="min-h-11 rounded border border-zinc-500 px-5 font-mono text-sm text-zinc-100" onClick={() => leave('/')}>
            Main menu
          </button>
        </div>
      )}
    </main>
  );
}
