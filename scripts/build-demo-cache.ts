// D6: run the REAL pipeline once for the demo decision and save everything for offline playback:
//   public/demo/demo-run.json + public/demo/audio/<event-id>.mp3
// Needs `npm run dev` running with all keys in .env.local. Re-run after the final prompt/voice tweaks (H17).
// Run: npx tsx scripts/build-demo-cache.ts [baseUrl]
import { mkdirSync, writeFileSync } from 'node:fs';
import type {
  DebateEvent,
  InterruptResponse,
  ParseResponse,
  ScriptResponse,
  SimulateResponse,
  VerdictResponse,
  VoiceDebateResponse,
  IngestResponse,
  SimInput,
} from '../types';
import type { DemoRun } from '../lib/debate/demoRun';
import { FALLBACK_CHALLENGE, FALLBACK_INTERRUPT_REPLY } from '../lib/debate/fallback';
import { DebateEventsSchema } from '../lib/debate/schema';
import demoSim from '../lib/debate/fixtures/demo-sim.json';

const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
const TRANSCRIPT = 'Should I quit my six-figure quant job in London to become a professional poker player?';

async function post<T>(path: string, body: unknown): Promise<T> {
  const t0 = Date.now();
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const json = (await res.json()) as T & { fallback?: boolean };
  console.log(`${path.padEnd(22)} ${Date.now() - t0}ms${json.fallback ? '  ⚠ FALLBACK' : ''}`);
  return json;
}

async function main() {
  mkdirSync('public/demo/audio', { recursive: true });

  const { decision } = await post<ParseResponse>('/api/debate/parse', { transcript: TRANSCRIPT });
  const ingest = await post<IngestResponse>('/api/ingest', { decision }).catch((e) => {
    console.warn('ingest unavailable:', e.message);
    return { dataPoints: [], fallback: true };
  });
  const input: SimInput = { ...(demoSim.result.input as SimInput), options: decision.options, happiness_params: decision.happiness_params };
  const sim = await post<SimulateResponse>('/api/simulate', { input, dataPoints: ingest.dataPoints }).catch((e) => {
    console.warn('simulate unavailable, using fixture:', e.message);
    return { result: demoSim.result, findings: demoSim.findings, sensitivity: demoSim.sensitivity, fallback: true } as SimulateResponse;
  });
  const script = await post<ScriptResponse>('/api/debate/script', {
    decision,
    result: sim.result,
    findings: sim.findings,
    sensitivity: sim.sensitivity,
  });

  // Voice the script, HOLD IT lines, fixed judge lines and the offline interrupt reply in one batch.
  const voiced = await post<VoiceDebateResponse>('/api/voice/debate', {
    events: script.events,
    elaborations: { ...script.elaborations, 'fallback-reply': [FALLBACK_INTERRUPT_REPLY] },
  });

  const recentLines = voiced.events.filter((e) => (e.type === 'speech' || e.type === 'interrupt') && e.round === 1).slice(-3);
  const interrupt = await post<InterruptResponse>('/api/debate/interrupt', {
    transcript: FALLBACK_CHALLENGE,
    context: { decision, recentLines, findings: sim.findings, round: 1 },
  });

  const verdict = await post<VerdictResponse>('/api/debate/verdict', {
    decision,
    result: sim.result,
    findings: sim.findings,
    sensitivity: sim.sensitivity,
    userChallenges: [FALLBACK_CHALLENGE],
  });
  const verdictVoiced = await post<VoiceDebateResponse>('/api/voice/debate', { events: verdict.events, elaborations: {} });

  // Download every clip so the demo works with the network unplugged.
  const missing: string[] = [];
  async function localise(e: DebateEvent): Promise<DebateEvent> {
    const spoken = e.type === 'speech' || e.type === 'interrupt' || e.type === 'verdict';
    if (!spoken || e.speaker === 'user') return e;
    if (!e.audioUrl) {
      missing.push(e.id);
      return e;
    }
    const url = e.audioUrl.startsWith('data:') || e.audioUrl.startsWith('http') ? e.audioUrl : `${BASE}${e.audioUrl}`;
    const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
    const file = `/demo/audio/${e.id}.mp3`;
    writeFileSync(`public${file}`, bytes);
    return { ...e, audioUrl: file };
  }
  const all = (evs: DebateEvent[]) => Promise.all(evs.map(localise));
  const elaborations: Record<string, DebateEvent[]> = {};
  for (const [k, v] of Object.entries(voiced.elaborations)) elaborations[k] = await all(v);

  const run: DemoRun = {
    createdAt: new Date().toISOString(),
    transcript: TRANSCRIPT,
    decision,
    sim,
    events: await all(voiced.events),
    elaborations,
    interrupt: { challenge: FALLBACK_CHALLENGE, response: { ...interrupt, events: await all(interrupt.events) } },
    verdictAfterInterrupt: await all(verdictVoiced.events),
  };
  DebateEventsSchema.parse([...run.events, ...run.verdictAfterInterrupt, ...Object.values(run.elaborations).flat()]);
  writeFileSync('public/demo/demo-run.json', JSON.stringify(run, null, 2));

  console.log(`\nwrote public/demo/demo-run.json (${run.events.length} events)`);
  if (missing.length) console.warn(`⚠ ${missing.length} spoken events have NO audio: ${missing.join(', ')}`);
  else console.log('✓ every spoken event has audio — test with wifi off at /court?demo=1');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
