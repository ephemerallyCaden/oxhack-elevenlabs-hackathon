import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
import { runPunch, type PunchDeps } from './punchSequence';

const line: Line = {
  id: 'l1', speaker: 'prosecution', kind: 'argument', cites: [],
  text: 'The top one percent earn more than every quant on Wall Street.',
  audioUrl: 'blob:setup', durationMs: 2100,
  punch: { text: 'every quant on Wall Street.', audioUrl: 'blob:punch', durationMs: 1300 },
};

function recorder(abortAfter?: string) {
  const log: string[] = [];
  const ctl = new AbortController();
  const note = (s: string) => {
    log.push(s);
    if (s === abortAfter) ctl.abort();
  };
  const deps: PunchDeps = {
    stage: (s) => note(`stage:${s}`),
    clip: async (url, ms) => note(`clip:${url ?? 'none'}:${ms}`),
    sfx: (n) => note(`sfx:${n}`),
    shake: () => note('shake'),
    sleep: async (ms) => note(`sleep:${ms}`),
  };
  return { log, deps, signal: ctl.signal };
}

describe('runPunch', () => {
  it('plays the approved beat order and timings', async () => {
    const r = recorder();
    await runPunch(line, r.deps, r.signal);
    expect(r.log).toEqual([
      'stage:setup', 'clip:blob:setup:2100',
      'stage:cut', 'shake', 'sfx:scene_cut', 'sleep:600',
      'stage:punch', 'shake', 'clip:blob:punch:1300',
      'stage:to-judge', 'sleep:200', 'stage:judge', 'shake', 'sfx:gasp', 'sleep:900',
      'stage:to-opponent', 'sleep:200', 'stage:opponent', 'shake', 'sfx:gasp', 'sleep:900',
    ]);
  });

  it('stops at the next beat when interrupted', async () => {
    const r = recorder('clip:blob:punch:1300');
    await runPunch(line, r.deps, r.signal);
    expect(r.log.at(-1)).toBe('clip:blob:punch:1300');
    expect(r.log).not.toContain('stage:to-judge');
  });

  it('does nothing for a line without a punch', async () => {
    const r = recorder();
    await runPunch({ ...line, punch: undefined }, r.deps, r.signal);
    expect(r.log).toEqual([]);
  });
});
