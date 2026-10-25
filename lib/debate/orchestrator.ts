// The trial state machine (browser side). Design: docs/design-core-loop.md
//
//   ask → preparing (cut-scene: setup call + quick research) → opening
//     → OUTER LOOP per topic: intro → INNER LOOP (2 cycles of YES → NO, +1 per user interrupt) → Judge's ruling → spectrum
//     → verdict → done (transcript)
//
// Gemini's free tier allows 5 calls a minute, so lines are written in batches: one setup call, one call
// per topic (pre-written while the previous topic plays), one per user interrupt, one verdict.
//
// The UI renders `state.scene` + `state.current`, plays the line (audioUrl, or durationMs as a timer)
// and calls `lineEnded(id)` when it finishes. Interrupts: `beginInterrupt()` on hold, `endInterrupt(audio|text)` on release.
import type {
  EvidenceCard,
  JudgeInterruptResponse,
  LedgerEntry,
  Line,
  Personas,
  ProfileRequest,
  ProfileResponse,
  ResearchResponse,
  Scene,
  SetupResponse,
  Side,
  Speaker,
  Spectrum,
  SttResponse,
  Topic,
  TopicRequest,
  TopicResponse,
  TopicTurn,
  Transcript,
  TtsResponse,
  UserProfile,
  Verdict,
  VerdictResponse,
} from '@/types';
import { SPEAKER_SCENE } from '@/types';
import { estimateMs, postJson, uid, withFallback } from './fallback';
import { setupText } from './punch';
import { punchVoiceSettings } from '@/lib/voice/configs';
import type { VoiceSettings } from '@elevenlabs/elevenlabs-js/api';
import { mockCards, mockJudgeInterrupt, mockProfile, mockSetup, mockTopic, mockVerdict } from './mock';
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

/**
 * Turns after the user interrupts `side` on a line in cycle `cycle`, when the topic now runs `total`
 * cycles: the interrupted side answers first, then YES and NO strictly alternate until NO closes cycle
 * `total`. Nobody ever speaks twice in a row, whichever line was interrupted (argument, cut-in, resume, answer).
 */
export function planAfterInterrupt(side: Side, cycle: number, total: number): TopicTurn[] {
  const turns: TopicTurn[] = [{ side, cycle, answer: true }];
  let s: Side = side === 'yes' ? 'no' : 'yes';
  let c = cycle;
  for (;;) {
    if (s === 'yes') c++;
    if (c > total) break;
    turns.push({ side: s, cycle: c });
    if (s === 'no' && c === total) break;
    s = s === 'yes' ? 'no' : 'yes';
  }
  return turns;
}

export class TrialOrchestrator {
  private state: TrialState = this.initial();
  private listeners = new Set<() => void>();

