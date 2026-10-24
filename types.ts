// Shared contracts for Roulette. Owner: D (awckiu). Everyone builds against this file.
// Change it only by agreement in the group chat — every part of the app imports it.
//
// Conventions
// - Option A = the CHANGE ("become a poker player"), option B = the STATUS QUO ("stay in quant").
//   Prosecution argues FOR A, Defense argues FOR B (against the change).
// - Money is in whole units of `SimResult.currency` (GBP for the demo).
// - Probabilities are 0-1 floats. Format as % only at display time.

// ─── Courtroom events ───────────────────────────────────────────────────────

export type Role = 'prosecution' | 'defense' | 'judge' | 'user';

export type DebateEventType =
  | 'speech'
  | 'interrupt'
  | 'effect'
  | 'music_change'
  | 'expression_change'
  | 'verdict';

export type InterruptType = 'user_challenge' | 'elaborate' | 'skip' | 'ai_interject';

export type Effect = 'flash_white' | 'flash_red' | 'flash_blue' | 'shake' | 'gavel';

export type Expression = 'idle' | 'talking' | 'sweating' | 'shocked' | 'confident' | 'breakdown';

/** Maps to the BGM entries in lib/audio/assets.ts (C3). 'none' = stop music. */
export type MusicTrack = 'calm' | 'tension' | 'pursuit' | 'verdict' | 'none';

/**
 * The universal event — ALL courtroom state flows through a queue of these
 * (live debate, cached demo fallback and replay use the same player, C4).
 * Shape from DESIGN.md "Event-Driven Architecture" plus the fields marked NEW.
 */
export interface DebateEvent {
  id: string;
  /** ms since debate start. Scripts may leave 0; the player stamps real times. */
  timestamp: number;
  type: DebateEventType;
  speaker?: Role;
  /** What the text box shows. No audio tags, numbers as digits ("61%"). */
  text?: string;
  /** NEW. What TTS reads: audio tags + spoken numbers ("[concerned] sixty-one percent"). B5 uses `tts ?? text`. */
  tts?: string;
  /** Filled by B5 (batch TTS) or the D6 cache. */
  audioUrl?: string;
  /** NEW. Audio length in ms (from B5). Before audio exists, C4 estimates from text length. */
  durationMs?: number;
  /** NEW. 1-3. Undefined for pre-debate/verdict housekeeping events. */
  round?: number;
  interrupt_type?: InterruptType;
  /** "OBJECTION!", "STOP RIGHT THERE!", "HOLD IT!", "MOVE ON!" … */
  interrupt_flavor?: string;
  effect?: Effect;
  /** For expression_change: whose face changes is `speaker`. */
  expression?: Expression;
  /** NEW. For music_change. */
  music?: MusicTrack;
  /** NEW. For verdict events. */
  verdict?: Verdict;
  /** NEW. KeyFinding ids this line cites (lets C7 highlight sources). */
  cites?: string[];
}

export interface Verdict {
  /** Which option the court rules for. */
  winner: 'change' | 'status_quo';
  winner_label: string;
  /** 0-1, taken from the simulation (SimResult.p_change_ahead), never invented by Claude. */
  confidence: number;
  /** 2-3 sentences, display form. */
  reasoning: string;
  /** "If your win rate were above 6.5bb/100, this court would rule for poker." */
  flip_line: string;
}

// ─── Decision parsing (D2) ──────────────────────────────────────────────────

export interface BetaParams {
  alpha: number;
  beta: number;
}

export interface ParsedDecision {
  /** e.g. 'career_gambling', 'location', 'career', 'education', 'business', 'financial', 'relationship', 'health' */
  type: string;
  /** [A = change, B = status quo] */
  options: [string, string];
  factors: string[];
  time_horizon_years: number;
  /** Happiness Beta(α, β) per option, judged by Claude from context (review #16) — not hardcoded. */
  happiness_params: { change: BetaParams; status_quo: BetaParams };
  /** One-line restatement for the Judge's opening ("quit a London quant job to play poker"). */
  summary: string;
  /** Numbers the user actually said, if any. The sim fills gaps with data/defaults. */
  stated?: {
    current_salary?: number;
    starting_savings?: number;
    age?: number;
    city?: string;
  };
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
}

