// Server-side trial calls. Claude when ANTHROPIC_API_KEY is set, else Gemini (rate-limited for the free
// tier, see ratelimit.ts), else the mocks in lib/debate/mock.ts. Every call falls back to its mock.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  JudgeInterruptRequest,
  JudgeInterruptResponse,
  LedgerEntry,
  Line,
  Persona,
  ProfileRequest,
  ProfileResponse,
  SetupRequest,
  SetupResponse,
  Topic,
  TopicRequest,
  TopicResponse,
  UserProfile,
  VerdictRequest,
  VerdictResponse,
} from '@/types';
import { SIDE_SPEAKER } from '@/types';
import { claude, hasClaudeKey, MODEL } from './claude';
import { askGemini, hasGeminiKey } from './gemini';
import { hasGroqKey } from './groq';
import { uid, withFallback } from './fallback';
import type { Priority } from './ratelimit';
import { TIMEOUTS } from './timeouts';
import { mergeProfile, mockJudgeInterrupt, mockProfile, mockSetup, mockTopic, mockVerdict, onboardingText } from './mock';
import * as P from './prompts';
import { computeSpectrum, MAX_TOPICS, normalise, orderAgenda } from './spectrum';
import { attachPunch, punchedSides } from './punch';

/**
 * Which model writes the debate. DEBATE_LLM in .env.local: `mock` (testing, no API calls),
 * `gemini`, `claude`, or `auto` (default: Claude if its key is set, else Gemini, else mock).
 */
function debateLlm(): 'claude' | 'gemini' | 'mock' {
  const want = process.env.DEBATE_LLM ?? 'auto';
  if (want === 'mock') return 'mock';
  if ((want === 'claude' || want === 'auto') && hasClaudeKey()) return 'claude';
  // 'gemini' = the free-tier model pool: Groq and/or Gemini, whichever keys are set (DEBATE_LLM=groq works too).
  if ((want === 'gemini' || want === 'groq' || want === 'auto') && (hasGroqKey() || hasGeminiKey())) return 'gemini';
  return 'mock';
}

/**
 * One structured Claude/Gemini call → parsed object, or `fallback()` if no key / error / timeout.
 * Gemini calls go through the model pool (gemini.ts + ratelimit.ts): they wait for a free slot and fail
 * over to the next model within the same time budget (`ms`).
 */
async function ask<S extends z.ZodType, R>(
  task: string,
  content: string,
  schema: S,
  ms: number,
  label: string,
  build: (out: z.infer<S>) => R,
  fallback: () => R,
  priority: Priority = 'interactive',
  /** The caller's request signal: a client that gave up (e.g. a stopped trial) frees the model slot too. */
  signal?: AbortSignal,
  /** Fixes a free model's known near-misses in the raw JSON before validation (Claude's output is enforced). */
  repair?: (raw: unknown) => unknown,
): Promise<{ value: R; fallback: boolean }> {
  const llm = debateLlm();
  if (llm === 'mock') return { value: fallback(), fallback: true };
  // The profile clerk only extracts facts from the onboarding transcript: it writes no courtroom lines.
  const system = task === P.PROFILE_TASK ? task : `${P.COURT}\n\n${task}`;
  if (llm === 'gemini') {
    const deadline = Date.now() + ms;
    // `build` doubles as the check: an answer it can't use (e.g. an empty line) is retried, not mocked.
    const check = (out: z.infer<S>) => void build(out);
    return withFallback(async (s) => build(await askGemini(system, content, schema, s, priority, deadline, { repair, check })), fallback, ms, label, signal);
  }
  return withFallback(
    async (s) => {
      const res = await claude().messages.parse(
        {
          model: MODEL,
          max_tokens: 8000,
          system,
          messages: [{ role: 'user', content }],
          output_config: { effort: 'low', format: zodOutputFormat(schema) },
        },
        { signal: s },
      );
      if (!res.parsed_output) throw new Error(`no parsed output (stop_reason ${res.stop_reason})`);
      return build(res.parsed_output as z.infer<S>);
    },
    fallback,
    ms,
    label,
    signal,
  );
}

