import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/types';
import { planAfterInterrupt, TrialOrchestrator, type TrialState } from './orchestrator';
import { computeSpectrum } from './spectrum';
import { mockSetup, mockTopic } from './mock';

// Offline: every API call fails, so the whole trial runs on the decision-aware mocks.
vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => {
  vi.clearAllTimers();
  vi.unstubAllEnvs();
});

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
    vi.stubEnv('NEXT_PUBLIC_RESEARCH', 'on'); // research is off by default for the demo; this trial covers it
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

  it('the verdict is delivered on the wide shot, so both sides are in view', async () => {
    let scene: string | undefined;
    await play('Should I buy a car?', (st) => {
      if (st.current?.kind === 'verdict') scene = st.scene;
      return undefined;
    });
    expect(scene).toBe('witness');
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

describe('request size', () => {
  it("voiced lines keep their audio on screen, but it isn't uploaded with the topic history", async () => {
    const audio = 'data:audio/mpeg;base64,AAAA';
    const topicBodies: { history: { audioUrl?: string; punch?: { audioUrl?: string } }[] }[] = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      if (url === '/api/voice/tts') return Promise.resolve({ ok: true, json: async () => ({ audioUrl: audio, durationMs: 1000 }) });
      if (url === '/api/trial/topic') topicBodies.push(JSON.parse(init!.body!));
      return Promise.reject(new Error('offline'));
    });
    try {
      let done = false;
      // Interrupt mid-topic so the rewrite sends a history of already-voiced lines.
      const s = await play('Should I learn to surf?', (st) => {
        if (!done && st.current?.speaker === 'defense' && st.current.kind === 'argument') {
          done = true;
          return 'But I live by the sea';
        }
      });
      expect(s.transcript.some((l) => l.audioUrl === audio)).toBe(true);
      const sent = topicBodies.flatMap((b) => b.history);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((l) => l.audioUrl === undefined && l.punch?.audioUrl === undefined)).toBe(true);
    } finally {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  });
});

describe('planAfterInterrupt', () => {
  const order = (turns: { side: string; answer?: boolean }[]) => turns.map((t) => t.side);

  it('interrupting YES in cycle 1: YES answers, then NO, YES, NO… until NO closes the last cycle', () => {
    const turns = planAfterInterrupt('yes', 1, 3);
    expect(turns[0]).toEqual({ side: 'yes', cycle: 1, answer: true });
    expect(order(turns)).toEqual(['yes', 'no', 'yes', 'no', 'yes', 'no']);
    expect(turns.at(-1)).toEqual({ side: 'no', cycle: 3 });
  });

  it("interrupting NO's cut-in on YES's line: NO answers, then YES (never NO twice)", () => {
    const turns = planAfterInterrupt('no', 2, 3);
    expect(order(turns)).toEqual(['no', 'yes', 'no']);
    expect(turns.at(-1)).toEqual({ side: 'no', cycle: 3 });
  });

  it('turns always alternate, whichever side and cycle is interrupted', () => {
    for (const side of ['yes', 'no'] as const)
      for (let cycle = 1; cycle <= 4; cycle++) {
        const sides = order(planAfterInterrupt(side, cycle, cycle + 1));
        sides.slice(1).forEach((s, k) => expect(s).not.toBe(sides[k]));
      }
  });
});