  private intros: Record<string, Line> = {};
  private quickResearch = new Map<string, Promise<void>>();
  /** Topics written ahead of time (while the previous topic plays). */
  private prewritten = new Map<string, Promise<TopicResponse>>();
  /** Voice for the next line, fetched while the current one plays. */
  private voiced = new Map<string, Promise<Line>>();
  /** Ledger entries for lines not yet said; recorded as each line plays. */
  private pendingLedger = new Map<string, LedgerEntry>();
  /** Resolves the line currently being said. */
  private sayResolve?: (r: SayResult) => void;
  private inputResolve?: (input: Blob | string | null) => void;
  private inputPromise?: Promise<Blob | string | null>;
  /** Set when the user interrupts YES/NO: debate() rewrites the rest of the topic around it. */
  private userPoint?: { text: string; side: Side };

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
    const speaker = line.speaker;
    const voice = async (text: string, settings?: VoiceSettings) => {
      const r = await withFallback<TtsResponse | null>(
        (signal) => postJson<TtsResponse>('/api/voice/tts', { text, speaker, voiceId: this.opts.voiceId, voiceSettings: settings }, signal),
        null,
        TIMEOUTS.tts.client,
        'tts',
      );
      return r.value && !r.value.fallback ? { audioUrl: r.value.audioUrl, durationMs: r.value.durationMs } : null;
    };
    if (!line.punch || speaker === 'judge') {
      const v = await voice(line.tts || line.text);
      return v ? { ...line, ...v } : { ...line, durationMs: estimateMs(line.text) };
    }
    // Surprise punch: setup and punch are separate clips, voiced in parallel; the punch hotter.
    const setup = setupText(line);
    const [a, b] = await Promise.all([
      voice(line.tts || setup),
      voice(line.punch.tts || line.punch.text, punchVoiceSettings(speaker)),
    ]);
    return {
      ...line,
      ...(a ?? { durationMs: estimateMs(setup) }),
      punch: { ...line.punch, ...(b ?? { durationMs: estimateMs(line.punch.text) }) },
    };
  }


  private async say(line: Line): Promise<SayResult> {
    const ready = await (this.voiced.get(line.id) ?? this.prepare(line));
    this.voiced.delete(line.id);
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
    this.recordLedger();
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
    // One call for the whole cut-scene: agenda, Judge lines and both future selves.
    const setup = await this.call<SetupResponse>('/api/trial/setup', { question, profile }, () => mockSetup({ question, profile }), TIMEOUTS.setup.client);
    this.intros = setup.intros;
    this.set({ agenda: setup.topics, personas: setup.personas });
    this.research(setup.topics);
    // Write the first topic while the Judge's opening plays.
    this.prewrite(setup.topics[0].id);
    await this.sayHandled(setup.opening);

    let topic: Topic | undefined;
    while ((topic = this.state.agenda.find((t) => t.status === 'pending'))) {
      this.patchTopic(topic.id, { status: 'active' });
      this.set({ activeTopicId: topic.id, cycle: 1, totalCycles: BASE_CYCLES });
      // Usually written already. If not (the agenda just changed), write it now with priority, hidden behind the intro.
      this.prewrite(topic.id, true);
      await this.sayHandled(this.introFor(topic));
      if (this.topic(topic.id)?.status !== 'active') continue; // removed by the user during the intro
      // Pre-write the next topic while this one plays (~1 min), so its call fits the rate limit.
      this.prewriteNext();
      const res = await this.debate(topic.id);
      if (!res || this.topic(topic.id)?.status !== 'active') continue;
      this.patchTopic(topic.id, { status: 'done', score: res.score });
      this.set({ spectrum: computeSpectrum(this.state.agenda) });
      const next = this.state.agenda.find((t) => t.status === 'pending');
      if (next) this.prefetchVoice(this.introFor(next)); // voiced while the ruling plays
      await this.sayHandled(res.ruling);
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

  /** One call: the given turns for a topic (+ its ledger and the Judge's ruling). */
  private writeTopic(topicId: string, turns: TopicTurn[], opts: { urgent: boolean; userPoint?: string; cutInAllowed: boolean }) {
    const req: TopicRequest = {
      question: this.state.question,
      topic: this.topic(topicId)!,
      personas: this.state.personas,
      profile: this.state.profile,
      cards: this.state.cards.filter((c) => c.topic_id === topicId),
      history: this.topicLines(topicId),
      turns,
      userPoint: opts.userPoint,
      cutInAllowed: opts.cutInAllowed,
      urgent: opts.urgent,
    };
    return this.call<TopicResponse>('/api/trial/topic', req, () => mockTopic(req), opts.urgent ? TIMEOUTS.topicUrgent.client : TIMEOUTS.topic.client);
  }

  private basePlan(): TopicTurn[] {
    const turns: TopicTurn[] = [];
    for (let c = 1; c <= BASE_CYCLES; c++) turns.push({ side: 'yes', cycle: c }, { side: 'no', cycle: c });
    return turns;
  }

  /**
   * Start writing a topic (once), after its quick research has landed. Background priority when it's
   * written ahead; `urgent` when the user is about to reach it (it then takes the reserved slot).
   */
  private prewrite(topicId: string, urgent = false) {
    if (this.prewritten.has(topicId)) return;
    const research = this.quickResearch.get(topicId) ?? Promise.resolve();
    this.prewritten.set(topicId, research.then(() => this.writeTopic(topicId, this.basePlan(), { urgent, cutInAllowed: true })));
  }

  /** Pre-write the next pending topic, if there is one. */
  private prewriteNext() {
    const next = this.state.agenda.find((t) => t.status === 'pending');
    if (next) this.prewrite(next.id);
  }

  /** The Judge's intro for a topic (the agenda's, or a stock one for topics the user added). Same line each time. */
  private introFor(topic: Topic): Line {
    this.intros[topic.id] ??= { id: uid('line'), speaker: 'judge', kind: 'intro', text: `Next: ${topic.title.toLowerCase()}. ${topic.question} Prosecution?`, cites: [], topic_id: topic.id };
    return this.intros[topic.id];
  }

  /** Fetch a line's voice now, so it's ready when the line comes up. */
  private prefetchVoice(line: Line) {
    if (!this.voiced.has(line.id)) this.voiced.set(line.id, this.prepare(line));
  }

  /** Ledger entries for lines that have now been said (or the user's points) go into state. */
  private recordLedger() {
    const said = new Set(this.state.transcript.map((l) => l.id));
    const recorded = new Set(this.state.ledger.map((e) => e.line_id));
    const now = [...this.pendingLedger.values()].filter((e) => said.has(e.line_id));
    if (!now.length) return;
    for (const e of now) this.pendingLedger.delete(e.line_id);
    const fresh = now.filter((e) => !recorded.has(e.line_id)); // each point counts once, however many rewrites
    if (fresh.length) this.set({ ledger: [...this.state.ledger, ...fresh] });
  }

  private queueLedger(res: TopicResponse) {
    for (const e of res.ledger) this.pendingLedger.set(e.line_id, e);
    this.recordLedger();
  }

  /** Lines that will never play (rewritten or topic removed): forget their voice and ledger entries. */
  private discard(lines: Line[]) {
    for (const l of lines) {
      this.voiced.delete(l.id);
      this.pendingLedger.delete(l.id);
    }
  }

  /**
   * INNER LOOP: plays the topic's pre-written exchange. A user interrupt of YES/NO adds a cycle and
   * rewrites the rest of the topic in one call: the interrupted side answers first, then the remaining
   * turns, so nobody speaks twice in a row. AI cut-ins arrive as cut-off line → cut_in → resume.
   * Returns the latest score + ruling, or null if the topic was removed.
   */
  private async debate(topicId: string): Promise<TopicResponse | null> {
    let total = BASE_CYCLES;
    let cutUsed = false;

    let res = await this.waitFor(
      this.prewritten.get(topicId) ?? this.writeTopic(topicId, this.basePlan(), { urgent: true, cutInAllowed: true }),
      'The court prepares the exchange…',
    );
    this.prewritten.delete(topicId);
    this.queueLedger(res);
    let queue = res.lines;

    for (let i = 0; i < queue.length; i++) {
      if (this.topic(topicId)?.status !== 'active') {
        this.discard(queue.slice(i));
        return null;
      }
      const line = queue[i];
      this.set({ cycle: line.cycle ?? this.state.cycle, totalCycles: total });
      if (line.kind === 'cut_in') cutUsed = true;
      // Voice the next line (or, at the end, the Judge's ruling) while this one plays.
      this.prefetchVoice(queue[i + 1] ?? res.ruling);

      await this.sayHandled(line);
      if (!this.userPoint) continue;

      // The user interrupted this line's speaker: +1 cycle, rewrite the rest of the topic around their point.
      const { text, side } = this.userPoint;
      this.userPoint = undefined;
      total++;
      this.set({ totalCycles: total });
      this.discard([...queue.slice(i + 1), res.ruling]);
      res = await this.waitFor(
        this.writeTopic(topicId, planAfterInterrupt(side, line.cycle ?? 1, total), { urgent: true, userPoint: text, cutInAllowed: !cutUsed }),
        'The court considers your objection…',
        'witness',
      );
      this.queueLedger(res);
      queue = res.lines;
      i = -1;
    }
    return res;
  }

  /** Await a call; show a status only if it isn't already done (pre-written topics usually are). */
  private async waitFor<T>(p: Promise<T>, status: string, scene: Scene = 'judge'): Promise<T> {
    const quick = await Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 30))]);
    if (quick !== null) return quick as T;
    this.thinking(status, scene);
    return p;
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

    // A side was interrupted: debate() rewrites the rest of the topic so that side answers first (+1 cycle).
    this.userPoint = { text, side: target === 'prosecution' ? 'yes' : 'no' };
  }

  /** User interrupted the Judge → add or remove a topic. */
  private async agendaChange(text: string) {
    const req = { question: this.state.question, agenda: this.state.agenda, text };
    const r = await this.call<JudgeInterruptResponse>('/api/trial/judge-interrupt', req, () => mockJudgeInterrupt(req), TIMEOUTS.judgeInterrupt.client);
    if (r.action === 'add' && r.topic) {
      this.set({ agenda: addTopic(this.state.agenda, r.topic, r.topic.importance) });
      this.research([r.topic]);
    } else if (r.action === 'remove' && r.remove_id) {
      const agenda = removeTopic(this.state.agenda, r.remove_id);
      this.set({ agenda, spectrum: computeSpectrum(agenda) });
      this.prewritten.delete(r.remove_id); // an in-flight call still finishes, but its result is dropped
    }
    // Whatever comes next is written now, while the Judge confirms, so the agenda change costs no waiting.
    this.prewriteNext();
    await this.sayHandled(r.line);
  }
}

/**
 * Onboarding → profile (+ the decision they described as a "Should I …?" question).
 * Use after VoiceStep: `const { profile, question } = await getProfile({ transcript, form })`,
 * then `new TrialOrchestrator({ voiceId, profile })` and `orch.start(question ?? typedQuestion)`.
 */
export async function getProfile(req: ProfileRequest): Promise<ProfileResponse> {
  const r = await withFallback((signal) => postJson<ProfileResponse>('/api/trial/profile', req, signal), () => mockProfile(req), TIMEOUTS.profile.client, 'profile');
  return r.value;
}