const Spoken = z.object({ text: z.string(), tts: z.string() });
/** Models sometimes start a line with its speaker ("Judge: …"), even after leading audio tags. */
const SPEAKER_LABEL = /^((?:\[[^\]\n]{1,40}\]\s*)*)(?:the\s+)?(?:judge|prosecution|defen[cs]e|witness|future\s+you)(?:\s*\([^)]*\))?\s*:\s*/i;
// Side labels only in capitals ("YES:"), so a sentence opening "No: …" keeps its word.
const SIDE_LABEL = /^((?:\[[^\]\n]{1,40}\]\s*)*)(?:YES|NO)\s*:\s*/;
export const unlabel = (s: string) => s.replace(SPEAKER_LABEL, '$1').replace(SIDE_LABEL, '$1');
/** Display text never shows voice cues: models sometimes put audio tags like [confident] in `text` too. */
export const plain = (s: string) => unlabel(s).replace(/\[[^\]\n]{1,40}\]\s*/g, '').replace(/\s{2,}/g, ' ').trim();
const judgeLine = (kind: Line['kind'], s: { text: string; tts: string }, topic_id?: string): Line => {
  if (!plain(s.text)) throw new Error(`empty ${kind} line`); // → mock fallback (a bare label or tags is empty too)
  return { id: uid('line'), speaker: 'judge', kind, text: plain(s.text), tts: unlabel(s.tts), cites: [], topic_id };
};

// ─── setup (cut-scene): agenda + Judge lines + personas in ONE call ─────────

const PersonaSchema = z.object({
  years_from_now: z.number(),
  when: z.string(),
  age: z.number().nullable(),
  snapshot: z.string(),
  mood: z.string(),
});
const SetupSchema = z.object({
  topics: z.array(
    z.object({
      title: z.string(),
      question: z.string(),
      importance: z.number(),
      research_speed: z.enum(['quick', 'deep']),
      intro: Spoken,
    }),
  ),
  opening: Spoken,
  personas: z.object({ yes: PersonaSchema, no: PersonaSchema }),
});

export async function buildSetup(req: SetupRequest, signal?: AbortSignal): Promise<SetupResponse> {
  const { value } = await ask(
    P.SETUP_TASK,
    `QUESTION: ${req.question}\n${P.profileBlock(req.profile)}`,
    SetupSchema,
    TIMEOUTS.setup.server,
    'setup',
    (out): SetupResponse => {
      if (!out.topics.length) throw new Error('empty agenda');
      const withIntros = out.topics.slice(0, MAX_TOPICS).map((t, i) => ({
        topic: { id: `topic-${i + 1}`, title: t.title, question: t.question, importance: t.importance, research_speed: t.research_speed, status: 'pending', added_by: 'judge' } as Topic,
        intro: t.intro,
      }));
      const topics = orderAgenda(normalise(withIntros.map((x) => x.topic)));
      const intros: Record<string, Line> = {};
      for (const x of withIntros) intros[x.topic.id] = judgeLine('intro', x.intro, x.topic.id);
      const persona = (side: 'yes' | 'no', p: z.infer<typeof PersonaSchema>): Persona => {
        if (!p.snapshot.trim()) throw new Error('empty persona');
        const years = Math.min(30, Math.max(0.25, p.years_from_now));
        const age = req.profile?.age != null ? Math.round(req.profile.age + years) : p.age ?? undefined;
        return { side, age, when: p.when, years_from_now: years, snapshot: p.snapshot, mood: p.mood };
      };
      return {
        topics,
        opening: judgeLine('opening', out.opening),
        intros,
        personas: { yes: persona('yes', out.personas.yes), no: persona('no', out.personas.no) },
        fallback: false,
      };
    },
    () => mockSetup(req),
    'interactive',
    signal,
  );
  return value;
}

// ─── topic: the whole YES ↔ NO exchange + ledger + Judge's ruling in ONE call ─

const TopicSchema = z.object({
  lines: z.array(
    z.object({
      text: z.string(),
      tts: z.string(),
      cites: z.array(z.string()),
      cut_in: Spoken.describe('The other side cutting in; empty strings if none'),
      resume: Spoken.describe("The speaker's comeback after the cut-in; empty strings if none"),
      punch: Spoken.describe('Surprise punch: the climactic final 2-8 words, said after "text"; empty strings if none'),
    }),
  ),
  ledger: z.array(
    z.object({
      line_index: z.number().int().describe('Index into lines; -1 for a point the witness made earlier'),
      claim: z.string(),
      supports: z.enum(['yes', 'no', 'neutral']),
      strength: z.number().int(),
    }),
  ),
  t: z.number(),
  confidence: z.number(),
  reasoning: z.string(),
  deciding_argument: z.string(),
  ruling: Spoken,
});

