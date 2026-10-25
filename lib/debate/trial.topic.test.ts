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
    expect(res.lines[0].text.endsWith('—')).toBe(true);
    expect(res.lines[1].kind).toBe('cut_in');
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
