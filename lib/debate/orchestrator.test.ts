import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/types';
import { TrialOrchestrator, type TrialState } from './orchestrator';
import { computeSpectrum } from './spectrum';

// Offline: every API call fails, so the whole trial runs on the decision-aware mocks.
vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => vi.clearAllTimers());

type Plan = (s: TrialState, orch: TrialOrchestrator) => string | null | undefined;

/** Plays the trial like the UI would: ends every line, and fires interrupts from `plan`. */
function play(question: string, plan: Plan = () => undefined, profile?: UserProfile): Promise<TrialState> {
  const orch = new TrialOrchestrator({ profile });
  let lastId = '';
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`stuck in phase ${orch.getState().phase}`)), 4000);
    orch.subscribe(() => {
      const s = orch.getState();
      if (s.phase === 'done') {
        clearTimeout(timer);
        return resolve(s);
      }
      if (s.phase !== 'speaking' || !s.current || s.current.id === lastId) return;
      const line = s.current;
      lastId = line.id;
      const say = plan(s, orch);
      setTimeout(() => {
        if (say !== undefined && orch.beginInterrupt()) setTimeout(() => orch.endInterrupt(say), 0);
        else orch.lineEnded(line.id);
      }, 0);
    });
    orch.start(question);
  });
}

describe('TrialOrchestrator', () => {
  it('runs a full trial for any question: agenda → debate per topic → scores → verdict → transcript', async () => {
    const s = await play('Should I take a gap year before university?');
    const live = s.agenda.filter((t) => t.status !== 'removed');
    expect(live.length).toBeGreaterThan(0);
    expect(live.every((t) => t.status === 'done' && t.score)).toBe(true);

    // Every topic: intro, then YES/NO alternating for 2 cycles (no interrupts here), then the Judge's score.
    for (const t of live) {
      const args = s.transcript.filter((l) => l.topic_id === t.id && l.kind === 'argument');
      expect(args.length).toBe(4);
      expect(args[0].speaker).toBe('prosecution');
      expect(s.transcript.some((l) => l.topic_id === t.id && l.kind === 'score')).toBe(true);
    }

    // Nothing about the question leaks from a fixed example.
    expect(s.transcript[0].text.toLowerCase()).toContain('gap year');
    expect(JSON.stringify(s.transcript).toLowerCase()).not.toContain('poker');

    expect(s.verdict?.spectrum).toEqual(computeSpectrum(s.agenda));
    expect(s.result?.lines.at(-1)?.kind).toBe('verdict');
    expect(s.result?.sources.length).toBeGreaterThan(0);
  });

  /** Speakers on a topic in order, including the user (YES → you → YES answering you is fine). */
  const sides = (s: TrialState, topicId: string) =>
    s.transcript.filter((l) => l.topic_id === topicId && l.kind !== 'intro' && l.kind !== 'score').map((l) => l.speaker);

  it('casts best (YES) and worst (NO) future you from the profile, and each argues from its own moment', async () => {
    const s = await play('Should I take a gap year?', undefined, { age: 18, situation: 'finishing sixth form', location: 'Leeds' });
    expect(s.profile?.age).toBe(18);
    const { yes, no } = s.personas!;
    expect(yes.side).toBe('yes');
    expect(no.side).toBe('no');
    // Ages follow the user's age + how far in the future each self is.
    expect(yes.age).toBe(Math.round(18 + yes.years_from_now));
    expect(no.age).toBe(Math.round(18 + no.years_from_now));
    expect(yes.snapshot.length).toBeGreaterThan(20);

    // Each side's first line on a topic speaks from its own moment in time.
    const first = s.agenda.find((t) => t.status === 'done')!;
    const opening = (who: string) => s.transcript.find((l) => l.topic_id === first.id && l.speaker === who && l.kind === 'argument')!;
    expect(opening('prosecution').text).toContain(yes.when);
    expect(opening('defense').text).toContain(no.when);
  });

  it('works without a profile: personas exist, ages are unknown', async () => {
    const s = await play('Should I buy a bike?');
    expect(s.personas?.yes.age).toBeUndefined();
    expect(s.personas?.no.when).toBeTruthy();
  });

  it('interrupting a side: that side answers the user first, the other side replies next, and the topic gets one more cycle', async () => {
    let done = false;
    const s = await play('Should I move to Berlin?', (st) => {
      if (!done && st.current?.speaker === 'defense' && st.current.kind === 'argument') {
        done = true;
        return 'But I already speak German';
      }
    });
    const i = s.transcript.findIndex((l) => l.speaker === 'user');
    expect(i).toBeGreaterThan(0);
    const after = s.transcript.slice(i + 1, i + 3);
    expect(after[0]).toMatchObject({ speaker: 'defense', kind: 'answer' });
    expect(after[0].text).toContain('I already speak German');
    expect(after[1]).toMatchObject({ speaker: 'prosecution', kind: 'argument' });

    const topicId = s.transcript[i].topic_id!;
    const regular = s.transcript.filter((l) => l.topic_id === topicId && l.kind === 'argument');
    expect(regular.length).toBe(6); // 2 cycles + 1 added by the interrupt
    expect(Math.max(...regular.map((l) => l.cycle ?? 0))).toBe(3);
    expect(s.ledger.some((e) => e.line_id === s.transcript[i].id)).toBe(true);
  });

  it.each(['prosecution', 'defense'] as const)('after interrupting %s, nobody speaks twice in a row', async (target) => {
    let done = false;
    const s = await play('Should I adopt a dog?', (st) => {
      if (!done && st.current?.speaker === target && st.current.kind === 'argument') {
        done = true;
        return 'What about my small flat?';
      }
    });
    const topicId = s.transcript.find((l) => l.speaker === 'user')!.topic_id!;
    const order = sides(s, topicId);
    order.slice(1).forEach((who, k) => expect(who, `turn ${k + 2}: ${order.join(' → ')}`).not.toBe(order[k]));
  });

  it("interrupting the topic's last turn still gets a reply from the other side", async () => {
    let args = 0;
    let done = false;
    const s = await play('Should I learn to code?', (st) => {
      if (st.current?.kind === 'argument' && st.agenda[0]?.id === st.activeTopicId) args++;
      if (!done && args === 4 && st.current?.kind === 'argument') {
        done = true;
        return 'I only have weekends free';
      }
    });
    const i = s.transcript.findIndex((l) => l.speaker === 'user');
    expect(s.transcript[i + 1]).toMatchObject({ speaker: 'defense', kind: 'answer' });
    expect(s.transcript[i + 2]).toMatchObject({ speaker: 'prosecution' });
  });

  it('two interrupts on one topic add two cycles', async () => {
    let n = 0;
    const s = await play('Should I learn Japanese?', (st) => {
      if (n < 2 && st.current?.kind === 'argument' && st.agenda[0]?.id === st.activeTopicId) {
        n++;
        return n === 1 ? 'It would help my career' : 'But I have no time';
      }
    });
    const first = s.agenda.find((t) => t.status === 'done')!;
    const args = s.transcript.filter((l) => l.topic_id === first.id && l.kind === 'argument');
    expect(args.length).toBe(8);
  });

  it('an AI cut-in plays inside the turn and does not change the cycle count', async () => {
    const s = await play('Should I start running?');
    const topic = s.agenda.find((t) => t.status === 'done')!;
    const lines = s.transcript.filter((l) => l.topic_id === topic.id && l.speaker !== 'judge');
    const i = lines.findIndex((l) => l.kind === 'cut_in');
    expect(i).toBeGreaterThan(0);
    // YES is cut off mid-sentence → NO cuts in → YES resumes → NO's normal turn.
    expect(lines[i - 1]).toMatchObject({ speaker: 'prosecution', kind: 'argument' });
    expect(lines[i - 1].text.endsWith('—')).toBe(true);
    expect(lines[i]).toMatchObject({ speaker: 'defense' });
    expect(lines[i + 1]).toMatchObject({ speaker: 'prosecution', kind: 'resume' });
    expect(lines[i + 2]).toMatchObject({ speaker: 'defense', kind: 'argument' });
    expect(lines.filter((l) => l.kind === 'cut_in')).toHaveLength(1); // at most one per topic
    expect(lines.filter((l) => l.kind === 'argument')).toHaveLength(4);
  });

  it('a cut-in is dropped if the user interrupts the line it would cut into', async () => {
    let done = false;
    const s = await play('Should I sell my car?', (st) => {
      if (!done && st.current?.text.endsWith('—')) {
        done = true;
        return 'Wait, I need it for work';
      }
    });
    const i = s.transcript.findIndex((l) => l.speaker === 'user');
    expect(s.transcript[i + 1]).toMatchObject({ speaker: 'prosecution', kind: 'answer' });
    const topicId = s.transcript[i].topic_id!;
    expect(s.transcript.some((l) => l.topic_id === topicId && l.kind === 'cut_in')).toBe(false);
  });

  it('cannot interrupt a line that has already finished (nothing would pick the interrupt up)', async () => {
    const orch = new TrialOrchestrator();
    let refused = 0;
    await new Promise<void>((resolve) => {
      let last = '';
      orch.subscribe(() => {
        const s = orch.getState();
        if (s.phase === 'done') return resolve();
        if (s.phase !== 'speaking' || !s.current || s.current.id === last) return;
        last = s.current.id;
        const id = s.current.id;
        setTimeout(() => {
          orch.lineEnded(id);
          if (orch.beginInterrupt() === null) refused++;
        }, 0);
      });
      orch.start('Should I run a marathon?');
    });
    expect(refused).toBeGreaterThan(0);
    expect(orch.getState().transcript.some((l) => l.speaker === 'user')).toBe(false);
  });

  it('ignores a second start() while a trial is running', async () => {
    const orch = new TrialOrchestrator();
    orch.subscribe(() => {
      const s = orch.getState();
      if (s.phase === 'speaking' && s.current) {
        const id = s.current.id;
        setTimeout(() => orch.lineEnded(id), 0);
      }
    });
    const first = orch.start('Should I paint my room blue?');
    orch.start('Should I paint my room red?');
    await first;
    const s = orch.getState();
    expect(s.question).toBe('Should I paint my room blue?');
    expect(s.transcript.filter((l) => l.kind === 'opening')).toHaveLength(1);
  });

  it('interrupting the Judge changes the agenda: adds a weighted topic that then gets debated', async () => {
    let done = false;
    const s = await play('Should I quit my job to start a bakery?', (st) => {
      if (!done && st.current?.kind === 'opening') {
        done = true;
        return 'You forgot my family, they rely on my salary';
      }
    });
    const added = s.agenda.find((t) => t.added_by === 'user');
    expect(added).toBeDefined();
    expect(added!.status).toBe('done');
    const total = s.agenda.filter((t) => t.status !== 'removed').reduce((a, t) => a + t.importance, 0);
    expect(total).toBeCloseTo(1);
    expect(s.transcript.some((l) => l.kind === 'agenda_change')).toBe(true);
    expect(s.verdict!.breakdown.some((b) => b.added_by === 'user')).toBe(true);
  });

  it('interrupting the Judge can remove a topic, which is then never debated', async () => {
    let done = false;
    const s = await play('Should I buy a car?', (st) => {
      if (!done && st.current?.kind === 'opening') {
        done = true;
        return "Honestly I don't care about happiness here";
      }
    });
    const removed = s.agenda.find((t) => t.status === 'removed');
    expect(removed?.title).toBe('Happiness');
    expect(s.transcript.some((l) => l.topic_id === removed!.id && l.kind === 'argument')).toBe(false);
  });

  it('a cancelled interrupt just carries on', async () => {
    let done = false;
    const s = await play('Should I learn the piano?', (st) => {
      if (!done && st.current?.speaker === 'prosecution') {
        done = true;
        return null;
      }
    });
    expect(s.phase).toBe('done');
    expect(s.transcript.some((l) => l.speaker === 'user')).toBe(false);
  });
});

