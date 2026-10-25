// D14 smoke test: runs real questions through the trial routes on a running server with real keys and
// reports latency per call, which calls fell back to mocks (and why), and sample lines to read aloud.
// Gemini's free tier allows 5 calls/minute; the server's rate limiter queues calls, so this takes a few
// minutes. Each question = setup + one topic + one interrupt rewrite + verdict (4 calls).
//
//   1. GEMINI_API_KEY (or ANTHROPIC_API_KEY) in .env.local, then `npm run dev`
//   2. npx tsx scripts/smoke-trial.ts [baseUrl]
import type {
  EvidenceCard,
  Line,
  ResearchResponse,
  SetupResponse,
  Topic,
  TopicResponse,
  TopicTurn,
  UserProfile,
  VerdictResponse,
} from '../types';
import { TIMEOUTS } from '../lib/debate/timeouts';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';

const CASES: { question: string; profile?: UserProfile; interrupt: string }[] = [
  { question: 'Should I take a gap year before university?', profile: { age: 18, situation: 'finishing sixth form', location: 'Leeds' }, interrupt: "But I'd be working for half of it" },
  { question: 'Should I adopt a dog?', profile: { age: 31, situation: 'lives alone in a one-bed flat, works hybrid' }, interrupt: 'My landlord might not allow it' },
  { question: 'Should I quit my job to start a bakery?', profile: { age: 35, situation: 'accountant with two kids', location: 'Bristol' }, interrupt: 'I have six months of savings' },
];

type Row = { q: number; step: string; ms: number; fallback: boolean; budget: number };
const rows: Row[] = [];
const samples: string[] = [];

async function call<T extends { fallback?: boolean }>(q: number, step: string, path: string, body: unknown, budget: number): Promise<T> {
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

const WHO = { prosecution: 'YES', defense: 'NO', judge: 'JUDGE', user: 'YOU' } as const;
const show = (l: Line) => samples.push(`   ${WHO[l.speaker]}${l.kind === 'cut_in' ? ' (cuts in)' : l.kind === 'answer' ? ' (answers you)' : ''}: ${l.text}`);

async function run(q: number, c: (typeof CASES)[number]) {
  const { question, profile } = c;
  const setup = await call<SetupResponse>(q, 'setup', '/api/trial/setup', { question, profile }, TIMEOUTS.setup.server);
  const topic: Topic = { ...setup.topics[0], status: 'active' };

  let cards: EvidenceCard[] = [];
  try {
    const r = await call<ResearchResponse>(q, 'research', '/api/research', { question, topic, side: 'yes', tier: 'quick' }, TIMEOUTS.quickResearch.client);
    cards = r.cards;
  } catch {
    // research route may be a stub; the debate runs without cards
  }

  samples.push(`\n── Q${q}: ${question}`);
  samples.push(`   topics: ${setup.topics.map((t) => `${t.title} ${Math.round(t.importance * 100)}%`).join(' · ')}`);
  for (const side of ['yes', 'no'] as const) {
    const p = setup.personas[side];
    samples.push(`   ${side === 'yes' ? 'best' : 'worst'} you: ${p.when}${p.age != null ? `, ${p.age}` : ''}, ${p.mood}. ${p.snapshot}`);
  }
  samples.push(`   JUDGE: ${setup.opening.text}`);

  const plan: TopicTurn[] = [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }, { side: 'yes', cycle: 2 }, { side: 'no', cycle: 2 }];
  const base = { question, topic, personas: setup.personas, profile, cards };
  const first = await call<TopicResponse>(q, 'topic (pre-written)', '/api/trial/topic', { ...base, history: [], turns: plan, cutInAllowed: true, urgent: false }, TIMEOUTS.topic.server);
  // The user interrupts NO's first line.
  const cutAt = first.lines.findIndex((l) => l.speaker === 'defense');
  const said = first.lines.slice(0, cutAt + 1);
  said.forEach(show);
  const you: Line = { id: 'you', speaker: 'user', kind: 'user', text: c.interrupt, cites: [], topic_id: topic.id };
  show(you);
  const rewrite = await call<TopicResponse>(q, 'topic (interrupt)', '/api/trial/topic', {
    ...base,
    history: [...said, you],
    turns: [{ side: 'no', cycle: 1, answer: true }, { side: 'yes', cycle: 2 }, { side: 'no', cycle: 2 }, { side: 'yes', cycle: 3 }, { side: 'no', cycle: 3 }],
    userPoint: c.interrupt,
    cutInAllowed: !first.lines.some((l) => l.kind === 'cut_in'),
    urgent: true,
  }, TIMEOUTS.topicUrgent.server);
  rewrite.lines.forEach(show);
  samples.push(`   JUDGE (t=${rewrite.score.t.toFixed(2)}): ${rewrite.ruling.text}`);

  const scored = setup.topics.map((t) => (t.id === topic.id ? { ...t, status: 'done', score: rewrite.score } : t));
  const v = await call<VerdictResponse>(q, 'verdict', '/api/trial/verdict', { question, agenda: scored, userLines: [you] }, TIMEOUTS.verdict.server);
  samples.push(`   VERDICT ${v.verdict.spectrum.value} (${v.verdict.spectrum.label}): ${v.verdict.line.text}`);
}

async function main() {
  console.log(`Smoke test against ${BASE} (calls queue behind the 5/min rate limit, so this takes a few minutes)\n`);
  const t0 = Date.now();
  for (const [i, c] of CASES.entries()) {
    try {
      await run(i + 1, c);
    } catch (err) {
      console.error(`Q${i + 1} stopped: ${(err as Error).message}`);
    }
  }

  const steps = [...new Set(rows.map((r) => r.step))];
  console.log('step                  calls  median     max   budget  fell back');
  for (const step of steps) {
    const rs = rows.filter((r) => r.step === step);
    const ms = rs.map((r) => r.ms).sort((a, b) => a - b);
    const fb = rs.filter((r) => r.fallback);
    const timeouts = fb.filter((r) => r.ms >= r.budget * 0.9).length;
    const why = fb.length ? ` (${timeouts} timeout, ${fb.length - timeouts} error/no key)` : '';
    console.log(`${step.padEnd(21)} ${String(rs.length).padStart(5)} ${String(ms[Math.floor(ms.length / 2)]).padStart(7)}ms ${String(ms.at(-1)).padStart(6)}ms ${String(rs[0].budget).padStart(7)}  ${fb.length}/${rs.length}${why}`);
  }
  const llm = rows.filter((r) => r.step !== 'research');
  const rate = llm.filter((r) => r.fallback).length / Math.max(1, llm.length);
  console.log(`\nLLM calls: ${llm.length} in ${Math.round((Date.now() - t0) / 1000)}s · fell back: ${Math.round(rate * 100)}% (target < 10%)`);
  console.log('\nRead these aloud as a team: specific? in character? does the answer really address the interrupt?');
  console.log(samples.join('\n'));
}

main();
