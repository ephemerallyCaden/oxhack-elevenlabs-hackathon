import { describe, expect, it } from 'vitest';
import type { Line, Side } from '@/types';
import { attachPunch, punchedSides, setupText } from './punch';

const line = (speaker: Line['speaker'], text: string, extra: Partial<Line> = {}): Line => ({
  id: Math.random().toString(36), speaker, kind: 'argument', text, cites: [], topic_id: 't1', ...extra,
});

describe('attachPunch', () => {
  it('joins setup + punch into the full sentence and keeps the setup recoverable', () => {
    const l = line('prosecution', 'The top one percent of players earn more than');
    expect(attachPunch(l, { text: 'every quant on Wall Street.', tts: '[passionate] every... quant... on Wall Street.' }, new Set())).toBe(true);
    expect(l.text).toBe('The top one percent of players earn more than every quant on Wall Street.');
    expect(l.punch?.text).toBe('every quant on Wall Street.');
    expect(setupText(l)).toBe('The top one percent of players earn more than');
  });

  it('allows one punch per topic, whichever side lands it first', () => {
    const used = new Set<Side>();
    expect(attachPunch(line('prosecution', 'a'), { text: 'one', tts: '' }, used)).toBe(true);
    expect(attachPunch(line('prosecution', 'b'), { text: 'two', tts: '' }, used)).toBe(false);
    expect(attachPunch(line('defense', 'c'), { text: 'three', tts: '' }, used)).toBe(false);
  });

  it('counts punches from earlier calls on the same topic, not other topics', () => {
    const history = [line('prosecution', 'x y', { punch: { text: 'y' } }), line('defense', 'p q', { topic_id: 't2', punch: { text: 'q' } })];
    expect([...punchedSides(history, 't1')]).toEqual(['yes']);
  });

  it('never punches the Judge, a cut-off line, an empty draft or a long tail', () => {
    expect(attachPunch(line('judge', 'Order'), { text: 'now.', tts: '' }, new Set())).toBe(false);
    expect(attachPunch(line('defense', 'And the median is —'), { text: 'nothing.', tts: '' }, new Set())).toBe(false);
    expect(attachPunch(line('defense', 'And'), { text: '  ', tts: '' }, new Set())).toBe(false);
    expect(attachPunch(line('defense', 'And'), { text: 'one two three four five six seven eight nine ten eleven', tts: '' }, new Set())).toBe(false);
  });

  it('gives the punch an intense opening tag from the speaker\'s verified palette', () => {
    const a = line('defense', 'The median takes home');
    attachPunch(a, { text: 'twelve thousand pounds.', tts: 'twelve thousand... pounds.' }, new Set());
    expect(a.punch?.tts).toBe('[concerned] twelve thousand... pounds.');
    const b = line('prosecution', 'More than');
    attachPunch(b, { text: 'every quant.', tts: '[shouting] every... quant.' }, new Set());
    expect(b.punch?.tts).toBe('[shouting] every... quant.');
    const c = line('prosecution', 'More than');
    attachPunch(c, { text: 'every quant.', tts: '[gasps] every quant.' }, new Set()); // not a prosecution tag
    expect(c.punch?.tts).toBe('[passionate] every quant.');
  });
});
