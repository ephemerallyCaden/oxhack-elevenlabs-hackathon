// D4 test: a full debate with 1 INTERRUPT, 1 HOLD IT and 1 MOVE ON, start to finish, against a fake player.
// No server needed — every API call falls back (which also tests the fallback path).
// Run: npx tsx scripts/test-orchestrator.ts
import type { DebateEvent, DebatePlayerControls } from '../types';
import { DebateOrchestrator } from '../lib/debate/orchestrator';

const played: string[] = [];
let queue: DebateEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;

// Plays each event for 5ms, fires the callbacks C4's player must fire.
const player: DebatePlayerControls = {
  load(events) {
    clearTimeout(timer);
    queue = [...events];
    next();
  },
  pause() {
    clearTimeout(timer);
  },
  play() {
    next();
  },
};
function next() {
  const e = queue.shift();
  if (!e) return orch.onQueueEnd();
  played.push(`${e.type}:${e.speaker ?? ''}:${e.interrupt_flavor ?? e.effect ?? e.music ?? e.expression ?? e.id}`);
  orch.onEventStart(e);
  timer = setTimeout(next, 5);
}

const orch = new DebateOrchestrator(player);
let held = false;
let skipped = false;
let interrupted = false;
const t0 = Date.now();

orch.subscribe(() => {
  const s = orch.getState();
  if (s.phase === 'debate' && s.canHoldIt && !held && s.round === 1) {
    held = true;
    setTimeout(() => orch.holdIt(), 1);
  } else if (s.phase === 'debate' && s.round === 2 && !skipped && s.current?.type === 'speech') {
    skipped = true;
    setTimeout(() => orch.moveOn(), 1);
  } else if (s.phase === 'interrupt_window') {
    if (!interrupted) {
      interrupted = true;
      setTimeout(() => {
        if (orch.beginInterrupt()) orch.interrupt('But what about quality of life?');
      }, 1);
    } else setTimeout(() => orch.continueNow(), 1);
  } else if (s.phase === 'done') {
    console.log(played.join('\n'));
    const ok =
      played.some((p) => p.includes('HOLD IT!')) &&
      played.some((p) => p.includes('MOVE ON!')) &&
      played.some((p) => p.includes('OBJECTION!') || p.includes('WAIT!')) &&
      played.some((p) => p.startsWith('verdict:'));
    console.log(`\n${ok ? 'PASS' : 'FAIL'} in ${Date.now() - t0}ms · tokens left ${s.tokens} · fallbacks: ${s.fallbacks.join(', ')}`);
    process.exit(ok ? 0 : 1);
  }
});

orch.start('should I quit my quant job to play poker');
setTimeout(() => {
  console.error('FAIL: timed out in phase', orch.getState().phase, '\n', played.slice(-5).join('\n'));
  process.exit(1);
}, 20000);
