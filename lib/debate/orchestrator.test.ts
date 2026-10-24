import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrialOrchestrator, type TrialState } from './orchestrator';
import { computeSpectrum } from './spectrum';

// Offline: every API call fails, so the whole trial runs on the decision-aware mocks.
vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
vi.spyOn(console, 'warn').mockImplementation(() => {});
afterEach(() => vi.clearAllTimers());

type Plan = (s: TrialState, orch: TrialOrchestrator) => string | null | undefined;

/** Plays the trial like the UI would: ends every line, and fires interrupts from `plan`. */
function play(question: string, plan: Plan = () => undefined): Promise<TrialState> {
  const orch = new TrialOrchestrator();
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

    // Every topic: intro, then YES/NO alternating for at most 3 cycles, then the Judge's score.
    for (const t of live) {
      const args = s.transcript.filter((l) => l.topic_id === t.id && l.kind === 'argument');
      expect(args.length).toBeGreaterThan(0);
      expect(args.length).toBeLessThanOrEqual(6);
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

  it('interrupting a side: that side answers the user first, the other side replies next, and no cycle is used up', async () => {
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
    expect(regular.length).toBe(6); // the full 3 cycles still happened
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
      if (!done && args === 6 && st.current?.kind === 'argument') {
        done = true;
        return 'I only have weekends free';
      }
    });
    const i = s.transcript.findIndex((l) => l.speaker === 'user');
    expect(s.transcript[i + 1]).toMatchObject({ speaker: 'defense', kind: 'answer' });
    expect(s.transcript[i + 2]).toMatchObject({ speaker: 'prosecution' });
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