describe('LLM call budget (Gemini free tier: 5 calls/minute)', () => {
  /** Runs a trial with fetch recording every LLM route it hits (all calls still fail → mocks). */
  async function countCalls(plan?: Plan) {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).startsWith('/api/trial/')) calls.push(String(url).replace('/api/trial/', ''));
      return Promise.reject(new Error('offline'));
    });
    try {
      const s = await play('Should I learn to surf?', plan);
      return { calls, topics: s.agenda.filter((t) => t.status === 'done').length };
    } finally {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  }

  it('a whole trial is 1 setup + 1 call per topic + 1 verdict', async () => {
    const { calls, topics } = await countCalls();
    expect(calls.filter((c) => c === 'setup')).toHaveLength(1);
    expect(calls.filter((c) => c === 'topic')).toHaveLength(topics);
    expect(calls.filter((c) => c === 'verdict')).toHaveLength(1);
    expect(calls).toHaveLength(topics + 2); // nothing per line any more
  });

  it('a user interrupt of YES/NO costs exactly one more call', async () => {
    let done = false;
    const { calls, topics } = await countCalls((st) => {
      if (!done && st.current?.speaker === 'defense' && st.current.kind === 'argument') {
        done = true;
        return 'But I live by the sea';
      }
    });
    expect(calls.filter((c) => c === 'topic')).toHaveLength(topics + 1);
    expect(calls).toHaveLength(topics + 3);
  });
});
