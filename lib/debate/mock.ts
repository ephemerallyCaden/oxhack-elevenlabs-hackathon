// Deterministic stand-ins for every Claude/research call, built from the user's OWN question.
// Used when a key is missing or a call is slow — so the trial always runs, for any decision.
import type {
  EvidenceCard,
  JudgeInterruptRequest,
  JudgeInterruptResponse,
  LedgerEntry,
  Line,
  Personas,
  ProfileRequest,
  ProfileResponse,
  UserProfile,
  ResearchRequest,
  SetupRequest,
  SetupResponse,
  Topic,
  TopicRequest,
  TopicResponse,
  TopicTurn,
  VerdictRequest,
  VerdictResponse,
} from '@/types';
import { SIDE_SPEAKER } from '@/types';
import { computeSpectrum, ledgerBalance, normalise, orderAgenda } from './spectrum';
import { uid } from './fallback';
import { attachPunch, punchedSides } from './punch';

/** "Should I take a gap year?" → "take a gap year" */
export function actionOf(question: string): string {
  const a = question
    .trim()
    .replace(/[?.!]+$/, '')
    .replace(/^(so\s+|um+\s+|ok(ay)?\s+)*(should|shall|do|would|can)\s+i\s+(really\s+|just\s+)?/i, '')
    .trim();
  return a || 'do it';
}

const judge = (kind: Line['kind'], text: string, topic_id?: string): Line => ({ id: uid('line'), speaker: 'judge', kind, text, cites: [], topic_id });

function mockAgenda(question: string) {
  const act = actionOf(question);
  const raw: Topic[] = [
    { id: 'topic-cost', title: 'Cost and money', question: `What does it cost you to ${act}, and can you afford it?`, importance: 0.35, research_speed: 'quick', status: 'pending', added_by: 'judge' },
    { id: 'topic-happiness', title: 'Happiness', question: `Will you be happier if you ${act}?`, importance: 0.35, research_speed: 'quick', status: 'pending', added_by: 'judge' },
    { id: 'topic-long-term', title: 'Long-term consequences', question: `Where does choosing to ${act} leave you in five years?`, importance: 0.3, research_speed: 'deep', status: 'pending', added_by: 'judge' },
  ];
  const topics = orderAgenda(normalise(raw));
  const intros: Record<string, Line> = {};
  topics.forEach((t, i) => {
    intros[t.id] = judge('intro', `${i === 0 ? 'First' : i === topics.length - 1 ? 'Finally' : 'Next'}: ${t.title.toLowerCase()}. ${t.question} Prosecution, you may begin.`, t.id);
  });
  return {
    topics,
    opening: judge('opening', `Order! The question before this court: should you ${act}?`),
    intros,
  };
}