// ─── Data ingestion (A3) ────────────────────────────────────────────────────

export interface DataPoint {
  /** e.g. 'quant_salary_london_median' */
  key: string;
  value: number;
  /** e.g. 'GBP/year', '%', 'bb/100' */
  unit: string;
  source_name: string;
  source_url: string;
  year: number;
  confidence: 'high' | 'medium' | 'low';
  retrieved_via: 'gemini' | 'manual';
  verified: boolean;
}

// ─── Simulation (A1/A2/A4/A5/A6) ────────────────────────────────────────────

export interface SimInput {
  /** [A = change, B = status quo] */
  options: [string, string];
  time_horizon_years: number;
  starting_savings: number;
  current_salary: number;
  poker_win_rate_bb100: number;
  hours_per_week: number;
  risk_tolerance: 'conservative' | 'moderate' | 'aggressive';
  happiness_params: { change: BetaParams; status_quo: BetaParams };
  /** default 5000 */
  iterations?: number;
}

/** Per-year percentile band. Arrays have length time_horizon_years (index 0 = end of year 1). */
export interface Band {
  p10: number[];
  median: number[];
  p90: number[];
}

export interface TimelineStats {
  option: string;
  net_worth: Band;
  annual_income: Band;
  /** P(savings < 0 at any point) */
  p_bust: number;
  /** P(net worth ≥ 1,000,000 at horizon) */
  p_millionaire: number;
  /** Median month savings hit zero, among busted runs. null if nobody busts. */
  median_months_until_broke: number | null;
  /** 0-1 */
  happiness_median: number;
}

export interface ChartData {
  /** Final net-worth distribution, ~30 bins per timeline (C5 loading animation). */
  histogram: { change: HistogramBin[]; status_quo: HistogramBin[] };
  /** Per-year p10/p25/p50/p75/p90, years 0..horizon (C7 fan chart). */
  fan: { change: FanPoint[]; status_quo: FanPoint[] };
  /** ~50 individual net-worth paths per timeline, years 0..horizon. */
  samplePaths: { change: number[][]; status_quo: number[][] };
}

export interface HistogramBin {
  x0: number;
  x1: number;
  count: number;
}

