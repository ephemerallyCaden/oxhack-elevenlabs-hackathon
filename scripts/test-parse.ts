// D2 test: run parseDecision on 10 messy phrasings and log results to lib/debate/parse.test.md.
// Run: npx tsx --env-file=.env.local scripts/test-parse.ts
import { writeFileSync } from 'node:fs';
import { parseDecision } from '../lib/debate/parseDecision';

const PHRASINGS = [
  'Should I quit my quant job to become a poker player?',
  'ugh should I just quit my job at Citadel and play poker full time',
  'so um I work at a quaint fund in London making like one fifty and I keep thinking about going pro at poker is that insane',
  "I'm 26, I've got sixty grand saved, and I'm crushing the online games. Do I leave Jane Street?",
  'should i move from sydney to london for a job that pays more',
  'Is it worth doing a masters in computer science or should I just start working now',
  'my friend wants me to cofound a startup with him but I have a stable job at google',
  'should I buy a flat in London or keep renting and invest the difference',
  'thinking of quitting medicine to be a full time streamer lol',
  'poker or quant poker or quant poker or quant I genuinely cannot decide',
];

async function main() {
const rows: string[] = [];
for (const [i, text] of PHRASINGS.entries()) {
  const t0 = Date.now();
  const { decision, fallback } = await parseDecision(text);
  const ms = Date.now() - t0;
  console.log(`${i + 1}. ${fallback ? 'FALLBACK' : 'ok'} ${ms}ms  ${decision.options.join(' | ')}`);
  rows.push(
    `| ${i + 1} | ${text} | ${decision.type} | ${decision.options[0]} | ${decision.options[1]} | ${decision.summary} | ${fallback ? 'fallback' : 'live'} ${ms}ms | |`,
  );
}

writeFileSync(
  'lib/debate/parse.test.md',
  `# D2 parse test (${new Date().toISOString()})

Fill the last column with ✅/❌ after reading each row. Target: 9/10 correct.

| # | Input | Type | Option A (change) | Option B (status quo) | Summary | Run | OK? |
|---|---|---|---|---|---|---|---|
${rows.join('\n')}
`,
);
console.log('wrote lib/debate/parse.test.md');
}

main();
