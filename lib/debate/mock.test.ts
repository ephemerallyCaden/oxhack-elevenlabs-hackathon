import { describe, expect, it } from 'vitest';
import type { Topic, TopicTurn } from '@/types';
import { mockSetup, mockTopic } from './mock';
import { MAX_TOPICS } from './spectrum';

const topic: Topic = { id: 'topic-cost', title: 'Cost', question: 'Can you afford it?', importance: 1, research_speed: 'quick', status: 'pending', added_by: 'judge' };
const turns: TopicTurn[] = [
  { side: 'yes', cycle: 1 },
  { side: 'no', cycle: 1 },
];

describe('mock trial (the offline / fallback path)', () => {
  it('keeps the agenda to the same cap as the live trial', () => {
    const out = mockSetup({ question: 'Should I quit my job to play poker?' });
    expect(out.topics.length).toBeLessThanOrEqual(MAX_TOPICS);
    expect(out.topics.reduce((a, t) => a + t.importance, 0)).toBeCloseTo(1);
  });

  it('lands one punch on a fresh topic, as a full sentence', () => {
    const { lines } = mockTopic({ question: 'Should I?', topic, cards: [], history: [], turns, cutInAllowed: false, urgent: false });
    const punched = lines.filter((l) => l.punch);
    expect(punched).toHaveLength(1);
    expect(punched[0].text.endsWith(punched[0].punch!.text)).toBe(true);
  });

  it('never leaves a dangling "and that changes" when the topic already had its punch', () => {
    const earlier = { id: 'x', speaker: 'prosecution' as const, kind: 'argument' as const, text: 'a b', cites: [], topic_id: topic.id, punch: { text: 'b' } };
    const { lines } = mockTopic({ question: 'Should I?', topic, cards: [], history: [earlier], turns, cutInAllowed: false, urgent: false });
    expect(lines.some((l) => l.punch)).toBe(false);
    for (const l of lines) expect(l.text).not.toMatch(/and that changes$/);
  });
});
