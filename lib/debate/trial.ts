// Server-side trial calls (one Claude call each). Every one falls back to lib/debate/mock.ts.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type {
  AgendaResponse,
  ArgueRequest,
  ArgueResponse,
  JudgeInterruptRequest,
  JudgeInterruptResponse,
  Line,
  Persona,
  PersonasRequest,
  PersonasResponse,
  ProfileRequest,
  ProfileResponse,
  ScoreArgumentRequest,
  ScoreArgumentResponse,
  ScoreTopicRequest,
  ScoreTopicResponse,
  Topic,
  UserProfile,
  VerdictRequest,
  VerdictResponse,
} from '@/types';
import { SIDE_SPEAKER } from '@/types';
import { claude, hasClaudeKey, MODEL } from './claude';
import { askGemini, hasGeminiKey } from './gemini';
import { uid, withFallback } from './fallback';
import { TIMEOUTS } from './timeouts';
import { mergeProfile, mockAgenda, mockArgue, mockJudgeInterrupt, mockPersonas, mockProfile, mockScoreArgument, mockScoreTopic, mockVerdict, onboardingText } from './mock';
import * as P from './prompts';
import { computeSpectrum, MAX_TOPICS, normalise, orderAgenda } from './spectrum';

/** One structured Claude call (or Gemini without a Claude key) → parsed object, or `fallback()` if no key / error / timeout. */
async function ask<S extends z.ZodType, R>(
  task: string,
  content: string,
  schema: S,
  ms: number,
  label: string,
  build: (out: z.infer<S>) => R,
  fallback: () => R,
): Promise<{ value: R; fallback: boolean }> {
  if (!hasClaudeKey()) {
    if (!hasGeminiKey()) return { value: fallback(), fallback: true };
    return withFallback(async (signal) => build(await askGemini(`${P.COURT}\n\n${task}`, content, schema, signal)), fallback, ms, label);
  }
  return withFallback(
    async (signal) => {
      const res = await claude().messages.parse(
        {
          model: MODEL,
          max_tokens: 4000,
          system: `${P.COURT}\n\n${task}`,
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

// ─── agenda ─────────────────────────────────────────────────────────────────

const AgendaSchema = z.object({
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
});

export async function buildAgenda(question: string, profile?: UserProfile): Promise<AgendaResponse> {
  const { value, fallback } = await ask(
    P.AGENDA_TASK,
    `QUESTION: ${question}
${P.profileBlock(profile)}`,
    AgendaSchema,
    TIMEOUTS.agenda.server,
    'agenda',
    (out): AgendaResponse => {
      if (!out.topics.length) throw new Error('empty agenda');
      const withIntros = out.topics.slice(0, MAX_TOPICS).map((t, i) => ({
        topic: { id: `topic-${i + 1}`, title: t.title, question: t.question, importance: t.importance, research_speed: t.research_speed, status: 'pending', added_by: 'judge' } as Topic,
        intro: t.intro,
      }));
      const topics = orderAgenda(normalise(withIntros.map((x) => x.topic)));
      const intros: Record<string, Line> = {};
      for (const x of withIntros) intros[x.topic.id] = judgeLine('intro', x.intro, x.topic.id);
      return { topics, opening: judgeLine('opening', out.opening), intros, fallback: false };
    },
    () => mockAgenda(question),
  );
  return { ...value, fallback: value.fallback || fallback };
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

// ─── personas (cut-scene) ───────────────────────────────────────────────────

const PersonaSchema = z.object({
  years_from_now: z.number(),
  when: z.string(),
  age: z.number().nullable(),
  snapshot: z.string(),
  mood: z.string(),
});
const PersonasSchema = z.object({ yes: PersonaSchema, no: PersonaSchema });

export async function buildPersonas(req: PersonasRequest): Promise<PersonasResponse> {
  const { value } = await ask(
    P.PERSONAS_TASK,
    `QUESTION: ${req.question}
${P.profileBlock(req.profile)}`,
    PersonasSchema,
    TIMEOUTS.personas.server,
    'personas',
    (out): PersonasResponse => {
      const persona = (side: 'yes' | 'no', p: z.infer<typeof PersonaSchema>): Persona => {
        if (!p.snapshot.trim()) throw new Error('empty persona'); // → mock fallback
        const years = Math.min(30, Math.max(0.25, p.years_from_now));
        const age = req.profile?.age != null ? Math.round(req.profile.age + years) : p.age ?? undefined;
        return { side, age, when: p.when, years_from_now: years, snapshot: p.snapshot, mood: p.mood };
      };
      return { personas: { yes: persona('yes', out.yes), no: persona('no', out.no) }, fallback: false };
    },
    () => mockPersonas(req),
  );
  return value;
}

// ─── argue (inner loop) ─────────────────────────────────────────────────────

const ArgueSchema = z.object({
  text: z.string(),
  tts: z.string(),
  cites: z.array(z.string()),
  exhausted: z.boolean(),
  cut_in: Spoken.describe('The other side cutting in; empty strings if none'),
  resume: Spoken.describe('Your comeback after the cut-in; empty strings if none'),
});

export async function argue(req: ArgueRequest): Promise<ArgueResponse> {
  const valid = new Set(req.cards.map((c) => c.id));
  const own = req.cards.filter((c) => c.side === req.side);
  const { value } = await ask(
    P.ARGUE_TASK,
    `${P.topicBlock(req.question, req.topic)}
YOU ARE: ${req.side === 'yes' ? 'PROSECUTION (YES), the best future you' : 'DEFENSE (NO), the worst future you'} · cycle ${req.cycle}
${P.personaBlock(req.persona)}
${P.profileBlock(req.profile)}
CUT-IN ALLOWED: ${req.cutInAllowed && !req.userPoint ? 'yes' : 'no'}
${P.cardsBlock(own)}
${P.historyBlock(req.history)}${req.userPoint ? `\n\nUSER POINT (the witness just interrupted you): "${req.userPoint}"` : ''}`,
    ArgueSchema,
    TIMEOUTS.argue.server,
    'argue',
    (out): ArgueResponse => {
      if (!out.text.trim()) throw new Error('empty argument'); // → mock fallback
      const other = req.side === 'yes' ? 'no' : 'yes';
      const cutIn =
        req.cutInAllowed && !req.userPoint && out.cut_in.text.trim() && out.resume.text.trim()
          ? {
              line: { id: uid('line'), speaker: SIDE_SPEAKER[other], kind: 'cut_in' as const, text: out.cut_in.text, tts: out.cut_in.tts, cites: [], topic_id: req.topic.id, cycle: req.cycle },
              resume: { id: uid('line'), speaker: SIDE_SPEAKER[req.side], kind: 'resume' as const, text: out.resume.text, tts: out.resume.tts, cites: [], topic_id: req.topic.id, cycle: req.cycle },
            }
          : undefined;
      return {
        cutIn,
        line: {
          id: uid('line'),
          speaker: SIDE_SPEAKER[req.side],
          kind: req.userPoint ? 'answer' : 'argument',
          text: out.text,
          tts: out.tts,
          cites: out.cites.filter((c) => valid.has(c)),
          topic_id: req.topic.id,
          cycle: req.cycle,
        },
        exhausted: out.exhausted,
        fallback: false,
      };
    },
    () => mockArgue(req),
  );
  return value;
}

// ─── ledger (background) ────────────────────────────────────────────────────

const LedgerSchema = z.object({
  claim: z.string(),
  supports: z.enum(['yes', 'no', 'neutral']),
  strength: z.number().int(),
  card_ids: z.array(z.string()),
});

export async function scoreArgument(req: ScoreArgumentRequest): Promise<ScoreArgumentResponse> {
  const { value, fallback } = await ask(
    P.SCORE_ARGUMENT_TASK,
    `${P.topicBlock(req.question, req.topic)}
${P.cardsBlock(req.cards)}
LINE (by ${req.line.speaker}): ${req.line.text}`,
    LedgerSchema,
    TIMEOUTS.scoreArgument.server,
    'score-argument',
    (out) => ({
      id: uid('ledger'),
      line_id: req.line.id,
      topic_id: req.topic.id,
      by: req.line.speaker,
      supports: out.supports,
      claim: out.claim,
      strength: Math.min(5, Math.max(1, out.strength)),
      card_ids: out.card_ids,
    }),
    () => mockScoreArgument(req),
  );
  return { entry: value, fallback };
}

// ─── topic score (outer loop) ───────────────────────────────────────────────

const TopicScoreSchema = z.object({
  t: z.number(),
  confidence: z.number(),
  reasoning: z.string(),
  deciding_argument: z.string(),
  line: Spoken,
});

export async function scoreTopic(req: ScoreTopicRequest): Promise<ScoreTopicResponse> {
  const { value } = await ask(
    P.SCORE_TOPIC_TASK,
    `${P.topicBlock(req.question, req.topic)}
${P.ledgerBlock(req.ledger)}
${P.historyBlock(req.history)}`,
    TopicScoreSchema,
    TIMEOUTS.scoreTopic.server,
    'score-topic',
    (out): ScoreTopicResponse => ({
      score: {
        t: Math.max(-1, Math.min(1, out.t)),
        confidence: Math.max(0, Math.min(1, out.confidence)),
        reasoning: out.reasoning,
        deciding_argument: out.deciding_argument,
      },
      line: judgeLine('score', out.line, req.topic.id),
      fallback: false,
    }),
    () => mockScoreTopic(req),
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
