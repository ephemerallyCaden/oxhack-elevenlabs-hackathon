// D4: the courtroom state machine. Runs in the browser; talks to our API routes and drives C4's player.
//
//   input → parsing → simulating → scripting → voicing → debate (round 1, window, 2, window, 3) → verdict → done
//
// Every phase has a cached fallback, so the flow always reaches the verdict.
// Usage (C wires this up):
//   const orch = useMemo(() => new DebateOrchestrator(player, { demo }), []);
//   useDebatePlayer({ onEventStart: orch.onEventStart, onQueueEnd: orch.onQueueEnd });
//   const state = useOrchestratorState(orch);
import type {
  DebateEvent,
  DebatePhase,
  DebatePlayerCallbacks,
  DebatePlayerControls,
  IngestResponse,
  InterruptResponse,
  ParsedDecision,
  ParseResponse,
  ScriptResponse,
  SimInput,
  SimulateResponse,
  SttResponse,
  VerdictResponse,
  VoiceDebateResponse,
} from '@/types';
import demoSim from './fixtures/demo-sim.json';
import mockEvents from './mock-events.json';
import mockElaborations from './mock-elaborations.json';
import { type DemoRun, loadDemoRun } from './demoRun';
import { FALLBACK_CHALLENGE, FALLBACK_INTERRUPT_REPLY, FIXED_LINES, postJson, withFallback } from './fallback';

export const INTERRUPT_TOKENS = 3;
export const INTERRUPT_WINDOW_MS = 10000;

export interface OrchestratorState {
  phase: DebatePhase;
  /** 1-3 during the debate, 4 = verdict. */
  round: number;
  tokens: number;
  transcript?: string;
  decision?: ParsedDecision;
  /** For the loading screen (C5) and verdict charts (C7). */
  sim?: SimulateResponse;
  current?: DebateEvent;
  /** Epoch ms when the post-round interrupt window closes (for a countdown). */
  windowEndsAt?: number;
  /** What the user said in their last INTERRUPT. */
  lastChallenge?: string;
  /** Can HOLD IT be pressed right now? */
  canHoldIt: boolean;
  /** Stages that used cached data instead of a live call (show in a dev overlay, not to judges). */
  fallbacks: string[];
}

const FIXTURE_SIM = { result: demoSim.result, findings: demoSim.findings, sensitivity: demoSim.sensitivity, fallback: true } as SimulateResponse;
const MOCK_SCRIPT = {
  events: mockEvents as DebateEvent[],
  elaborations: { ...(mockElaborations as Record<string, DebateEvent[]>), ...FIXED_LINES },
};

const splash = (interrupt_type: DebateEvent['interrupt_type'], interrupt_flavor: string): DebateEvent => ({
  id: `u-${interrupt_type}-${Date.now().toString(36)}`,
  timestamp: 0,
  type: 'interrupt',
  speaker: 'user',
  interrupt_type,
  interrupt_flavor,
  effect: 'flash_white',
  // flash + 1s of silence before the next line (research/09 §8)
  durationMs: 1300,
});

/** Fill the sim's inputs from what the user said; everything else from the demo defaults (A2 refines). */
function buildSimInput(d: ParsedDecision): SimInput {
  const base = demoSim.result.input as SimInput;
  return {
    ...base,
    options: d.options,
    time_horizon_years: d.time_horizon_years,
    risk_tolerance: d.risk_tolerance,
    happiness_params: d.happiness_params,
    current_salary: d.stated?.current_salary ?? base.current_salary,
    starting_savings: d.stated?.starting_savings ?? base.starting_savings,
  };
}

/** Which part of the debate an event belongs to: 1-3 = rounds, 4 = verdict. */
/** Unrounded events take the round before them (intro → 1); after round 3 they are the verdict. */
function chunkIndex(events: DebateEvent[]): number[] {
  let current = 1;
  return events.map((e) => {
    if (e.round) return (current = e.round);
    return current === 3 ? 4 : current;
  });
}

export class DebateOrchestrator implements DebatePlayerCallbacks {
  private state: OrchestratorState = { phase: 'input', round: 1, tokens: INTERRUPT_TOKENS, canHoldIt: false, fallbacks: [] };
  private listeners = new Set<() => void>();