const EMPTY = { text: '', tts: '' };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
/** A spoken pair from whatever the model sent: a bare string, a half-filled object, or nothing. */
function spoken(v: unknown): { text: string; tts: string } {
  if (typeof v === 'string') return { text: v, tts: v };
  if (!v || typeof v !== 'object') return { ...EMPTY };
  const o = v as { text?: unknown; tts?: unknown };
  const text = str(o.text) || str(o.tts);
  return { text, tts: str(o.tts) || text };
}

/**
 * Free models' near-misses on TopicSchema, fixed before validation instead of throwing the whole exchange
 * away: a line sent as a bare string (seen live: every other line), a missing optional part (cut-in,
 * resume, punch, cites), a missing reasoning / deciding argument / confidence, a ruling sent as a string.
 * Speakers don't need fixing: the code takes them from the turn plan. What it can't invent (the score `t`,
 * a line's words) stays missing, so validation still fails and the call is retried.
 */
export function repairTopic(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const o = { ...(raw as Record<string, unknown>) };
  if (Array.isArray(o.lines))
    o.lines = o.lines.map((l) => {
      if (typeof l === 'string') return { text: l, tts: l, cites: [], cut_in: { ...EMPTY }, resume: { ...EMPTY }, punch: { ...EMPTY } };
      if (!l || typeof l !== 'object') return l;
      const line = l as Record<string, unknown>;
      const said = spoken(line);
      return {
        ...line,
        text: said.text,
        tts: said.tts,
        cites: Array.isArray(line.cites) ? line.cites.filter((c) => typeof c === 'string') : [],
        cut_in: spoken(line.cut_in),
        resume: spoken(line.resume),
        punch: spoken(line.punch),
      };
    });
  if (!Array.isArray(o.ledger)) o.ledger = [];
  if (typeof o.reasoning !== 'string') o.reasoning = '';
  if (typeof o.deciding_argument !== 'string') o.deciding_argument = '';
  if (typeof o.confidence !== 'number') o.confidence = 0.5;
  if ('ruling' in o) o.ruling = spoken(o.ruling);
  return o;
}

