// The trial state machine (browser side). Design: docs/design-core-loop.md
//
//   ask → preparing (cut-scene: agenda + quick research) → opening
//     → OUTER LOOP per topic: intro → INNER LOOP (2 cycles of YES → NO, +1 per user interrupt) → Judge scores → spectrum
//     → verdict → done (transcript)
//
// The UI renders `state.scene` + `state.current`, plays the line (audioUrl, or durationMs as a timer)
// and calls `lineEnded(id)` when it finishes. Interrupts: `beginInterrupt()` on hold, `endInterrupt(audio|text)` on release.
import type {
  AgendaResponse,
  ArgueRequest,
  ArgueResponse,
  EvidenceCard,
  JudgeInterruptResponse,
  LedgerEntry,
  Line,
  Personas,
  PersonasResponse,
  ResearchResponse,
  Scene,
  ScoreArgumentResponse,
  ScoreTopicResponse,
  Side,
  Speaker,
  Spectrum,
  SttResponse,
  Topic,
  Transcript,
  TtsResponse,
  UserProfile,
  Verdict,
  VerdictResponse,
} from '@/types';
import { SPEAKER_SCENE } from '@/types';
import { estimateMs, postJson, uid, withFallback } from './fallback';
import { mockAgenda, mockArgue, mockCards, mockJudgeInterrupt, mockPersonas, mockScoreArgument, mockScoreTopic, mockVerdict } from './mock';
import { addTopic, computeSpectrum, removeTopic } from './spectrum';
import { buildTranscript } from './transcript';
import { TIMEOUTS } from './timeouts';

/** YES → NO cycles per topic before user interrupts add more. */
export const BASE_CYCLES = 2;

export type TrialPhase = 'ask' | 'preparing' | 'speaking' | 'listening' | 'thinking' | 'done';

export interface TrialState {
  phase: TrialPhase;
  scene: Scene;
  question: string;
  /** Who's asking (from onboarding). */
  profile?: UserProfile;
  /** Best (yes) and worst (no) future you: age, when, snapshot, mood. Set during the cut-scene. */
  personas?: Personas;
  agenda: Topic[];
  activeTopicId?: string;
  /** Inner-loop cycle of the active topic (1-based). */
  cycle: number;
  /** Cycles this topic will run: 2 + 1 per user interrupt of YES/NO. */
  totalCycles: number;
  /** The line on screen right now. */
  current?: Line;
  /** Who the user is interrupting (while phase = listening). */
  interruptTarget?: Speaker;
  /** Can INTERRUPT be pressed right now? */
  canInterrupt: boolean;
  /** Short status for loading moments ("The court deliberates…"). */
  status?: string;
  spectrum: Spectrum;
  verdict?: Verdict;
  transcript: Line[];
  cards: EvidenceCard[];
  ledger: LedgerEntry[];
  /** Built when the trial ends. */
  result?: Transcript;
  /** Which calls used mock data (dev overlay only). */
  fallbacks: string[];
}

type SayResult = 'done' | 'interrupted';

export class TrialOrchestrator {
  private state: TrialState = this.initial();
  private listeners = new Set<() => void>();

  private intros: Record<string, Line> = {};
  private quickResearch = new Map<string, Promise<void>>();
  private ledgerPending: Promise<void>[] = [];
  /** Resolves the line currently being said. */
  private sayResolve?: (r: SayResult) => void;
  private inputResolve?: (input: Blob | string | null) => void;
  private inputPromise?: Promise<Blob | string | null>;
  /** Bumped on every interrupt so stale prefetched lines are thrown away. */
  private epoch = 0;
  /** User interrupts of YES/NO answered during the current turn: each adds one cycle. */
  private userAddedCycles = 0;

  constructor(private opts: { voiceId?: string; profile?: UserProfile } = {}) {}

