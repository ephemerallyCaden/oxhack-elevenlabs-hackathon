// D14 smoke test: runs 5 varied questions through every trial route on a running server with REAL keys,
// and reports latency per call, which calls fell back to mocks (and why), and sample lines to read aloud.
//
//   1. ANTHROPIC_API_KEY in .env.local, then `npm run dev`
//   2. npx tsx scripts/smoke-trial.ts [baseUrl]
import type {
  AgendaResponse,
  ArgueResponse,
  EvidenceCard,
  Line,
  PersonasResponse,
  ResearchResponse,
  ScoreArgumentResponse,
  ScoreTopicResponse,
  Topic,
  UserProfile,
  VerdictResponse,
} from '../types';
import { TIMEOUTS } from '../lib/debate/timeouts';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

const CASES: { question: string; profile?: UserProfile }[] = [
  { question: 'Should I take a gap year before university?', profile: { age: 18, situation: 'finishing sixth form', location: 'Leeds' } },
  { question: 'Should I move from Manchester to Berlin for a tech job?', profile: { age: 27, situation: 'software engineer', location: 'Manchester' } },
  { question: 'Should I adopt a dog?', profile: { age: 31, situation: 'lives alone in a one-bed flat, works hybrid' } },
  { question: 'Should I quit my job to start a bakery?', profile: { age: 35, situation: 'accountant with two kids', location: 'Bristol' } },
  { question: 'Should I buy a car?' }, // no profile at all
];

type Row = { q: number; step: string; ms: number; fallback: boolean; budget?: number };
const rows: Row[] = [];
const samples: string[] = [];

async function call<T extends { fallback?: boolean }>(q: number, step: string, path: string, body: unknown, budget?: number): Promise<T> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const ms = Date.now() - t0;
  if (!res.ok) {
    rows.push({ q, step, ms, fallback: true, budget });
    throw new Error(`${path} → ${res.status}`);
  }
  const json = (await res.json()) as T;
  rows.push({ q, step, ms, fallback: !!json.fallback, budget });
  return json;
}

async function research(q: number, question: string, topic: Topic): Promise<EvidenceCard[]> {
  const cards: EvidenceCard[] = [];
  for (const side of ['yes', 'no'] as const) {
    try {
      const r = await call<ResearchResponse>(q, `research ${side}`, '/api/research', { question, topic, side, tier: 'quick' }, TIMEOUTS.quickResearch.client);
      cards.push(...r.cards);
    } catch {
      // A's route may not exist yet: debate continues without cards (that's what the app does too).
    }
  }
  return cards;
}

async function run(q: number, { question, profile }: (typeof CASES)[number]) {
  const [agenda, cast] = await Promise.all([
    call<AgendaResponse>(q, 'agenda', '/api/trial/agenda', { question, profile }, TIMEOUTS.agenda.server),
    call<PersonasResponse>(q, 'personas', '/api/trial/personas', { question, profile }, TIMEOUTS.personas.server),
  ]);
  const topic = { ...agenda.topics[0], status: 'active' as const };
  const cards = await research(q, question, topic);

  const history: Line[] = [];
  const say = (l: Line) => history.push(l);
  const who = { prosecution: 'YES', defense: 'NO', judge: 'JUDGE', user: 'YOU' } as const;

  samples.push(`\n── Q${q}: ${question}`);
  samples.push(`   topics: ${agenda.topics.map((t) => `${t.title} ${Math.round(t.importance * 100)}%`).join(' · ')}`);
  samples.push(`   best you: ${cast.personas.yes.when}${cast.personas.yes.age != null ? `, ${cast.personas.yes.age}` : ''}, ${cast.personas.yes.mood}`);
  samples.push(`   worst you: ${cast.personas.no.when}${cast.personas.no.age != null ? `, ${cast.personas.no.age}` : ''}, ${cast.personas.no.mood}`);
  samples.push(`   JUDGE: ${agenda.opening.text}`);

  const ledger = [];
  for (const [side, cycle] of [['yes', 1], ['no', 1], ['yes', 2]] as const) {
    const r = await call<ArgueResponse>(q, `argue ${side}`, '/api/trial/argue', {
      question, topic, side, cycle, history, cards, persona: cast.personas[side], profile, cutInAllowed: true,
    }, TIMEOUTS.argue.server);
    say(r.line);
    samples.push(`   ${who[r.line.speaker]}: ${r.line.text}`);
    if (r.cutIn) {
      say(r.cutIn.line);
      say(r.cutIn.resume);
      samples.push(`   ${who[r.cutIn.line.speaker]} (cuts in): ${r.cutIn.line.text}`, `   ${who[r.cutIn.resume.speaker]}: ${r.cutIn.resume.text}`);
    }
    const s = await call<ScoreArgumentResponse>(q, 'score-argument', '/api/trial/score-argument', { question, topic, line: r.line, cards }, TIMEOUTS.scoreArgument.server);
    ledger.push(s.entry);
  }

  const st = await call<ScoreTopicResponse>(q, 'score-topic', '/api/trial/score-topic', { question, topic, ledger, history }, TIMEOUTS.scoreTopic.server);
  samples.push(`   JUDGE (t=${st.score.t.toFixed(2)}): ${st.line.text}`);
  const scored = agenda.topics.map((t) => (t.id === topic.id ? { ...t, status: 'done', score: st.score } : t));
  const v = await call<VerdictResponse>(q, 'verdict', '/api/trial/verdict', { question, agenda: scored, userLines: [] }, TIMEOUTS.verdict.server);
  samples.push(`   VERDICT ${v.verdict.spectrum.value} (${v.verdict.spectrum.label}): ${v.verdict.line.text}`);
}

async function main() {
  console.log(`Smoke test against ${BASE}\n`);
  for (const [i, c] of CASES.entries()) {
    try {
      await run(i + 1, c);
    } catch (err) {
      console.error(`Q${i + 1} stopped: ${(err as Error).message}`);
    }
  }

  // Latency per step. A fallback close to the server budget = timeout; well under it = error/no key.
  const steps = [...new Set(rows.map((r) => r.step))];
  console.log('step              calls  median   max   budget  fell back');
  for (const step of steps) {
    const rs = rows.filter((r) => r.step === step);
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const fb = rs.filter((r) => r.fallback);
    const timeouts = fb.filter((r) => r.budget && r.ms >= r.budget * 0.9).length;
    const why = fb.length ? ` (${timeouts} timeout, ${fb.length - timeouts} error/no key)` : '';
    console.log(
      `${step.padEnd(17)} ${String(rs.length).padStart(5)} ${String(ms[Math.floor(ms.length / 2)]).padStart(6)}ms ${String(ms.at(-1)).padStart(5)}ms ${String(rs[0].budget ?? '-').padStart(6)}  ${fb.length}/${rs.length}${why}`,
    );
  }
  const llm = rows.filter((r) => !r.step.startsWith('research'));
  const rate = llm.filter((r) => r.fallback).length / Math.max(1, llm.length);
  console.log(`\nClaude calls that fell back: ${Math.round(rate * 100)}% (target < 10%)`);
  console.log('\nRead these aloud as a team: specific? sourced? funny? in character?');
  console.log(samples.join('\n'));
}

main();
