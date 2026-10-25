// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Topic } from '@/types';

vi.stubEnv('DEBATE_LLM', 'gemini');
vi.stubEnv('GEMINI_API_KEY', 'synthetic');
vi.stubEnv('ANTHROPIC_API_KEY', '');
const askGemini = vi.fn();
vi.mock('./gemini', () => ({ askGemini: (...a: unknown[]) => askGemini(...a), hasGeminiKey: () => true }));
const { writeTopic } = await import('./trial');

const topic: Topic = { id: 't1', title: 'Cost', question: 'Can you afford it?', importance: 1, research_speed: 'quick', status: 'active', added_by: 'judge' };
const empty = { text: '', tts: '' };
const out = (punch: { text: string; tts: string }) => ({
  lines: [
    { text: 'YES: The top players earn more than', tts: '[confident] The top players earn more than', cites: [], cut_in: empty, resume: empty, punch },
    { text: 'NO: The median earns less.', tts: '[concerned] The median earns less.', cites: [], cut_in: empty, resume: empty, punch: empty },
  ],
  ledger: [],
  t: 0.2,
  confidence: 0.6,
  reasoning: 'r',
  deciding_argument: 'd',
  ruling: { text: 'Judge: Noted.', tts: '[calm] Noted.' },
});

describe('writeTopic: a model punch with a label and tags is cleaned like the line', () => {
  it('strips labels and tags from the punch text, keeps its delivery tag in tts', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) =>
      schema.parse(out({ text: 'PROSECUTION: [shouting] every quant on Wall Street.', tts: '[passionate] every... quant... on Wall Street.' })),
    );
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: false, urgent: true });
    const [yes, no] = res.lines;
    expect(yes.text).toBe('The top players earn more than every quant on Wall Street.');
    expect(yes.punch?.text).toBe('every quant on Wall Street.');
    expect(yes.punch?.tts).toMatch(/^\[passionate\]/);
    expect(no.text).toBe('The median earns less.');
    expect(res.ruling.text).toBe('Noted.');
  });

  it('a line cut off with "—" but no cut-in keeps the punch as its ending (no punch shot)', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => {
      const o = out({ text: 'every quant on Wall Street.', tts: '[passionate] every quant on Wall Street.' });
      o.lines[0].text = 'The top players earn more than —';
      o.lines[0].tts = '[confident] The top players earn more than —';
      return schema.parse(o);
    });
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: false, urgent: true });
    expect(res.lines[0].text).toBe('The top players earn more than every quant on Wall Street.');
    expect(res.lines[0].tts).toBe('[confident] The top players earn more than every quant on Wall Street.');
    expect(res.lines[0].punch).toBeUndefined();
  });

  it('the "—" branch still ends the sentence when the text already said the punch', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => {
      const o = out({ text: 'every quant.', tts: '' });
      o.lines[0].text = 'The top players earn more than every quant —';
      o.lines[0].tts = '[confident] The top players earn more than every quant —';
      return schema.parse(o);
    });
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: false, urgent: true });
    expect(res.lines[0].text).toBe('The top players earn more than every quant.');
    expect(res.lines[0].tts).toBe('[confident] The top players earn more than every quant.');
  });

  it('a cut-in always follows a line that ends cut off', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => {
      const o = out(empty);
      o.lines[0].cut_in = { text: 'Hold on!', tts: '[interrupting] Hold on!' };
      o.lines[0].resume = { text: 'Let me finish.', tts: '[confident] Let me finish.' };
      return schema.parse(o);
    });
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: true, urgent: true });
    expect(res.lines[0].text).toBe('The top players earn more than —');
    expect(res.lines[0].tts?.endsWith('—')).toBe(true);
    expect(res.lines[1].kind).toBe('cut_in');
  });

  it('a line ending in a full stop before a cut-in loses the stop, not gains " . —"', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => {
      const o = out(empty);
      o.lines[0].text = 'The median earns less.';
      o.lines[0].tts = '[concerned] The median earns less.';
      o.lines[0].cut_in = { text: 'Hold on!', tts: '[interrupting] Hold on!' };
      o.lines[0].resume = { text: 'Let me finish.', tts: '[confident] Let me finish.' };
      return schema.parse(o);
    });
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: true, urgent: true });
    expect(res.lines[0].text).toBe('The median earns less —');
    expect(res.lines[0].tts).toBe('[concerned] The median earns less —');
  });

  it('a line that is only a speaker label counts as empty (→ the mock)', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => {
      const o = out(empty);
      o.lines[1].text = 'Defense:';
      return schema.parse(o);
    });
    const res = await writeTopic({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes', cycle: 1 }, { side: 'no', cycle: 1 }], cutInAllowed: false, urgent: true });
    expect(res.fallback).toBe(true);
  });
});

describe('writeTopic: a topic that must land a punch', () => {
  const twoPlain = () => {
    const o = out(empty);
    o.lines[0].text = 'YES: You will meet people who open doors you never knew existed.';
    o.lines[0].tts = '[confident] You will meet people who open doors you never knew existed.';
    o.ledger = [
      { line_index: 0, claim: 'c', supports: 'yes', strength: 5 },
      { line_index: 1, claim: 'c', supports: 'no', strength: 2 },
    ] as never;
    return o;
  };
  const req = (punchRequired: boolean) => ({ question: 'Should I?', topic, cards: [], history: [], turns: [{ side: 'yes' as const, cycle: 1 }, { side: 'no' as const, cycle: 1 }], cutInAllowed: false, urgent: true, punchRequired });

  it('turns the strongest line’s final words into the punch when the model skipped it', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => schema.parse(twoPlain()));
    const res = await writeTopic(req(true));
    const punched = res.lines.filter((l) => l.punch);
    expect(punched).toHaveLength(1);
    expect(punched[0].text).toBe('You will meet people who open doors you never knew existed.');
    expect(punched[0].text.endsWith(punched[0].punch!.text)).toBe(true);
    expect(punched[0].tts?.endsWith(punched[0].punch!.text)).toBe(false); // the clip covers only the setup
  });

  it('asks the model for it, and leaves other topics alone', async () => {
    askGemini.mockImplementation(async (_s: string, _c: string, schema: { parse: (x: unknown) => unknown }) => schema.parse(twoPlain()));
    await writeTopic(req(true));
    expect(askGemini.mock.calls.at(-1)![1]).toContain('PUNCH: required');
    const res = await writeTopic(req(false));
    expect(res.lines.some((l) => l.punch)).toBe(false);
  });
});
