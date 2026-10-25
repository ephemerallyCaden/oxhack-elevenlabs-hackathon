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

  it('lets the defense land the punch on a fresh topic', () => {
    const l = line('defense', 'The median player earns');
    expect(attachPunch(l, { text: 'less than minimum wage.', tts: '[concerned] less than minimum wage.' }, new Set())).toBe(true);
    expect(l.punch?.text).toBe('less than minimum wage.');
  });

  it('puts a refused punch back on the line, so the sentence never stops short', () => {
    const used = new Set<Side>(['yes']);
    const l = line('defense', 'The median player earns', { tts: '[concerned] The median player earns' });
    expect(attachPunch(l, { text: 'less than minimum wage.', tts: '[concerned] less than... minimum wage.' }, used)).toBe(false);
    expect(l.text).toBe('The median player earns less than minimum wage.');
    expect(l.tts).toBe('[concerned] The median player earns less than... minimum wage.');
    expect(l.punch).toBeUndefined();
    const long = line('prosecution', 'It pays');
    expect(attachPunch(long, { text: 'one two three four five six seven eight nine ten eleven.', tts: '' }, new Set())).toBe(false);
    expect(long.text).toBe('It pays one two three four five six seven eight nine ten eleven.');
  });

  it('never says the punch twice when the model also left it in the text', () => {
    const refused = line('defense', 'The median earns less than minimum wage.', { tts: '[concerned] The median earns less than minimum wage.' });
    attachPunch(refused, { text: 'less than minimum wage.', tts: '[concerned] less than... minimum wage.' }, new Set<Side>(['yes']));
    expect(refused.text).toBe('The median earns less than minimum wage.');
    expect(refused.tts).toBe('[concerned] The median earns less than minimum wage.');
    const landed = line('prosecution', 'Top players earn more than every quant!');
    expect(attachPunch(landed, { text: 'every quant.', tts: '' }, new Set())).toBe(true);
    expect(landed.text).toBe('Top players earn more than every quant.');
    expect(setupText(landed)).toBe('Top players earn more than');
  });

  it('starts a new sentence after a full stop (capitalised, and the punch matches the text)', () => {
    const l = line('prosecution', 'Think about it.');
    expect(attachPunch(l, { text: 'you win big.', tts: '' }, new Set())).toBe(true);
    expect(l.text).toBe('Think about it. You win big.');
    expect(l.punch?.text).toBe('You win big.');
    expect(setupText(l)).toBe('Think about it.');
  });

  it('counts words the same way on both sides: numbers, contractions, hyphens', () => {
    for (const [text, punch, setup] of [
      ['The bill comes to £12,000.', '£12,000.', 'The bill comes to'],
      ['And you just cannot afford it.', "can't afford it.", 'And you just cannot afford it.'],
      ['This is a life-changing move.', 'life-changing move.', 'This is a'],
      ["Face it, you just can't afford it.", "can't afford it.", 'Face it, you just'],
    ]) {
      const l = line('prosecution', text);
      attachPunch(l, { text: punch, tts: '' }, new Set());
      if (l.punch) expect(setupText(l)).toBe(setup);
      else expect(l.text).toBe(`${text} ${punch}`); // different words: appended, never a word lost
    }
  });

  it('never voices the punch in the setup clip too', () => {
    const l = line('defense', 'The median earns less than minimum wage.', { tts: '[concerned] The median earns less than minimum wage.' });
    expect(attachPunch(l, { text: 'less than minimum wage.', tts: '[concerned] less than... minimum wage.' }, new Set())).toBe(true);
    expect(l.tts).toBe('[concerned] The median earns');
    expect(setupText(l)).toBe('The median earns');
  });

  it('keeps a whole-line punch as a plain line (no empty setup beat)', () => {
    const l = line('prosecution', 'Everything.');
    expect(attachPunch(l, { text: 'Everything.', tts: '' }, new Set())).toBe(false);
    expect(l.text).toBe('Everything.');
    expect(l.punch).toBeUndefined();
  });

  it('cuts the punch out of the setup clip in its spoken form too (numbers written out)', () => {
    const l = line('defense', 'Four years on, my rent is', { tts: '[sighs] Four years on, my rent is two thousand pounds a month.' });
    expect(attachPunch(l, { text: '£2,000 a month.', tts: '[concerned] two thousand... pounds... a month.' }, new Set())).toBe(true);
    expect(l.tts).toBe('[sighs] Four years on, my rent is');
    expect(l.text).toBe('Four years on, my rent is £2,000 a month.');
  });

  it('never repeats words the text already says of the punch (a partial overlap)', () => {
    const l = line('prosecution', 'They earn more than every quant');
    expect(attachPunch(l, { text: 'every quant on Wall Street.', tts: '' }, new Set())).toBe(true);
    expect(l.text).toBe('They earn more than every quant on Wall Street.');
    expect(setupText(l)).toBe('They earn more than');
    // ...but a finished sentence isn't merged into the next one
    const done = line('defense', 'I lost it all.');
    expect(attachPunch(done, { text: 'All of it.', tts: '' }, new Set())).toBe(true);
    expect(done.text).toBe('I lost it all. All of it.');
  });

  it('keeps a multi-word tag as one token and an opening quote on the punch', () => {
    const tagged = line('prosecution', 'Listen [laughs softly] they earn more than every quant on Wall Street.');
    expect(attachPunch(tagged, { text: 'every quant on Wall Street.', tts: '' }, new Set())).toBe(true);
    expect(setupText(tagged)).toBe('Listen [laughs softly] they earn more than');
    const quoted = line('defense', 'He said "every quant on Wall Street."');
    expect(attachPunch(quoted, { text: 'every quant on Wall Street."', tts: '' }, new Set())).toBe(true);
    expect(quoted.text).toBe('He said "every quant on Wall Street."');
  });

  it('leaves a cut-off line alone (the cut-in finishes it)', () => {
    const l = line('defense', 'And the median is —');
    attachPunch(l, { text: 'nothing.', tts: '' }, new Set());
    expect(l.text).toBe('And the median is —');
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
