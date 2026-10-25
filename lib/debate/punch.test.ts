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
      expect(attachPunch(l, { text: punch, tts: '' }, new Set())).toBe(true);
      expect(setupText(l)).toBe(setup);
      expect(`${setupText(l)} ${l.punch!.text}`).toBe(l.text); // the textbox adds up to the line
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

  it('a trailing sound tag still ends the sentence: no spoken word is lost', () => {
    const l = line('defense', 'I lost it all.', { tts: '[sighs] I lost it all. [sighs]' });
    expect(attachPunch(l, { text: 'All of it.', tts: '' }, new Set())).toBe(true);
    expect(l.text).toBe('I lost it all. All of it.');
    expect(l.tts).toBe('[sighs] I lost it all. [sighs]');
  });

  it('a refused punch the text already says still completes a setup-only voice line', () => {
    const l = line('defense', 'The median earns less than minimum wage.', { tts: '[concerned] The median earns' });
    expect(attachPunch(l, { text: 'less than minimum wage.', tts: '[concerned] less than... minimum wage.' }, new Set<Side>(['yes']))).toBe(false);
    expect(l.text).toBe('The median earns less than minimum wage.');
    expect(l.tts).toBe('[concerned] The median earns less than... minimum wage.');
  });

  it('a "..." pause before the punch is not a sentence end; a closing quote after a full stop is', () => {
    const pause = line('defense', 'And the median earns...');
    attachPunch(pause, { text: 'less than minimum wage.', tts: '' }, new Set());
    expect(pause.text).toBe('And the median earns... less than minimum wage.');
    const quoted = line('prosecution', 'He said "no."');
    attachPunch(quoted, { text: '"you win."', tts: '' }, new Set());
    expect(quoted.text).toBe('He said "no." "You win."');
  });

  it('keeps deliberate repetition after a comma', () => {
    const l = line('prosecution', 'What you get is freedom,');
    attachPunch(l, { text: 'freedom to fail.', tts: '' }, new Set());
    expect(l.text).toBe('What you get is freedom, freedom to fail.');
  });

  it('a voice line that only said the punch falls back to the setup text', () => {
    const l = line('defense', 'The median earns', { tts: '[concerned] less than minimum wage.' });
    expect(attachPunch(l, { text: 'less than minimum wage.', tts: '[concerned] less than minimum wage.' }, new Set())).toBe(true);
    expect(l.tts).toBe('');
  });

  it('capitalises the first word only, never a word in the middle', () => {
    for (const [punch, want] of [
      ['£2,000 a month.', '£2,000 a month.'],
      ['40% of them quit.', '40% of them quit.'],
      ['iPhones win.', 'iPhones win.'],
      ['"you win."', '"You win."'],
    ]) {
      const l = line('prosecution', 'Think about it.');
      attachPunch(l, { text: punch, tts: '' }, new Set());
      expect(l.punch?.text).toBe(want);
    }
  });

  it('a line that is just the start of the punch keeps the whole sentence (capitalised)', () => {
    const l = line('defense', 'Everything');
    expect(attachPunch(l, { text: 'everything is gone.', tts: '' }, new Set())).toBe(false);
    expect(l.text).toBe('Everything is gone.');
  });

  it('a unicode ellipsis is a pause too, emoji count as words, an initialism is not a sentence end', () => {
    const pause = line('defense', 'It costs…');
    attachPunch(pause, { text: 'costs everything.', tts: '' }, new Set());
    expect(pause.text).toBe('It costs… costs everything.');
    const party = line('prosecution', 'We lost 🎉');
    attachPunch(party, { text: '🎉 everything.', tts: '' }, new Set());
    expect(party.text).toBe('We lost 🎉 everything.');
    const us = line('prosecution', 'The U.S.');
    attachPunch(us, { text: 'pays more.', tts: '' }, new Set());
    expect(us.text).toBe('The U.S. pays more.');
  });

  it('keeps a repeated word in the setup clip when the text keeps it (comma in text, not in tts)', () => {
    const l = line('prosecution', 'What you get is freedom,', { tts: '[passionate] What you get is freedom' });
    expect(attachPunch(l, { text: 'freedom to fail.', tts: '' }, new Set())).toBe(true);
    expect(l.text).toBe('What you get is freedom, freedom to fail.');
    expect(l.tts).toBe('[passionate] What you get is freedom');
  });

  it('cuts the start of the punch from a setup clip that runs into it', () => {
    const l = line('prosecution', 'Top players earn more than', { tts: '[confident] Top players earn more than every quant' });
    expect(attachPunch(l, { text: 'every quant on Wall Street.', tts: '[passionate] every... quant... on Wall Street.' }, new Set())).toBe(true);
    expect(l.tts).toBe('[confident] Top players earn more than');
    const money = line('defense', 'It costs', { tts: '[concerned] It costs two thousand pounds' });
    expect(attachPunch(money, { text: '£2,000 a month.', tts: '[concerned] two thousand pounds a month.' }, new Set())).toBe(true);
    expect(money.tts).toBe('[concerned] It costs');
  });

  it('an overlapping word keeps the case the text gave it', () => {
    const l = line('prosecution', 'I said no');
    attachPunch(l, { text: 'No more excuses.', tts: '' }, new Set());
    expect(l.text).toBe('I said no more excuses.');
  });

  it('a spoken-number coincidence never cuts a setup word from the clip', () => {
    const l = line('prosecution', 'The fund returns 7%', { tts: '[confident] The fund returns seven percent' });
    attachPunch(l, { text: 'percent of nothing.', tts: '' }, new Set());
    expect(l.tts).toBe('[confident] The fund returns seven percent');
    const r = line('defense', 'In 2 years you will be 2', { tts: '[concerned] In two years you will be two' });
    attachPunch(r, { text: 'two years behind.', tts: '' }, new Set<Side>(['yes']));
    expect(r.tts).toBe('[concerned] In two years you will be two two years behind.');
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
