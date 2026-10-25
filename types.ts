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

// ─── The user & their two futures ───────────────────────────────────────────

/** From the onboarding form (C), gaps filled from the voice transcript (B8 → D10). All optional. */
export interface UserProfile {
  name?: string;
  age?: number;
  /** "first-year CS student", "nurse with two kids" */
  situation?: string;
  location?: string;
  /** Who their decisions affect: "partner, two kids, mum nearby" */
  people?: string;
  risk_tolerance?: 'cautious' | 'balanced' | 'bold';
  /** "comfortable", "stretched, paying off a loan" (no exact figures needed) */
  money?: string;
  /** What they want, in their words. */
  goals?: string;
  fears?: string;
  /** What matters most to them: "freedom", "family", "security"… */
  values?: string[];
  /** Anything else they said that matters. */
  notes?: string;
}

/** POST /api/trial/profile — onboarding answers (B8) + form (C) → profile. */
export interface ProfileRequest {
  /** The whole onboarding recording, transcribed (what VoiceStep returns today). */
  transcript?: string;
  /** Per-question answers, if onboarding records them separately. */
  answers?: { question: string; transcript: string }[];
  /** Fields typed into the onboarding form. These win over anything extracted. */
  form?: UserProfile;
}
export interface ProfileResponse {
  profile: UserProfile;
  /** The decision they described, as a yes/no question ("Should I …?"), if they described one. */
  question?: string;
  fallback: boolean;
}

/**
 * One future version of the user who said YES to the question, at the moment that future is most
 * likely to look its best (YES side) or its worst (NO side). Chosen per question in the cut-scene.
 */
export interface Persona {
  side: Side;
  /** Their age at that moment, if the user's age is known. */
  age?: number;
  /** How far from now, for the UI: "1 year from now". */
  when: string;
  years_from_now: number;
  /** 2-3 sentences: where they are and what their life looks like. */
  snapshot: string;
  /** One or two words: "thriving", "exhausted". */
  mood: string;
}

export interface Personas {
  yes: Persona;
  no: Persona;
}

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

// Gemini's free tier allows 5 calls a minute, so the trial is written in a few big calls instead of
// one per line: setup (1), each topic (1, written while the previous topic plays), verdict (1),
// plus 1 per interrupt. lib/debate/ratelimit.ts spaces them out.

/** POST /api/trial/setup — the cut-scene: agenda + Judge lines + both future selves in one call. */
export interface SetupRequest {
  question: string;
  profile?: UserProfile;
}
export interface SetupResponse {
  /** 1-4 topics, quick-to-research first, importance normalised. */
  topics: Topic[];
  /** Judge's opening: names the question and the agenda. */
  opening: Line;
  /** One intro line per topic id. */
  intros: Record<string, Line>;
  personas: Personas;
  fallback: boolean;
}

/** One planned turn in a topic: who speaks, in which cycle. `answer` = replying to the user's interrupt. */
export interface TopicTurn {
  side: Side;
  cycle: number;
  answer?: boolean;
}

/**
 * POST /api/trial/topic — write the YES ↔ NO exchange for one topic, plus the Judge's score and ruling.
 * Called once per topic (pre-written while the previous topic plays) and once more after each user
 * interrupt, to rewrite the rest of the topic around the user's point.
 */
export interface TopicRequest {
  question: string;
  topic: Topic;
  personas?: Personas;
  profile?: UserProfile;
  cards: EvidenceCard[];
  /** Lines already said on this topic (incl. the user's interrupt), oldest first. */
  history: Line[];
  /** The turns to write, in order. The code decides the structure; the model writes the words. */
  turns: TopicTurn[];
  /** What the user just said, if `turns[0].answer`. */
  userPoint?: string;
  /** The other side may cut in once (only if no cut-in has played on this topic yet). */
  cutInAllowed: boolean;
  /** true = the user is waiting (after an interrupt); false = pre-writing in the background. */
  urgent: boolean;
}
export interface TopicResponse {
  /** In play order: one line per turn, with any cut-in's `cut_in` + `resume` lines right after its turn. */
  lines: Line[];
  /** Pros/cons tally for `lines`. */
  ledger: LedgerEntry[];
  /** The Judge's verdict on the topic, given everything said (history + lines). */
  score: TopicScore;
  /** The Judge's spoken ruling on the topic. */
  ruling: Line;
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
