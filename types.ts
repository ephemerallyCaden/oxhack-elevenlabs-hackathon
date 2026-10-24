// Shared contracts for the Court of Future Selves. Owner: D (awckiu). Design: docs/design-core-loop.md
// Change only by agreement in the group chat — every part of the app imports this file.
//
// The game: the user asks "Should I …?". The Judge sets an agenda of weighted topics; for each topic
// YES (prosecution) and NO (defense) argue up to 3 cycles; the Judge scores each topic and moves a
// spectrum from −100 (definitely no) to +100 (definitely yes); the verdict explains where it landed.

// ─── Characters & scenes ────────────────────────────────────────────────────

export type Side = 'yes' | 'no';
export type Speaker = 'prosecution' | 'defense' | 'judge' | 'user';

/** Which 2D scene is on screen. yes/no/judge = close-ups; witness = zoom-out with all three facing the user. */
export type Scene = 'yes' | 'no' | 'judge' | 'witness' | 'cutscene';

export const SIDE_SPEAKER: Record<Side, Speaker> = { yes: 'prosecution', no: 'defense' };
export const SPEAKER_SCENE: Record<Speaker, Scene> = { prosecution: 'yes', defense: 'no', judge: 'judge', user: 'witness' };

// ─── Agenda (outer loop) ────────────────────────────────────────────────────

export interface Topic {
  id: string;
  title: string;
  /** The sub-question this topic settles: "Can you afford a gap year?" */
  question: string;
  /** 0-1. All non-removed topics sum to 1. */
  importance: number;
  /** How fast facts can be found. Quick topics go first. */
  research_speed: 'quick' | 'deep';
  status: 'pending' | 'active' | 'done' | 'removed';
  /** Who put it on the agenda. */
  added_by: 'judge' | 'user';
  score?: TopicScore;
}

export interface TopicScore {
  /** −1 (clearly NO) … +1 (clearly YES) */
  t: number;
  /** 0-1 */
  confidence: number;
  reasoning: string;
  /** The single argument that decided it. */
  deciding_argument: string;
}

// ─── Research (A — Dust-OP builds the agents) ──────────────────────────────

/** One fact, shaped to drop straight into an argument. Debaters may only state facts from cards. */
export interface EvidenceCard {
  id: string;
  topic_id: string;
  side: Side;
  /** The point it supports: "A gap year spent working can pay for itself" */
  claim: string;
  /** The fact or stat itself: "UK gap-year workers earn a median £9,400 in 6 months" */
  evidence: string;
  source_name: string;
  source_url: string;
  /** 1-5 */
  strength: number;
  tier: 'quick' | 'deep';
}

/** POST /api/research (A). quick: ≤ 5s, 2-3 cards. deep: ≤ 45s, 3-6 better-sourced cards. */
export interface ResearchRequest {
  question: string;
  topic: Pick<Topic, 'id' | 'title' | 'question'>;
  side: Side;
  tier: 'quick' | 'deep';
}
export interface ResearchResponse {
  cards: EvidenceCard[];
  fallback: boolean;
}

// ─── Inner loop: lines & ledger ─────────────────────────────────────────────

export type LineKind =
  | 'opening' // Judge reads the agenda
  | 'intro' // Judge introduces a topic
  | 'argument' // YES/NO normal turn (may end mid-sentence with "—" when the other side cuts in)
  | 'cut_in' // AI interrupt: the other side cuts in ("Hold on, that's the best case!"). Doesn't change the cycle count.
  | 'resume' // the cut-off side's short comeback after a cut_in
  | 'answer' // YES/NO answering the user's interrupt
  | 'user' // the user's interrupt (transcribed)
  | 'agenda_change' // Judge confirms a topic added/removed
  | 'score' // Judge scores a topic
  | 'verdict';

/** One line of dialogue. The UI shows `text`, voices `tts ?? text`, and picks the scene from `speaker`. */
export interface Line {
  id: string;
  speaker: Speaker;
  kind: LineKind;
  text: string;
  /** TTS input: may contain ElevenLabs audio tags and numbers spelled out. */
  tts?: string;
  /** EvidenceCard ids this line relies on (→ transcript footnotes). */
  cites: string[];
  topic_id?: string;
  /** Inner-loop cycle for arguments (1-based; 2 per topic + 1 per user interrupt). */
  cycle?: number;
  audioUrl?: string;
  durationMs?: number;
}