describe('fixes from the PR #79 review', () => {
  /** Speakers on a topic in order, including the user. */
  const speakers = (s: TrialState, topicId: string) =>
    s.transcript.filter((l) => l.topic_id === topicId && l.kind !== 'intro' && l.kind !== 'score').map((l) => l.speaker);

  it('interrupting a cut-in: the cut-in side answers, and nobody speaks twice in a row', async () => {
    let done = false;
    const s = await play('Should I start a podcast?', (st) => {
      if (!done && st.current?.kind === 'cut_in') {
        done = true;
        return "But I've already bought the microphone";
      }
    });
    const user = s.transcript.find((l) => l.speaker === 'user')!;
    const after = s.transcript[s.transcript.indexOf(user) + 1];
    expect(after).toMatchObject({ speaker: 'defense', kind: 'answer' });
    const order = speakers(s, user.topic_id!);
    order.slice(1).forEach((who, k) => expect(who, order.join(' → ')).not.toBe(order[k]));
  });

  it("after an agenda change, the next topic's call starts before its intro has finished (no waiting)", async () => {
    const events: string[] = [];
    // The mock agenda stops at MAX_TOPICS (2); this scenario needs a third topic to move on to, so the
    // setup call answers with the mock agenda plus one more topic (the orchestrator takes any length).
    const base = mockSetup({ question: 'Should I learn to sail?' });
    const extra = { ...base.topics[base.topics.length - 1], id: 'topic-extra', title: 'Long-term consequences' };
    const setup = {
      ...base,
      topics: [...base.topics, extra],
      intros: { ...base.intros, [extra.id]: { ...base.intros[base.topics[base.topics.length - 1].id], id: 'intro-extra', topic_id: extra.id } },
      fallback: false,
    };
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      if (String(url) === '/api/trial/setup') return Promise.resolve(new Response(JSON.stringify(setup), { headers: { 'Content-Type': 'application/json' } }));
      if (String(url) === '/api/trial/topic') {
        const req = JSON.parse(init?.body ?? '{}');
        events.push(`call:${req.topic?.id}`);
        // A live court's topics are written (a live court never plays a failed topic's mock lines).
        return Promise.resolve(new Response(JSON.stringify({ ...mockTopic(req), fallback: false }), { headers: { 'Content-Type': 'application/json' } }));
      }
      return Promise.reject(new Error('offline'));
    });
    try {
      let done = false;
      const s = await play('Should I learn to sail?', (st) => {
        if (st.current) events.push(`line:${st.current.kind}:${st.current.topic_id ?? ''}`);
        // Remove the 2nd topic while the 1st topic's ruling plays: the 3rd must be written right away.
        if (!done && st.current?.kind === 'score') {
          done = true;
          return "honestly I don't care about happiness here";
        }
      });
      // The call for what is now next starts while the Judge is still confirming the change,
      // i.e. before the confirmation line plays, not when the topic's intro starts.
      const third = s.agenda.filter((t) => t.status === 'done').at(-1)!;
      const call = events.indexOf(`call:${third.id}`);
      const confirmation = events.findIndex((e) => e.startsWith('line:agenda_change'));
      expect(call).toBeGreaterThanOrEqual(0);
      expect(confirmation).toBeGreaterThan(0);
      expect(call).toBeLessThan(confirmation);
      expect(s.agenda.some((t) => t.status === 'removed')).toBe(true);
    } finally {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  });

  it('two interrupts on one topic: each of your points is in the tally exactly once', async () => {
    let n = 0;
    const s = await play('Should I get a tattoo?', (st) => {
      if (n < 2 && st.current?.kind === 'argument' && st.agenda[0]?.id === st.activeTopicId) {
        n++;
        return n === 1 ? 'I have wanted one for years' : 'My job is fine with tattoos';
      }
    });
    const userIds = s.transcript.filter((l) => l.speaker === 'user').map((l) => l.id);
    expect(userIds).toHaveLength(2);
    for (const id of userIds) expect(s.ledger.filter((e) => e.line_id === id)).toHaveLength(1);
    const ids = s.ledger.map((e) => e.line_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('surprise punches', () => {
  it('offline trials land at most one punch per side per topic, as setup + punch', async () => {
    const s = await play('Should I take a gap year before university?');
    const punches = s.transcript.filter((l) => l.punch);
    expect(punches.length).toBeGreaterThan(0);
    for (const t of s.agenda) {
      const mine = punches.filter((l) => l.topic_id === t.id);
      expect(mine.filter((l) => l.speaker === 'prosecution').length).toBeLessThanOrEqual(1);
      expect(mine.filter((l) => l.speaker === 'defense').length).toBeLessThanOrEqual(1);
    }
    for (const l of punches) {
      expect(['prosecution', 'defense']).toContain(l.speaker);
      expect(l.text.endsWith(l.punch!.text)).toBe(true);
      expect(l.durationMs).toBeGreaterThan(0); // setup clip (estimated offline)
      expect(l.punch!.durationMs).toBeGreaterThan(0); // punch clip
    }
  });

  it('voices setup and punch as two clips, the punch with the hotter (less stable) settings', async () => {
    const calls: { text: string; speaker: string; voiceSettings?: { stability: number } }[] = [];
    vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
      if (url !== '/api/voice/tts') return Promise.reject(new Error('offline'));
      const body = JSON.parse(init.body as string);
      calls.push(body);
      const audioUrl = `blob:${calls.length}`;
      return Promise.resolve({ ok: true, json: async () => ({ audioUrl, durationMs: 1000, fallback: false }) });
    });
    try {
      const s = await play('Should I take a gap year before university?');
      const line = s.transcript.find((l) => l.punch)!;
      expect(line.audioUrl).toBeTruthy();
      expect(line.punch!.audioUrl).toBeTruthy();
      expect(line.punch!.audioUrl).not.toBe(line.audioUrl);
      const punchCall = calls.find((c) => c.text === line.punch!.tts)!;
      expect(punchCall.voiceSettings!.stability).toBe(line.speaker === 'prosecution' ? 0.3 : 0.4);
      expect(calls.find((c) => c.text === line.punch!.tts && !c.voiceSettings)).toBeUndefined();
    } finally {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  });
});

describe('stop(): a replaced trial goes quiet', () => {
  it('makes no more API calls and sends no more updates once stopped', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      calls.push(String(url));
      return Promise.reject(new Error('offline'));
    });
    try {
      const orch = new TrialOrchestrator({});
      let updates = 0;
      orch.subscribe(() => updates++);
      orch.start('Should I learn to sail?');
      await new Promise((r) => setTimeout(r, 0));
      orch.stop();
      const [nCalls, nUpdates] = [calls.length, updates];
      await new Promise((r) => setTimeout(r, 200));
      expect(calls.length).toBe(nCalls);
      expect(updates).toBe(nUpdates);
    } finally {
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  });

  it('a stopped trial waiting on a line unwinds: start() resolves', async () => {
    const orch = new TrialOrchestrator({});
    let speaking = false;
    orch.subscribe(() => (speaking ||= orch.getState().phase === 'speaking'));
    const run = orch.start('Should I learn to sail?');
    await vi.waitFor(() => expect(speaking).toBe(true), { timeout: 3000 });
    orch.stop();
    await expect(Promise.race([run, new Promise((_, r) => setTimeout(() => r(new Error('still running')), 1000))])).resolves.toBeUndefined();
  });

  it('stopped while setup is still in flight: aborts it, no crash, no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    let aborted = false;
    vi.stubGlobal('fetch', (url: string, init?: { signal?: AbortSignal }) => {
      if (String(url) !== '/api/trial/setup') return Promise.reject(new Error('offline'));
      return new Promise((_, reject) => init?.signal?.addEventListener('abort', () => ((aborted = true), reject(new DOMException('aborted', 'AbortError')))));
    });
    try {
      const orch = new TrialOrchestrator({});
      const run = orch.start('Should I learn to sail?');
      await new Promise((r) => setTimeout(r, 20));
      orch.stop();
      await Promise.race([run, new Promise((_, r) => setTimeout(() => r(new Error('still running')), 2000))]);
      await new Promise((r) => setTimeout(r, 50));
      expect(aborted).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    }
  });

  it('stopped while the user is interrupting: the wait for their words is released', async () => {
    const orch = new TrialOrchestrator({});
    let speaking = false;
    orch.subscribe(() => (speaking ||= orch.getState().phase === 'speaking'));
    const run = orch.start('Should I learn to sail?');
    await vi.waitFor(() => expect(speaking).toBe(true), { timeout: 3000 });
    orch.beginInterrupt();
    orch.stop();
    await expect(Promise.race([run, new Promise((_, r) => setTimeout(() => r(new Error('still running')), 1000))])).resolves.toBeUndefined();
  });

  it('a stopped trial never starts', async () => {
    const orch = new TrialOrchestrator({});
    orch.stop();
    await orch.start('Should I learn to sail?');
    expect(orch.getState().phase).toBe('ask');
  });
});