export async function writeTopic(req: TopicRequest, signal?: AbortSignal): Promise<TopicResponse> {
  const valid = new Set(req.cards.map((c) => c.id));
  const t = req.urgent ? TIMEOUTS.topicUrgent : TIMEOUTS.topic;
  const { value } = await ask(
    P.TOPIC_TASK,
    [
      P.topicBlock(req.question, req.topic),
      P.profileBlock(req.profile),
      P.personasBlock(req.personas),
      P.cardsBlock(req.cards),
      P.historyBlock(req.history),
      `CUT-IN ALLOWED: ${req.cutInAllowed ? 'yes' : 'no'}`,
      `PUNCH ALLOWED: ${punchedSides(req.history, req.topic.id).size ? 'no' : 'yes'}`,
      P.turnsBlock(req.turns, req.userPoint),
    ].join('\n'),
    TopicSchema,
    t.server,
    'topic',
    (out): TopicResponse => {
      // The code owns the structure: one line per planned turn, speakers from the plan.
      // (Checked after cleaning: a line that was only a speaker label or audio tags is empty too.)
      if (out.lines.length < req.turns.length || req.turns.some((_, i) => !plain(out.lines[i].text).replace(/—/g, '').trim()))
        throw new Error(`topic: ${out.lines.length} lines for ${req.turns.length} turns`);
      const lines: Line[] = [];
      const byIndex: Line[] = [];
      let cutUsed = !req.cutInAllowed;
      const punched = punchedSides(req.history, req.topic.id);
      req.turns.forEach((turn, i) => {
        const o = out.lines[i];
        const base = { topic_id: req.topic.id, cycle: turn.cycle };
        const line: Line = {
          id: uid('line'),
          speaker: SIDE_SPEAKER[turn.side],
          kind: turn.answer ? 'answer' : 'argument',
          text: plain(o.text),
          tts: unlabel(o.tts),
          cites: o.cites.filter((c) => valid.has(c)),
          ...base,
        };
        lines.push(line);
        byIndex.push(line);
        if (!cutUsed && !turn.answer && plain(o.cut_in.text) && plain(o.resume.text)) {
          cutUsed = true;
          // The cut-in interrupts this line: it must end cut off (a punch on it is dropped by design).
          // End mark before any closing quote or trailing tags: "less. [sighs]" → "less [sighs] —".
          const cutOff = (s: string) => (s.trim().endsWith('—') ? s.trim() : `${s.trim().replace(/[.!?…]+(?=["”’')»]*(?:\s*\[[^\]]*\])*$)/, '')} —`);
          line.text = cutOff(line.text);
          if (line.tts?.trim()) line.tts = cutOff(line.tts);
          const other = turn.side === 'yes' ? 'no' : 'yes';
          lines.push(
            { id: uid('line'), speaker: SIDE_SPEAKER[other], kind: 'cut_in', text: plain(o.cut_in.text), tts: unlabel(o.cut_in.tts), cites: [], ...base },
            { id: uid('line'), speaker: SIDE_SPEAKER[turn.side], kind: 'resume', text: plain(o.resume.text), tts: unlabel(o.resume.tts), cites: [], ...base },
          );
        } else if (line.text.trim().endsWith('—')) {
          // No cut-in for this line: don't leave it hanging mid-sentence. A punch the model wrote anyway is
          // the end of that sentence: keep it as ordinary words (no punch shot: the line was meant to be cut).
          const draft = o.punch && plain(o.punch.text) ? { text: plain(o.punch.text), tts: unlabel(o.punch.tts) } : undefined;
          line.text = line.text.trim().replace(/\s*—$/, draft ? '' : '.');
          if (line.tts) line.tts = line.tts.trim().replace(/\s*—$/, draft ? '' : '.');
          if (draft) attachPunch(line, draft, new Set(['yes', 'no'])); // refused → appended
          // (If the text already said the punch, nothing was appended: still end the sentence.)
          if (!/[.!?…]["”’')»]*$/.test(line.text.trim())) line.text = `${line.text.trim()}.`;
          if (line.tts && !/[.!?…]["”’')»]*$/.test(line.tts.trim())) line.tts = `${line.tts.trim()}.`;
        } else {
          attachPunch(line, o.punch && { text: plain(o.punch.text), tts: unlabel(o.punch.tts) }, punched);
        }
      });
      // The witness's point being answered (line_index -1) is recorded once; earlier points already were.
      const userLine = req.userPoint ? [...req.history].reverse().find((l) => l.speaker === 'user') : undefined;
      let userRecorded = false;
      const ledger: LedgerEntry[] = out.ledger
        .map((e): LedgerEntry | null => {
          if (e.line_index === -1 && userRecorded) return null;
          const line = e.line_index === -1 ? userLine : byIndex[e.line_index];
          if (!line) return null;
          if (e.line_index === -1) userRecorded = true;
          return { id: uid('ledger'), line_id: line.id, topic_id: req.topic.id, by: line.speaker, supports: e.supports, claim: e.claim, strength: Math.min(5, Math.max(1, e.strength)), card_ids: line.cites };
        })
        .filter((e): e is LedgerEntry => e !== null);
      return {
        lines,
        ledger,
        score: {
          t: Math.max(-1, Math.min(1, out.t)),
          confidence: Math.max(0, Math.min(1, out.confidence)),
          reasoning: out.reasoning,
          deciding_argument: out.deciding_argument,
        },
        ruling: judgeLine('score', out.ruling, req.topic.id),
        fallback: false,
      };
    },
    () => mockTopic(req),
    req.urgent ? 'interactive' : 'background',
    signal,
    repairTopic,
  );
  return value;
}

// ─── profile (onboarding) ───────────────────────────────────────────────────

const ProfileSchema = z.object({
  name: z.string().nullable(),
  age: z.number().int().nullable(),
  situation: z.string().nullable().describe('Short phrase: "first-year CS student", "nurse with two kids"'),
  location: z.string().nullable(),
  people: z.string().nullable().describe('Who their decisions affect'),
  risk_tolerance: z.enum(['cautious', 'balanced', 'bold']).nullable(),
  money: z.string().nullable().describe('Their money situation in a few words, no exact figures'),
  goals: z.string().nullable(),
  fears: z.string().nullable(),
  values: z.array(z.string()).describe('1-4 single words, e.g. freedom, family, security'),
  notes: z.string().nullable().describe('Anything else that would matter for a life decision'),
  question: z.string().nullable().describe('The decision they described, as "Should I …?"; null if none'),
});

export async function extractProfile(req: ProfileRequest, signal?: AbortSignal): Promise<ProfileResponse> {
  const text = onboardingText(req);
  if (!text) return { profile: mergeProfile({}, req.form), fallback: true };
  const { value } = await ask(
    P.PROFILE_TASK,
    req.answers?.length
      ? req.answers.map((a) => `Q: ${a.question}\nA: ${a.transcript}`).join('\n\n')
      : `TRANSCRIPT:\n${text}`,
    ProfileSchema,
    TIMEOUTS.profile.server,
    'profile',
    (out): ProfileResponse => {
      const extracted: UserProfile = {};
      for (const [k, v] of Object.entries(out)) {
        if (k === 'question' || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
        (extracted as Record<string, unknown>)[k] = v;
      }
      if (extracted.age != null && (extracted.age < 10 || extracted.age > 99)) delete extracted.age;
      return { profile: mergeProfile(extracted, req.form), question: out.question?.trim() || undefined, fallback: false };
    },
    () => mockProfile(req),
    'interactive',
    signal,
  );
  return value;
}

// ─── user interrupts the Judge → agenda change ──────────────────────────────

const JudgeInterruptSchema = z.object({
  action: z.enum(['add', 'remove', 'none']),
  add_title: z.string().describe('For add; else empty'),
  add_question: z.string().describe('For add; else empty'),
  add_research_speed: z.enum(['quick', 'deep']),
  add_share: z.number().describe('For add: 0.05-0.6 share of total weight; else 0'),
  remove_id: z.string().describe('For remove: a topic id from the agenda; else empty'),
  line: Spoken,
});

export async function judgeInterrupt(req: JudgeInterruptRequest, signal?: AbortSignal): Promise<JudgeInterruptResponse> {
  const removable = new Set(req.agenda.filter((t) => t.status === 'pending' || t.status === 'active').map((t) => t.id));
  const { value } = await ask(
    P.JUDGE_INTERRUPT_TASK,
    `QUESTION: ${req.question}
AGENDA:
${req.agenda.map((t) => `- ${t.id} [${t.status}, ${Math.round(t.importance * 100)}%] ${t.title}: ${t.question}`).join('\n')}

THE WITNESS SAYS: "${req.text}"`,
    JudgeInterruptSchema,
    TIMEOUTS.judgeInterrupt.server,
    'judge-interrupt',
    (out): JudgeInterruptResponse => {
      const line = judgeLine('agenda_change', out.line);
      if (out.action === 'add' && out.add_title) {
        const topic: Topic = {
          id: uid('topic'),
          title: out.add_title,
          question: out.add_question || out.add_title,
          importance: Math.min(0.6, Math.max(0.05, out.add_share)),
          research_speed: out.add_research_speed,
          status: 'pending',
          added_by: 'user',
        };
        return { action: 'add', topic, line: { ...line, topic_id: topic.id }, fallback: false };
      }
      if (out.action === 'remove' && removable.has(out.remove_id)) return { action: 'remove', remove_id: out.remove_id, line, fallback: false };
      return { action: 'none', line, fallback: false };
    },
    () => mockJudgeInterrupt(req),
    'interactive',
    signal,
  );
  return value;
}

// ─── verdict ────────────────────────────────────────────────────────────────

const VerdictSchema = z.object({ explanation: z.string(), line: Spoken });

export async function verdict(req: VerdictRequest, signal?: AbortSignal): Promise<VerdictResponse> {
  const spectrum = computeSpectrum(req.agenda);
  const scored = req.agenda.filter((t) => t.status !== 'removed' && t.score);
  const breakdown = scored.map((t) => ({ topic_id: t.id, title: t.title, weight: t.importance, t: t.score!.t, deciding_argument: t.score!.deciding_argument, added_by: t.added_by }));
  const { value } = await ask(
    P.VERDICT_TASK,
    `QUESTION: ${req.question}
SPECTRUM (fixed): ${spectrum.value > 0 ? '+' : ''}${spectrum.value} on −100 (definitely no) … +100 (definitely yes) → "${spectrum.label}"
TOPICS:
${scored.map((t) => `- ${t.title} (${Math.round(t.importance * 100)}% weight${t.added_by === 'user' ? ', added by the witness' : ''}): t=${t.score!.t.toFixed(2)}. ${t.score!.reasoning} Deciding: ${t.score!.deciding_argument}`).join('\n')}
${req.agenda.some((t) => t.status === 'removed') ? `REMOVED BY THE WITNESS: ${req.agenda.filter((t) => t.status === 'removed').map((t) => t.title).join(', ')}` : ''}
WITNESS INTERRUPTS: ${req.userLines.length ? req.userLines.map((l) => `"${l.text}"`).join('; ') : '(none)'}`,
    VerdictSchema,
    TIMEOUTS.verdict.server,
    'verdict',
    (out): VerdictResponse => ({
      verdict: { spectrum, explanation: plain(out.explanation), breakdown, line: judgeLine('verdict', out.line) },
      fallback: false,
    }),
    () => mockVerdict(req),
    'interactive',
    signal,
  );
  return value;
}