  // ── store ─────────────────────────────────────────────────────────────────
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = () => this.state;
  private set(patch: Partial<TrialState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private initial(): TrialState {
    return { phase: 'ask', scene: 'witness', question: '', agenda: [], cycle: 0, totalCycles: BASE_CYCLES, canInterrupt: false, spectrum: { value: 0, label: 'Toss-up' }, transcript: [], cards: [], ledger: [], fallbacks: [] };
  }
  private topic(id?: string) {
    return this.state.agenda.find((t) => t.id === id);
  }
  private patchTopic(id: string, patch: Partial<Topic>) {
    this.set({ agenda: this.state.agenda.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
  }

  /** POST with timeout + mock fallback; records which calls fell back. */
  private async call<T extends { fallback?: boolean }>(url: string, body: unknown, fallback: () => T, ms: number): Promise<T> {
    const r = await withFallback((signal) => postJson<T>(url, body, signal), fallback, ms, url);
    if (r.fallback || r.value.fallback) this.set({ fallbacks: [...this.state.fallbacks, url.replace('/api/', '')] });
    return r.value;
  }

  // ── UI → orchestrator ─────────────────────────────────────────────────────
  /** The user asked their question (already transcribed). Runs the whole trial. */
  async start(question: string, profile: UserProfile | undefined = this.opts.profile) {
    if (this.state.phase !== 'ask') return; // already running (e.g. a double submit)
    this.state = { ...this.initial(), question, profile };
    this.set({ phase: 'preparing', scene: 'cutscene', status: 'The court is preparing the case…' });
    try {
      await this.run();
    } catch (err) {
      console.error('[trial] crashed', err);
      this.set({ phase: 'done', status: 'The court is adjourned (something broke).' });
    }
  }

  /** The current line finished playing. */
  lineEnded = (id: string) => {
    if (this.state.current?.id === id) this.sayResolve?.('done');
  };

  /** INTERRUPT pressed: stop the line, zoom out to the witness. Returns who is being interrupted, or null. */
  beginInterrupt(): Speaker | null {
    const cur = this.state.current;
    // Only while a line is actually playing: between lines nothing would pick the interrupt up.
    if (!this.state.canInterrupt || !this.sayResolve || !cur || cur.speaker === 'user') return null;
    this.epoch++;
    this.inputPromise = new Promise((r) => (this.inputResolve = r));
    this.set({ phase: 'listening', scene: 'witness', interruptTarget: cur.speaker, canInterrupt: false });
    this.sayResolve?.('interrupted');
    return cur.speaker;
  }

  /** INTERRUPT released: the recording (→ Scribe) or text. null = cancelled. */
  endInterrupt(input: Blob | string | null) {
    this.inputResolve?.(input);
  }

  // ── speaking ──────────────────────────────────────────────────────────────
  /** Attach audio (B's TTS) to a line. Text-only with an estimated duration if voice isn't available. */
  private async prepare(line: Line): Promise<Line> {
    if (line.durationMs != null) return line;
    if (line.speaker === 'user') return { ...line, durationMs: 0 };
    const r = await withFallback<TtsResponse | null>(
      (signal) => postJson<TtsResponse>('/api/voice/tts', { text: line.tts || line.text, speaker: line.speaker, voiceId: this.opts.voiceId }, signal),
      null,
      TIMEOUTS.tts.client,
      'tts',
    );
    return r.value && !r.value.fallback ? { ...line, audioUrl: r.value.audioUrl, durationMs: r.value.durationMs } : { ...line, durationMs: estimateMs(line.text) };
  }

  private async say(line: Line): Promise<SayResult> {
    const ready = await this.prepare(line);
    const done = new Promise<SayResult>((r) => (this.sayResolve = r));
    this.set({
      phase: 'speaking',
      scene: SPEAKER_SCENE[ready.speaker],
      current: ready,
      status: undefined,
      transcript: [...this.state.transcript, ready],
      canInterrupt: ready.kind !== 'verdict',
    });
    const result = await done;
    this.sayResolve = undefined;
    // The line is over: no interrupting it while the next one is generated/voiced.
    if (result === 'done') this.set({ canInterrupt: false });
    return result;
  }

  /** Say a line; if the user interrupts it, deal with the interrupt before returning. */
  private async sayHandled(line: Line): Promise<void> {
    if ((await this.say(line)) === 'interrupted') await this.handleInterrupt();
  }

  private thinking(status: string, scene: Scene = 'judge') {
    this.set({ phase: 'thinking', scene, status, canInterrupt: false });
  }

  // ── research (A's agents) ─────────────────────────────────────────────────
  private research(topics: Topic[]) {
    const add = (r: ResearchResponse) => this.set({ cards: [...this.state.cards, ...r.cards] });
    for (const topic of topics) {
      const q = (side: Side) =>
        this.call<ResearchResponse>(
          '/api/research',
          { question: this.state.question, topic: { id: topic.id, title: topic.title, question: topic.question }, side, tier: 'quick' },
          () => ({ cards: mockCards({ question: this.state.question, topic, side, tier: 'quick' }), fallback: true }),
          TIMEOUTS.quickResearch.client,
        ).then(add);
      this.quickResearch.set(topic.id, Promise.all([q('yes'), q('no')]).then(() => undefined));
      // Deep search lands later and is used by later cycles/topics. No mock: quick cards already cover it.
      for (const side of ['yes', 'no'] as const) {
        withFallback(
          (signal) => postJson<ResearchResponse>('/api/research', { question: this.state.question, topic, side, tier: 'deep' }, signal),
          { cards: [], fallback: true },
          TIMEOUTS.deepResearch.client,
          'deep research',
        ).then((r) => {
          if (!r.fallback) add(r.value);
        });
      }
    }
  }

  // ── the trial ─────────────────────────────────────────────────────────────
  private async run() {
    const { question, profile } = this.state;
    // Agenda and the two future selves are independent: build both during the cut-scene.
    const [agenda, cast] = await Promise.all([
      this.call<AgendaResponse>('/api/trial/agenda', { question, profile }, () => mockAgenda(question), TIMEOUTS.agenda.client),
      this.call<PersonasResponse>('/api/trial/personas', { question, profile }, () => mockPersonas({ question, profile }), TIMEOUTS.personas.client),
    ]);
    this.intros = agenda.intros;
    this.set({ agenda: agenda.topics, personas: cast.personas });
    this.research(agenda.topics);
    // Hold the cut-scene until the first topic has its quick evidence.
    await this.quickResearch.get(agenda.topics[0].id);

    await this.sayHandled(agenda.opening);

    let topic: Topic | undefined;
    while ((topic = this.state.agenda.find((t) => t.status === 'pending'))) {
      this.patchTopic(topic.id, { status: 'active' });
      this.set({ activeTopicId: topic.id, cycle: 1, totalCycles: BASE_CYCLES });
      await this.quickResearch.get(topic.id);
      const intro = this.intros[topic.id] ?? { id: uid('line'), speaker: 'judge', kind: 'intro', text: `Next: ${topic.title.toLowerCase()}. ${topic.question} Prosecution?`, cites: [], topic_id: topic.id };
      await this.sayHandled(intro);
      if (this.topic(topic.id)?.status !== 'active') continue; // removed by the user during the intro
      await this.debate(topic.id);
      if (this.topic(topic.id)?.status !== 'active') continue;
      await this.score(topic.id);
    }

    this.thinking('The court retires to consider its verdict…');
    const userLines = this.state.transcript.filter((l) => l.speaker === 'user');
    const v = await this.call<VerdictResponse>(
      '/api/trial/verdict',
      { question, agenda: this.state.agenda, userLines },
      () => mockVerdict({ question, agenda: this.state.agenda, userLines }),
      TIMEOUTS.verdict.client,
    );
    this.set({ verdict: v.verdict, spectrum: v.verdict.spectrum });
    await this.say(v.verdict.line);
    this.set({
      phase: 'done',
      canInterrupt: false,
      current: undefined,
      result: buildTranscript(question, this.state.transcript, this.state.cards, v.verdict),
    });
  }

  private topicLines(topicId: string) {
    return this.state.transcript.filter((l) => l.topic_id === topicId && l.kind !== 'intro');
  }

  private argueReq(topicId: string, side: Side, cycle: number, extra: Line[] = [], userPoint?: string, cutInAllowed = false): ArgueRequest {
    return {
      question: this.state.question,
      topic: this.topic(topicId)!,
      side,
      persona: this.state.personas?.[side],
      profile: this.state.profile,
      cycle,
      history: [...this.topicLines(topicId), ...extra],
      cards: this.state.cards.filter((c) => c.topic_id === topicId),
      userPoint,
      cutInAllowed,
    };
  }

  private argue(req: ArgueRequest) {
    return this.call<ArgueResponse>('/api/trial/argue', req, () => mockArgue(req), TIMEOUTS.argue.client);
  }

  /**
   * INNER LOOP: YES → NO for BASE_CYCLES cycles; each user interrupt of a side appends one more cycle.
   * The next line is generated (and voiced) while the current one plays.
   * An AI cut-in plays inside the turn: speaker (cut off) → other side cuts in → speaker resumes.
   */
  private async debate(topicId: string) {
    const turns: { side: Side; cycle: number }[] = [];
    for (let c = 1; c <= BASE_CYCLES; c++) turns.push({ side: 'yes', cycle: c }, { side: 'no', cycle: c });
    let total = BASE_CYCLES;
    let cutInUsed = false;

    let prefetch: { epoch: number; p: Promise<ArgueResponse> } | null = null;
    const exhausted = new Set<Side>();
    for (let i = 0; i < turns.length; i++) {
      if (this.topic(topicId)?.status !== 'active') return;
      const { side, cycle } = turns[i];
      this.set({ cycle, totalCycles: total });
      if (!prefetch) this.thinking(side === 'yes' ? 'The prosecution prepares…' : 'The defense prepares…', side);
      const res =
        prefetch && prefetch.epoch === this.epoch ? await prefetch.p : await this.argue(this.argueReq(topicId, side, cycle, [], undefined, !cutInUsed));
      prefetch = null;
      if (res.exhausted) exhausted.add(side);
      const cutIn = res.cutIn && !cutInUsed ? res.cutIn : undefined;
      if (cutIn) cutInUsed = true;

      const next = turns[i + 1];
      if (next && exhausted.size < 2) {
        const epoch = this.epoch;
        const said = cutIn ? [res.line, cutIn.line, cutIn.resume] : [res.line];
        const req = this.argueReq(topicId, next.side, next.cycle, said, undefined, !cutInUsed);
        prefetch = { epoch, p: this.argue(req).then(async (r) => ({ ...r, line: await this.prepare(r.line) })) };
      }

      const epoch = this.epoch;
      this.userAddedCycles = 0;
      this.scoreInBackground(topicId, res.line);
      await this.sayHandled(res.line);
      // Cut-in: only if the user didn't interrupt the line it cuts into.
      if (cutIn && this.epoch === epoch && this.topic(topicId)?.status === 'active') {
        for (const l of [cutIn.line, cutIn.resume]) {
          if (this.epoch !== epoch) break;
          this.scoreInBackground(topicId, l);
          await this.sayHandled(l);
        }
      }
      for (; this.userAddedCycles > 0; this.userAddedCycles--) {
        // The user interrupted YES/NO: one more cycle at the end of the topic. The interrupted side has
        // already answered; the other side replies as the next scheduled turn, so turns still alternate.
        total++;
        turns.push({ side: 'yes', cycle: total }, { side: 'no', cycle: total });
        exhausted.clear();
        this.set({ totalCycles: total });
      }
      // Both sides out of new points after a full cycle → the Judge closes the topic early.
      if (side === 'no' && exhausted.size === 2) return;
    }
  }

  private scoreInBackground(topicId: string, line: Line) {
    const topic = this.topic(topicId);
    if (!topic) return;
    const req = { question: this.state.question, topic, line, cards: this.state.cards.filter((c) => c.topic_id === topicId) };
    this.ledgerPending.push(
      this.call<ScoreArgumentResponse>('/api/trial/score-argument', req, () => ({ entry: mockScoreArgument(req), fallback: true }), TIMEOUTS.scoreArgument.client).then((r) =>
        this.set({ ledger: [...this.state.ledger, r.entry] }),
      ),
    );
  }

  /** Judge closes the topic, scores it, moves the spectrum. */
  private async score(topicId: string) {
    this.thinking('The court weighs the arguments…');
    await Promise.all(this.ledgerPending);
    this.ledgerPending = [];
    const topic = this.topic(topicId)!;
    const req = { question: this.state.question, topic, ledger: this.state.ledger.filter((e) => e.topic_id === topicId), history: this.topicLines(topicId) };
    const r = await this.call<ScoreTopicResponse>('/api/trial/score-topic', req, () => mockScoreTopic(req), TIMEOUTS.scoreTopic.client);
    this.patchTopic(topicId, { status: 'done', score: r.score });
    this.set({ spectrum: computeSpectrum(this.state.agenda) });
    await this.sayHandled(r.line);
  }

  // ── interrupts ────────────────────────────────────────────────────────────
  private async transcribe(input: Blob | string): Promise<string> {
    if (typeof input === 'string') return input.trim();
    const form = new FormData();
    form.append('audio', input, 'interrupt.webm');
    const r = await withFallback(
      async (signal) => {
        const res = await fetch('/api/voice/stt', { method: 'POST', body: form, signal });
        if (!res.ok) throw new Error(`stt ${res.status}`);
        return ((await res.json()) as SttResponse).transcript;
      },
      '',
      TIMEOUTS.stt.client,
      'stt',
    );
    if (r.fallback) this.set({ fallbacks: [...this.state.fallbacks, 'voice/stt'] });
    return r.value.trim();
  }

  private async handleInterrupt() {
    const target = this.state.interruptTarget!;
    const input = await this.inputPromise;
    this.inputPromise = undefined;
    this.set({ interruptTarget: undefined });
    if (input == null) return; // cancelled → carry on with the next line

    this.thinking('The court considers your objection…', 'witness');
    const text = await this.transcribe(input);
    if (!text) {
      await this.sayHandled({ id: uid('line'), speaker: 'judge', kind: 'agenda_change', text: "The court didn't catch that. Let us continue.", cites: [] });
      return;
    }
    const topicId = this.state.activeTopicId;
    const userLine: Line = { id: uid('line'), speaker: 'user', kind: 'user', text, cites: [], topic_id: target === 'judge' ? undefined : topicId };
    this.set({ transcript: [...this.state.transcript, userLine] });

    if (target === 'judge') return this.agendaChange(text);
    if (!topicId) return;

    // A side was interrupted: it must answer the user's point. debate() then adds a cycle; the other
    // side replies as the next scheduled turn, so nobody speaks twice in a row.
    const side: Side = target === 'prosecution' ? 'yes' : 'no';
    this.scoreInBackground(topicId, userLine);
    const answer = await this.argue(this.argueReq(topicId, side, this.state.cycle, [], text));
    this.scoreInBackground(topicId, answer.line);
    await this.sayHandled(answer.line);
    this.userAddedCycles++;
  }

  /** User interrupted the Judge → add or remove a topic. */
  private async agendaChange(text: string) {
    const req = { question: this.state.question, agenda: this.state.agenda, text };
    const r = await this.call<JudgeInterruptResponse>('/api/trial/judge-interrupt', req, () => mockJudgeInterrupt(req), TIMEOUTS.judgeInterrupt.client);
    if (r.action === 'add' && r.topic) {
      this.set({ agenda: addTopic(this.state.agenda, r.topic, r.topic.importance) });
      this.research([r.topic]);
    } else if (r.action === 'remove' && r.remove_id) {
      this.set({ agenda: removeTopic(this.state.agenda, r.remove_id), spectrum: computeSpectrum(removeTopic(this.state.agenda, r.remove_id)) });
    }
    await this.sayHandled(r.line);
  }
}