  private events: DebateEvent[] = [];
  private chunks: number[] = [];
  private elaborations: Record<string, DebateEvent[]> = {};
  private usedElaborations = new Set<string>();
  /** Voiced copies of fixed/fallback lines by id, so text-only events from the server get audio. */
  private voicedById = new Map<string, DebateEvent>();
  /** Index in `events` of the next main event to play. */
  private resumeAt = 0;
  private playingChunk = 1;
  private windowTimer?: ReturnType<typeof setTimeout>;
  private userChallenges: string[] = [];
  private pendingVerdict?: Promise<DebateEvent[] | null>;
  private demoRun: Promise<DemoRun | null>;

  constructor(
    private player: DebatePlayerControls,
    private opts: { demo?: boolean; voiceId?: string } = {},
  ) {
    // Load the cached run up front: demo mode plays it; live mode uses its audio when a stage falls back.
    this.demoRun = typeof window === 'undefined' ? Promise.resolve(null) : loadDemoRun();
  }

  // ── store (for useSyncExternalStore) ──────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<OrchestratorState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private fellBack(stage: string) {
    this.set({ fallbacks: [...this.state.fallbacks, stage] });
  }

  // ── pre-debate pipeline ───────────────────────────────────────────────────
  /** Run the whole pipeline on what the user said (from B6's hold-to-talk). */
  async start(transcript: string) {
    if (this.opts.demo) return this.startDemo(transcript);
    const demo = await this.demoRun;

    this.set({ phase: 'parsing', transcript });
    const parsed = await withFallback(
      (signal) => postJson<ParseResponse>('/api/debate/parse', { transcript }, signal),
      { decision: demo?.decision ?? (demoSim.decision as ParsedDecision), fallback: true },
      6000,
      'parse',
    );
    if (parsed.fallback || parsed.value.fallback) this.fellBack('parse');
    const decision = parsed.value.decision;
    this.set({ phase: 'simulating', decision });

    const ingest = await withFallback(
      (signal) => postJson<IngestResponse>('/api/ingest', { decision }, signal),
      { dataPoints: [], fallback: true },
      10000,
      'ingest',
    );
    if (ingest.fallback || ingest.value.fallback) this.fellBack('ingest');
    const sim = await withFallback(
      (signal) => postJson<SimulateResponse>('/api/simulate', { input: buildSimInput(decision), dataPoints: ingest.value.dataPoints }, signal),
      demo?.sim ?? FIXTURE_SIM,
      5000,
      'simulate',
    );
    if (sim.fallback || sim.value.fallback) this.fellBack('simulate');
    this.set({ phase: 'scripting', sim: sim.value });

    const script = await withFallback(
      (signal) =>
        postJson<ScriptResponse>(
          '/api/debate/script',
          { decision, result: sim.value.result, findings: sim.value.findings, sensitivity: sim.value.sensitivity },
          signal,
        ),
      { ...(demo ?? MOCK_SCRIPT), fallback: true },
      30000,
      'script',
    );
    if (script.fallback || script.value.fallback) this.fellBack('script');

    // If the script is the cached one and we have its cached audio, skip voicing entirely.
    let voiced: Pick<VoiceDebateResponse, 'events' | 'elaborations'>;
    if ((script.fallback || script.value.fallback) && demo) {
      voiced = demo;
    } else {
      this.set({ phase: 'voicing' });
      const v = await withFallback(
        (signal) =>
          postJson<VoiceDebateResponse>(
            '/api/voice/debate',
            { events: script.value.events, elaborations: script.value.elaborations, voiceId: this.opts.voiceId },
            signal,
          ),
        { events: script.value.events, elaborations: script.value.elaborations, fallback: true },
        25000,
        'voice',
      );
      if (v.fallback || v.value.fallback) this.fellBack('voice');
      voiced = v.value;
    }
    if (demo) this.rememberVoiced([...demo.events, ...Object.values(demo.elaborations).flat(), ...demo.interrupt.response.events]);
    this.beginDebate(voiced.events, voiced.elaborations);
  }

  /** ?demo=1 — play the cached run with believable loading times. Works offline. */
  private async startDemo(transcript?: string) {
    const demo = await this.demoRun;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    this.set({ phase: 'parsing', transcript: transcript ?? demo?.transcript });
    await wait(900);
    this.set({ phase: 'simulating', decision: demo?.decision ?? (demoSim.decision as ParsedDecision) });
    await wait(2500);
    this.set({ phase: 'scripting', sim: demo?.sim ?? FIXTURE_SIM });
    await wait(2000);
    this.set({ phase: 'voicing' });
    await wait(1200);
    if (!demo) this.fellBack('demo-run.json missing — using mock (no audio)');
    const run = demo ?? MOCK_SCRIPT;
    this.rememberVoiced([...run.events, ...Object.values(run.elaborations).flat(), ...(demo?.interrupt.response.events ?? [])]);
    this.beginDebate(run.events, run.elaborations);
  }

  private rememberVoiced(events: DebateEvent[]) {
    for (const e of events) if (e.audioUrl) this.voicedById.set(e.id, e);
  }
  private voiced = (e: DebateEvent) => this.voicedById.get(e.id) ?? e;

  private beginDebate(events: DebateEvent[], elaborations: Record<string, DebateEvent[]>) {
    this.events = events;
    this.chunks = chunkIndex(events);
    this.elaborations = elaborations;
    this.rememberVoiced(Object.values(elaborations).flat());
    this.set({ phase: 'debate', round: 1, tokens: INTERRUPT_TOKENS });
    this.playFrom(0);
  }

  // ── playback ──────────────────────────────────────────────────────────────
  /** Play main events from index i to the end of i's chunk, after `prefix`. */
  private playFrom(i: number, prefix: DebateEvent[] = []) {
    const chunk = this.chunks[i] ?? 4;
    let end = i;
    while (end < this.events.length && this.chunks[end] === chunk) end++;
    this.playingChunk = chunk;
    this.resumeAt = i;
    this.player.load([...prefix, ...this.events.slice(i, end)].map(this.voiced));
    this.set({ round: chunk });
  }

  onEventStart = (event: DebateEvent) => {
    const i = this.events.findIndex((e) => e.id === event.id);
    if (i >= 0) this.resumeAt = i + 1;
    const holdable =
      this.state.phase === 'debate' &&
      (event.type === 'speech' || event.type === 'interrupt') &&
      (event.speaker === 'prosecution' || event.speaker === 'defense') &&
      !!this.elaborations[`${event.speaker}-${event.round}`] &&
      !this.usedElaborations.has(`${event.speaker}-${event.round}`);
    this.set({ current: event, canHoldIt: holdable });
  };

  onQueueEnd = () => {
    const { phase } = this.state;
    if (phase === 'user_speaking' || phase === 'responding') return; // filler finished while we wait — hold
    if (phase === 'verdict') return this.set({ phase: 'done', canHoldIt: false });
    if (phase !== 'debate') return;
    if (this.playingChunk < 3) return this.openWindow();
    return this.playVerdict();
  };

  private openWindow() {
    const next = this.resumeAt;
    this.set({ phase: 'interrupt_window', windowEndsAt: Date.now() + INTERRUPT_WINDOW_MS, canHoldIt: false });
    this.windowTimer = setTimeout(() => this.continueNow(next), INTERRUPT_WINDOW_MS);
  }

  /** Close the interrupt window early (e.g. a "Continue" button). */
  continueNow(next = this.resumeAt) {
    clearTimeout(this.windowTimer);
    if (this.state.phase !== 'interrupt_window') return;
    this.set({ phase: 'debate', windowEndsAt: undefined });
    this.playFrom(next);
  }

  private async playVerdict() {
    this.set({ phase: 'verdict', canHoldIt: false });
    const reRuled = this.pendingVerdict ? await this.pendingVerdict : null;
    if (reRuled?.length) {
      this.playingChunk = 4;
      this.player.load(reRuled.map(this.voiced));
      return;
    }
    const first = this.chunks.indexOf(4);
    if (first < 0) return this.set({ phase: 'done' });
    this.playFrom(first);
    this.set({ phase: 'verdict' });
  }

  // ── user controls ─────────────────────────────────────────────────────────
  /** MOVE ON: skip the current speaker. */
  moveOn() {
    if (this.state.phase !== 'debate') return;
    this.playFrom(this.resumeAt, [splash('skip', 'MOVE ON!')]);
  }

  /** HOLD IT: current speaker elaborates on their last point (pre-generated, instant). */
  holdIt() {
    const cur = this.state.current;
    if (!this.state.canHoldIt || !cur) return;
    const key = `${cur.speaker}-${cur.round}`;
    this.usedElaborations.add(key);
    this.playFrom(this.resumeAt, [splash('elaborate', 'HOLD IT!'), ...this.elaborations[key]]);
  }

  /** INTERRUPT pressed (hold-to-talk starts): flash OBJECTION, stop the debate. Returns false if not allowed. */
  beginInterrupt(): boolean {
    const { phase, tokens } = this.state;
    if (tokens <= 0 || (phase !== 'debate' && phase !== 'interrupt_window')) return false;
    clearTimeout(this.windowTimer);
    this.set({ phase: 'user_speaking', windowEndsAt: undefined, canHoldIt: false });
    this.player.load([splash('user_challenge', Math.random() < 0.7 ? 'OBJECTION!' : 'WAIT!')]);
    return true;
  }

  /** INTERRUPT released: `input` is the recording (→ Scribe) or an already-made transcript. */
  async interrupt(input: Blob | string) {
    if (this.state.phase !== 'user_speaking') return;
    this.set({ phase: 'responding', tokens: this.state.tokens - 1 });
    // Mask latency: "The court considers…" (pre-voiced) while STT + Claude + TTS run.
    this.player.load(FIXED_LINES['judge-considers'].map(this.voiced));

    const demo = this.opts.demo ? await this.demoRun : null;
    let transcript: string;
    let response: InterruptResponse;
    if (this.opts.demo) {
      transcript = demo?.interrupt.challenge ?? FALLBACK_CHALLENGE;
      response = demo?.interrupt.response ?? { relevant: true, responder: 'prosecution', events: [FALLBACK_INTERRUPT_REPLY], fallback: true };
      await new Promise((r) => setTimeout(r, 1500));
    } else {
      transcript = typeof input === 'string' ? input : await this.transcribe(input);
      const recentLines = this.events.slice(0, this.resumeAt).filter((e) => e.type === 'speech' || e.type === 'interrupt').slice(-3);
      const r = await withFallback<InterruptResponse>(
        (signal) =>
          postJson<InterruptResponse>(
            '/api/debate/interrupt',
            {
              transcript,
              context: { decision: this.state.decision ?? demoSim.decision, recentLines, findings: this.state.sim?.findings ?? demoSim.findings, round: this.playingChunk },
            },
            signal,
          ),
        { relevant: true, responder: 'prosecution', events: [FALLBACK_INTERRUPT_REPLY], fallback: true },
        6000,
        'interrupt',
      );
      if (r.fallback || r.value.fallback) this.fellBack('interrupt');
      response = r.value;
    }

    this.set({ lastChallenge: transcript });
    if (!response.relevant) {
      // Penalty: the Judge scolds and the wasted objection costs an extra token.
      this.set({ tokens: Math.max(0, this.state.tokens - 1) });
    } else {
      this.userChallenges.push(transcript);
      this.pendingVerdict = this.reRule(demo);
    }
    this.set({ phase: 'debate' });
    // Resume where we were: rest of the current round, or the next round if we were in the window.
    if (this.resumeAt >= this.events.length || this.chunks[this.resumeAt] === 4) {
      this.player.load(response.events.map(this.voiced));
      this.playingChunk = 3; // reply ends → onQueueEnd → verdict
    } else {
      this.playFrom(this.resumeAt, response.events);
    }
  }

  private async transcribe(audio: Blob): Promise<string> {
    const form = new FormData();
    form.append('audio', audio, 'interrupt.webm');
    const r = await withFallback(
      async (signal) => {
        const res = await fetch('/api/voice/stt', { method: 'POST', body: form, signal });
        if (!res.ok) throw new Error(`stt ${res.status}`);
        return ((await res.json()) as SttResponse).transcript;
      },
      FALLBACK_CHALLENGE,
      5000,
      'stt',
    );
    if (r.fallback || !r.value.trim()) {
      this.fellBack('stt');
      return FALLBACK_CHALLENGE;
    }
    return r.value;
  }

  /** Re-rule the verdict so the Judge acknowledges the user's point. Runs during the rest of the debate. */
  private async reRule(demo: DemoRun | null): Promise<DebateEvent[] | null> {
    if (this.opts.demo) return demo?.verdictAfterInterrupt ?? null;
    const sim = this.state.sim;
    if (!sim || !this.state.decision) return null;
    const v = await withFallback(
      (signal) =>
        postJson<VerdictResponse>(
          '/api/debate/verdict',
          { decision: this.state.decision, result: sim.result, findings: sim.findings, sensitivity: sim.sensitivity, userChallenges: this.userChallenges },
          signal,
        ),
      null,
      8000,
      'verdict',
    );
    if (!v.value) return null;
    const voiced = await withFallback(
      (signal) => postJson<VoiceDebateResponse>('/api/voice/debate', { events: v.value!.events, elaborations: {}, voiceId: this.opts.voiceId }, signal),
      null,
      12000,
      'verdict-voice',
    );
    // A re-ruled verdict without audio is worse than the voiced default one.
    return voiced.value && !voiced.value.fallback ? voiced.value.events : null;
  }
}