export interface FanPoint {
  year: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface SimResult {
  input: SimInput;
  currency: 'GBP' | 'USD' | 'AUD' | 'EUR';
  iterations: number;
  runtime_ms: number;
  timelines: { change: TimelineStats; status_quo: TimelineStats };
  /** Share of paired futures where the CHANGE ends with higher net worth. Verdict confidence comes from this. */
  p_change_ahead: number;
  charts?: ChartData;
}

export interface KeyFinding {
  id: string;
  /** Display form: "61% chance poker-you goes broke" */
  statement: string;
  /** TTS form: "sixty-one percent chance you go broke" */
  spoken: string;
  value: number;
  unit: string;
  side: 'for_change' | 'against_change' | 'neutral';
  source_name: string;
  source_url: string;
  confidence: 'high' | 'medium' | 'low';
  /** 1-5, how punchy it is on stage */
  drama: 1 | 2 | 3 | 4 | 5;
}

export interface Sensitivity {
  tornado: { input: string; low_outcome: number; high_outcome: number }[];
  flip_point: { input: string; value: number; statement: string; spoken: string };
}

// ─── API shapes (all POST, JSON unless noted) ───────────────────────────────
// Every route returns mock/cached data when its key is missing or the call takes > 5s,
// and says so with `fallback: true`.

/** POST /api/ingest (A3) */
export interface IngestRequest {
  decision: ParsedDecision;
}
export interface IngestResponse {
  dataPoints: DataPoint[];
  fallback: boolean;
}

/** POST /api/simulate (A2/A4/A5/A6) */
export interface SimulateRequest {
  input: SimInput;
  dataPoints?: DataPoint[];
}
export interface SimulateResponse {
  result: SimResult;
  findings: KeyFinding[];
  sensitivity?: Sensitivity;
  fallback: boolean;
}

/** POST /api/debate/parse (D2) */
export interface ParseRequest {
  transcript: string;
}
export interface ParseResponse {
  decision: ParsedDecision;
  fallback: boolean;
}

/** POST /api/debate/script (D3) */
export interface ScriptRequest {
  decision: ParsedDecision;
  result: SimResult;
  findings: KeyFinding[];
  sensitivity?: Sensitivity;
}
export interface ScriptResponse {
  /** Full 3-round debate including the verdict, text only (no audioUrl yet — B5 adds audio). */
  events: DebateEvent[];
  /** HOLD IT lines, pre-generated: key = `${speaker}-${round}` e.g. 'prosecution-2'. */
  elaborations: Record<string, DebateEvent[]>;
  fallback: boolean;
}

/** POST /api/debate/interrupt (D5) */
export interface InterruptRequest {
  /** What the user said (from /api/voice/stt). */
  transcript: string;
  context: {
    decision: ParsedDecision;
    /** Last ~3 speech events, oldest first. */
    recentLines: DebateEvent[];
    findings: KeyFinding[];
    round: number;
  };
}
export interface InterruptResponse {
  relevant: boolean;
  responder: Exclude<Role, 'user'>;
  /** Ready-to-play events (speech has audioUrl when TTS succeeded). */
  events: DebateEvent[];
  fallback: boolean;
}

/** POST /api/debate/verdict (D9) — re-rules after the user's interrupt; the script already has a default verdict. */
export interface VerdictRequest {
  decision: ParsedDecision;
  result: SimResult;
  findings: KeyFinding[];
  sensitivity?: Sensitivity;
  /** The user's challenges that landed (relevant: true). */
  userChallenges: string[];
}
export interface VerdictResponse {
  events: DebateEvent[];
  fallback: boolean;
}

/** POST /api/voice/tts (B2) */
export interface TtsRequest {
  /** Text with audio tags (use DebateEvent.tts ?? text). */
  text: string;
  role: Exclude<Role, 'user'>;
  voiceId?: string;
}
export interface TtsResponse {
  audioUrl: string;
  durationMs: number;
  fallback: boolean;
}

/** POST /api/voice/debate (B5) — voice a whole script in parallel during the loading screen. */
export interface VoiceDebateRequest {
  events: DebateEvent[];
  elaborations: Record<string, DebateEvent[]>;
  voiceId?: string;
}
/** Same events back with audioUrl + durationMs filled on every speech/interrupt event that has text. */
export interface VoiceDebateResponse {
  events: DebateEvent[];
  elaborations: Record<string, DebateEvent[]>;
  fallback: boolean;
}

/** POST /api/voice/stt (B2) — body is multipart/form-data with an `audio` file field. */
export interface SttResponse {
  transcript: string;
  fallback: boolean;
}

// ─── Orchestrator ↔ player (D4 ↔ C4) ────────────────────────────────────────

export type DebatePhase =
  | 'input'
  | 'parsing'
  | 'simulating'
  | 'scripting'
  | 'voicing'
  | 'debate'
  | 'interrupt_window'
  | 'user_speaking'
  | 'responding'
  | 'verdict'
  | 'done';

/**
 * What C4's useDebatePlayer exposes so the orchestrator (D4) can drive it.
 * The orchestrator owns the event list; it only ever calls load() with "what to play next".
 */
export interface DebatePlayerControls {
  /** Stop whatever is playing (abort audio), replace the queue and start playing from the first event. */
  load(events: DebateEvent[]): void;
  pause(): void;
  play(): void;
}

/**
 * Callbacks C4's player must fire so the orchestrator knows where playback is.
 * Wire them as: useDebatePlayer({ onEventStart: orch.onEventStart, onQueueEnd: orch.onQueueEnd })
 */
export interface DebatePlayerCallbacks {
  /** Fired when an event begins playing. */
  onEventStart(event: DebateEvent): void;
  /** Fired when the last event in the loaded queue has finished. */
  onQueueEnd(): void;
}
