// Validates lib/debate/mock-events.json against the DebateEvent contract.
// Run: npx tsx scripts/check-debate-mocks.ts
import mock from '../lib/debate/mock-events.json';
import { DebateEventsSchema, lintEvents } from '../lib/debate/schema';

const parsed = DebateEventsSchema.safeParse(mock);
if (!parsed.success) {
  console.error(parsed.error.issues);
  process.exit(1);
}
const problems = lintEvents(parsed.data);
if (problems.length) {
  console.error(problems);
  process.exit(1);
}
const speech = parsed.data.filter((e) => e.type === 'speech' || e.type === 'interrupt' || e.type === 'verdict');
const totalMs = speech.reduce((s, e) => s + (e.durationMs ?? 0), 0);
console.log(`OK: ${parsed.data.length} events, ${speech.length} spoken, ~${Math.round(totalMs / 1000)}s of audio`);