/** Form fields win over extracted ones; empty strings don't count. */
export function mergeProfile(extracted: UserProfile, form?: UserProfile): UserProfile {
  const out: UserProfile = { ...extracted };
  for (const [k, v] of Object.entries(form ?? {})) {
    if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** All the onboarding speech as one text. */
export function onboardingText(req: ProfileRequest): string {
  return [req.transcript ?? '', ...(req.answers ?? []).map((a) => a.transcript)].join(' ').replace(/\s+/g, ' ').trim();
}

/** Offline extraction: the facts people state plainly. Claude does the rest when it's available. */
export function mockProfile(req: ProfileRequest): ProfileResponse {
  const text = onboardingText(req);
  const p: UserProfile = {};
  const name = text.match(/\bmy name(?:'s| is)\s+([A-Z][a-z]+)/i)?.[1];
  if (name && !/^(not|a|the)$/i.test(name)) p.name = name[0].toUpperCase() + name.slice(1);
  const age = Number(text.match(/\b(\d{1,2})\s*(?:years?\s*old|yo)\b/i)?.[1] ?? text.match(/\bI(?:'m| am)\s+(\d{1,2})\b/i)?.[1]);
  if (age >= 10 && age <= 99) p.age = age;
  const place = text.match(/\b(?:live|living|based|from)\s+in\s+([A-Z][\w'-]+(?:\s+[A-Z][\w'-]+)?)/)?.[1];
  if (place) p.location = place;
  if (/\b(play it safe|plan everything|careful|cautious|overthink)/i.test(text)) p.risk_tolerance = 'cautious';
  else if (/\b(jump (?:straight )?in|go for it|risk[- ]taker|spontaneous|leap)/i.test(text)) p.risk_tolerance = 'bold';

  // "should I move to Berlin" / "whether to quit my job" → "Should I move to Berlin?"
  const ask = text.match(/\b(?:should I|whether (?:or not )?(?:I should |to )|deciding (?:whether )?to )\s*([^.?!]{4,120})/i)?.[1];
  const question = ask ? `Should I ${ask.trim().replace(/\s+(?:or not|and)$/i, '')}?` : undefined;

  return { profile: mergeProfile(p, req.form), question, fallback: true };
}

function mockPersonas(req: SetupRequest): Personas {
  const act = actionOf(req.question);
  const age = req.profile?.age;
  const at = (years: number) => (age != null ? Math.round(age + years) : undefined);
  return {
      yes: {
        side: 'yes', years_from_now: 1, when: '1 year from now', age: at(1), mood: 'thriving',
        snapshot: `A year after deciding to ${act}, things are going well. The early doubts have faded and the choice feels like it was made for the right reasons.`,
      },
      no: {
        side: 'no', years_from_now: 4, when: '4 years from now', age: at(4), mood: 'worn down',
        snapshot: `Four years after deciding to ${act}, the costs have piled up. Some of the things that were given up turned out to matter more than expected.`,
      },
  };
}

/** The cut-scene in one go: agenda + Judge lines + both future selves. */
export function mockSetup(req: SetupRequest): SetupResponse {
  return { ...mockAgenda(req.question), personas: mockPersonas(req), fallback: true };
}

export function mockCards(req: ResearchRequest): EvidenceCard[] {
  const lean = req.side === 'yes' ? 'in favour of it' : 'against it';
  return [1, 2].map((i) => ({
    id: uid('card'),
    topic_id: req.topic.id,
    side: req.side,
    claim: `point ${i} ${lean}`,
    evidence: `[No data yet: research agent not connected for "${req.topic.title}"]`,
    source_name: 'MOCK (research not connected)',
    source_url: '',
    strength: 2,
    tier: req.tier,
  }));
}

const OPENERS = {
  yes: ['Your Honour, consider this.', 'With respect, the defense is missing the bigger picture.', 'Let me be absolutely clear.'],
  no: ['Objection to the optimism.', 'An inspiring speech. Unfortunately, reality disagrees.', 'Allow me to bring us back to earth.'],
};

/** One line for one planned turn. */
function mockLine(req: TopicRequest, turn: TopicTurn, cut: boolean): Line {
  const own = req.cards.filter((c) => c.side === turn.side);
  const card = own[(turn.cycle - 1) % Math.max(1, own.length)];
  const point = card ? card.claim : `the evidence ${turn.side === 'yes' ? 'favours' : 'argues against'} it`;
  const opener = OPENERS[turn.side][(turn.cycle - 1) % 3];
  const persona = req.personas?.[turn.side];
  const topic = req.topic.title.toLowerCase();
  const text = turn.answer
    ? `You say "${req.userPoint ?? ''}". A fair point, and I'll answer it: ${point.toLowerCase()}.`
    : cut
      ? `${opener} On ${topic}, the best case is simply—`
      : turn.cycle === 1 && persona
        ? `It's ${persona.when}, and here's what I know about ${topic}: ${point.toLowerCase()}.`
        : `${opener} On ${topic}: ${point.toLowerCase()}.`;
  return { id: uid('line'), speaker: SIDE_SPEAKER[turn.side], kind: turn.answer ? 'answer' : 'argument', text, cites: card ? [card.id] : [], topic_id: req.topic.id, cycle: turn.cycle };
}

function mockLedgerEntry(topicId: string, line: Line): LedgerEntry {
  const supports = line.speaker === 'prosecution' ? 'yes' : line.speaker === 'defense' ? 'no' : 'neutral';
  // Deterministic 2-4 from the text, so offline trials don't always land on a dead-even toss-up.
  const strength = 2 + ([...line.text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 3);
  return { id: uid('ledger'), line_id: line.id, topic_id: topicId, by: line.speaker, supports, claim: line.text.slice(0, 140), strength, card_ids: line.cites };
}

/** A whole planned exchange + its tally + the Judge's ruling. Offline, YES gets cut off once (cycle 2). */
const MOCK_PUNCH = {
  yes: { text: 'everything.', tts: '[passionate] every... thing.' },
  no: { text: 'absolutely nothing.', tts: '[concerned] absolutely... nothing.' },
};

export function mockTopic(req: TopicRequest): TopicResponse {
  const lines: Line[] = [];
  let cutUsed = !req.cutInAllowed;
  const punched = punchedSides(req.history, req.topic.id);
  for (const turn of req.turns) {
    const cut = !cutUsed && !turn.answer && turn.side === 'yes' && turn.cycle === 2;
    const line = mockLine(req, turn, cut);
    // Offline trials exercise the punch shot: YES lands one on its opening line, NO on its second.
    if (!cut && !turn.answer && ((turn.side === 'yes' && turn.cycle === 1) || (turn.side === 'no' && turn.cycle === 2))) {
      line.text = line.text.replace(/\.$/, ' — and that changes');
      attachPunch(line, MOCK_PUNCH[turn.side], punched);
    }
    lines.push(line);
    if (cut) {
      cutUsed = true;
      const base = { topic_id: req.topic.id, cycle: turn.cycle, cites: [] as string[] };
      lines.push(
        { ...base, id: uid('line'), speaker: 'defense', kind: 'cut_in', text: "Hold on! That's the best case, not the likely one." },
        { ...base, id: uid('line'), speaker: 'prosecution', kind: 'resume', text: "Then let's talk likely: the evidence still favours it." },
      );
    }
  }
  const said = [...req.history, ...lines].filter((l) => l.speaker !== 'judge');
  const ledger = said.map((l) => mockLedgerEntry(req.topic.id, l));
  const t = ledgerBalance(ledger);
  const way = t > 0.15 ? 'leans yes' : t < -0.15 ? 'leans no' : 'is evenly balanced';
  const best = [...ledger].sort((a, b) => b.strength - a.strength)[0];
  return {
    lines,
    // This exchange's lines, plus the witness's point it was written around (like line_index -1 live).
    ledger: ledger.filter((e) => lines.some((l) => l.id === e.line_id) || (req.userPoint && e.line_id === [...req.history].reverse().find((l) => l.speaker === 'user')?.id)),
    score: { t, confidence: 0.4, reasoning: `On ${req.topic.title.toLowerCase()}, the court ${way}.`, deciding_argument: best?.claim ?? 'No decisive argument.' },
    ruling: judge('score', `Hmm. On ${req.topic.title.toLowerCase()}, the court ${way}.`, req.topic.id),
    fallback: true,
  };
}

const REMOVE = /\b(don'?t care|doesn'?t matter|not important|irrelevant|remove|skip|forget|drop)\b/i;

export function mockJudgeInterrupt(req: JudgeInterruptRequest): JudgeInterruptResponse {
  const live = req.agenda.filter((t) => t.status !== 'removed' && t.status !== 'done');
  if (REMOVE.test(req.text) && live.length > 1) {
    const words = req.text.toLowerCase().split(/\W+/);
    const target = live.find((t) => t.title.toLowerCase().split(/\W+/).some((w) => w.length > 3 && words.includes(w))) ?? live[live.length - 1];
    return { action: 'remove', remove_id: target.id, line: judge('agenda_change', `Very well. The court strikes "${target.title}" from the agenda.`), fallback: true };
  }
  const title = req.text.replace(/[^\w\s']/g, '').split(/\s+/).slice(0, 5).join(' ') || 'The witness’s point';
  const topic: Topic = { id: uid('topic'), title, question: `How much does this matter: "${req.text}"?`, importance: 0.2, research_speed: 'quick', status: 'pending', added_by: 'user' };
  return { action: 'add', topic, line: judge('agenda_change', `Noted. The court adds "${title}" to the agenda.`, topic.id), fallback: true };
}

export function mockVerdict(req: VerdictRequest): VerdictResponse {
  const spectrum = computeSpectrum(req.agenda);
  const scored = req.agenda.filter((t) => t.status !== 'removed' && t.score);
  const top = [...scored].sort((a, b) => b.importance * Math.abs(b.score!.t) - a.importance * Math.abs(a.score!.t))[0];
  const explanation = top
    ? `The deciding matter was ${top.title.toLowerCase()} (${Math.round(top.importance * 100)}% of the weight). ${top.score!.reasoning}`
    : 'The court heard too little to lean either way.';
  const text = `The court has reached its verdict: ${spectrum.label.toLowerCase()}, at ${spectrum.value > 0 ? '+' : ''}${spectrum.value}. ${explanation}`;
  return {
    verdict: {
      spectrum,
      explanation,
      breakdown: scored.map((t) => ({ topic_id: t.id, title: t.title, weight: t.importance, t: t.score!.t, deciding_argument: t.score!.deciding_argument, added_by: t.added_by })),
      line: judge('verdict', text),
    },
    fallback: true,
  };
}

