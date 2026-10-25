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
import { uid, withFallback } from './fallback';
import type { Priority } from './ratelimit';
import { TIMEOUTS } from './timeouts';
import { mergeProfile, mockJudgeInterrupt, mockProfile, mockSetup, mockTopic, mockVerdict, onboardingText } from './mock';
import * as P from './prompts';
import { computeSpectrum, MAX_TOPICS, normalise, orderAgenda } from './spectrum';

/**
 * Which model writes the debate. DEBATE_LLM in .env.local: `mock` (testing, no API calls),
 * `gemini`, `claude`, or `auto` (default: Claude if its key is set, else Gemini, else mock).
 */
function debateLlm(): 'claude' | 'gemini' | 'mock' {
  const want = process.env.DEBATE_LLM ?? 'auto';
  if (want === 'mock') return 'mock';
  if ((want === 'claude' || want === 'auto') && hasClaudeKey()) return 'claude';
  if ((want === 'gemini' || want === 'auto') && hasGeminiKey()) return 'gemini';
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
): Promise<{ value: R; fallback: boolean }> {
  const llm = debateLlm();
  if (llm === 'mock') return { value: fallback(), fallback: true };
  const system = `${P.COURT}\n\n${task}`;
  if (llm === 'gemini') {
    const deadline = Date.now() + ms;
    return withFallback(async (signal) => build(await askGemini(system, content, schema, signal, priority, deadline)), fallback, ms, label);
  }
  return withFallback(
    async (signal) => {
      const res = await claude().messages.parse(
        {
          model: MODEL,
          max_tokens: 8000,
          system,
          messages: [{ role: 'user', content }],
          output_config: { effort: 'low', format: zodOutputFormat(schema) },
        },
        { signal },
      );
      if (!res.parsed_output) throw new Error(`no parsed output (stop_reason ${res.stop_reason})`);
      return build(res.parsed_output as z.infer<S>);
    },
    fallback,
    ms,
    label,
  );
}

const Spoken = z.object({ text: z.string(), tts: z.string() });
const judgeLine = (kind: Line['kind'], s: { text: string; tts: string }, topic_id?: string): Line => {
  if (!s.text.trim()) throw new Error(`empty ${kind} line`); // → mock fallback
  return { id: uid('line'), speaker: 'judge', kind, text: s.text, tts: s.tts, cites: [], topic_id };
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

export async function buildSetup(req: SetupRequest): Promise<SetupResponse> {
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

export async function writeTopic(req: TopicRequest): Promise<TopicResponse> {
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
      P.turnsBlock(req.turns, req.userPoint),
    ].join('\n'),
    TopicSchema,
    t.server,
    'topic',
    (out): TopicResponse => {
      // The code owns the structure: one line per planned turn, speakers from the plan.
      if (out.lines.length < req.turns.length || req.turns.some((_, i) => !out.lines[i].text.trim()))
        throw new Error(`topic: ${out.lines.length} lines for ${req.turns.length} turns`);
      const lines: Line[] = [];
      const byIndex: Line[] = [];
      let cutUsed = !req.cutInAllowed;
      req.turns.forEach((turn, i) => {
        const o = out.lines[i];
        const base = { topic_id: req.topic.id, cycle: turn.cycle };
        const line: Line = {
          id: uid('line'),
          speaker: SIDE_SPEAKER[turn.side],
          kind: turn.answer ? 'answer' : 'argument',
          text: o.text,
          tts: o.tts,
          cites: o.cites.filter((c) => valid.has(c)),
          ...base,
        };
        lines.push(line);
        byIndex.push(line);
        if (!cutUsed && !turn.answer && o.cut_in.text.trim() && o.resume.text.trim()) {
          cutUsed = true;
          const other = turn.side === 'yes' ? 'no' : 'yes';
          lines.push(
            { id: uid('line'), speaker: SIDE_SPEAKER[other], kind: 'cut_in', text: o.cut_in.text, tts: o.cut_in.tts, cites: [], ...base },
            { id: uid('line'), speaker: SIDE_SPEAKER[turn.side], kind: 'resume', text: o.resume.text, tts: o.resume.tts, cites: [], ...base },
          );
        } else if (line.text.trim().endsWith('—')) {
          // No cut-in for this line: don't leave it hanging mid-sentence.
          line.text = line.text.trim().replace(/—$/, '.');
          if (line.tts) line.tts = line.tts.trim().replace(/—$/, '.');
        }
      });
      const userLine = [...req.history].reverse().find((l) => l.speaker === 'user');
      const ledger: LedgerEntry[] = out.ledger
        .map((e): LedgerEntry | null => {
          const line = e.line_index === -1 ? userLine : byIndex[e.line_index];
          if (!line) return null;
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

export async function extractProfile(req: ProfileRequest): Promise<ProfileResponse> {
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

export async function judgeInterrupt(req: JudgeInterruptRequest): Promise<JudgeInterruptResponse> {
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
  );
  return value;
}

// ─── verdict ────────────────────────────────────────────────────────────────

const VerdictSchema = z.object({ explanation: z.string(), line: Spoken });

export async function verdict(req: VerdictRequest): Promise<VerdictResponse> {
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
      verdict: { spectrum, explanation: out.explanation, breakdown, line: judgeLine('verdict', out.line) },
      fallback: false,
    }),
    () => mockVerdict(req),
  );
  return value;
}