/** Background pros/cons tally — the Judge scores topics from this. */
export interface LedgerEntry {
  id: string;
  line_id: string;
  topic_id: string;
  /** Who said it. */
  by: Speaker;
  /** Which way it pushes. A user point can support either side. */
  supports: Side | 'neutral';
  claim: string;
  /** 1-5 */
  strength: number;
  card_ids: string[];
}

// ─── Spectrum & verdict ─────────────────────────────────────────────────────

export type SpectrumLabel = 'Strong no' | 'Lean no' | 'Toss-up' | 'Lean yes' | 'Strong yes';

export interface Spectrum {
  /** −100 … +100, importance-weighted average of scored topics. Computed in code, never by Claude. */
  value: number;
  label: SpectrumLabel;
}

export interface Verdict {
  spectrum: Spectrum;
  /** 2-4 sentences. */
  explanation: string;
  breakdown: { topic_id: string; title: string; weight: number; t: number; deciding_argument: string; added_by: Topic['added_by'] }[];
  line: Line;
}

export interface Transcript {
  question: string;
  lines: Line[];
  /** Cited cards in first-cited order; footnote n = index + 1. */
  sources: EvidenceCard[];
  verdict?: Verdict;
}

// ─── API shapes (all POST, JSON). Every response carries `fallback: true` when it used mock data. ──

/** POST /api/trial/agenda */
export interface AgendaRequest {
  question: string;
}
export interface AgendaResponse {
  /** 1-4 topics, quick-to-research first, importance normalised. */
  topics: Topic[];
  /** Judge's opening: names the question and the agenda. */
  opening: Line;
  /** One intro line per topic id. */
  intros: Record<string, Line>;
  fallback: boolean;
}

/** POST /api/trial/argue */
export interface ArgueRequest {
  question: string;
  topic: Topic;
  side: Side;
  cycle: number;
  /** All lines so far on this topic, oldest first. */
  history: Line[];
  /** Cards for this topic (both sides; the speaker should use its own). */
  cards: EvidenceCard[];
  /** Set when answering the user's interrupt: the speaker must address it first. */
  userPoint?: string;
  /** The other side may cut into this line (at most one cut-in per topic). */
  cutInAllowed?: boolean;
}
export interface ArgueResponse {
  line: Line;
  /** The side has nothing new to add on this topic (lets the Judge close early). */
  exhausted: boolean;
  /** The other side cut in: play `line` (cut off), then `cutIn.line`, then `cutIn.resume`. */
  cutIn?: { line: Line; resume: Line };
  fallback: boolean;
}

/** POST /api/trial/score-argument (background) */
export interface ScoreArgumentRequest {
  question: string;
  topic: Topic;
  line: Line;
  cards: EvidenceCard[];
}
export interface ScoreArgumentResponse {
  entry: LedgerEntry;
  fallback: boolean;
}

/** POST /api/trial/score-topic */
export interface ScoreTopicRequest {
  question: string;
  topic: Topic;
  ledger: LedgerEntry[];
  history: Line[];
}
export interface ScoreTopicResponse {
  score: TopicScore;
  line: Line;
  fallback: boolean;
}

/** POST /api/trial/judge-interrupt — the user interrupted the Judge = agenda change. */
export interface JudgeInterruptRequest {
  question: string;
  agenda: Topic[];
  text: string;
}
export interface JudgeInterruptResponse {
  action: 'add' | 'remove' | 'none';
  /** For add: the new topic (importance = its share AFTER re-normalising). */
  topic?: Topic;
  /** For remove. */
  remove_id?: string;
  line: Line;
  fallback: boolean;
}

/** POST /api/trial/verdict */
export interface VerdictRequest {
  question: string;
  agenda: Topic[];
  /** User interrupts, so the Judge can say how they were weighed. */
  userLines: Line[];
}
export interface VerdictResponse {
  verdict: Verdict;
  fallback: boolean;
}

/** POST /api/voice/tts (B) */
export interface TtsRequest {
  text: string;
  speaker: Exclude<Speaker, 'user'>;
  voiceId?: string;
}
export interface TtsResponse {
  audioUrl: string;
  durationMs: number;
  fallback: boolean;
}

/** POST /api/voice/stt (B) — multipart/form-data with an `audio` file field. */
export interface SttResponse {
  transcript: string;
  fallback: boolean;
}
