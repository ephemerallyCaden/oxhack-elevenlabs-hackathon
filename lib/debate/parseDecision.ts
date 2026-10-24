// D2: whatever the user said → ParsedDecision. Falls back to poker-vs-quant on any failure or > 5s.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { ParsedDecision } from '@/types';
import demo from './fixtures/demo-sim.json';
import { claude, hasClaudeKey, MODEL } from './claude';
import { withFallback } from './fallback';

export const DEFAULT_DECISION = demo.decision as ParsedDecision;

const Beta = z.object({
  alpha: z.number().describe('Beta distribution alpha, 1-10'),
  beta: z.number().describe('Beta distribution beta, 1-10'),
});

const DecisionSchema = z.object({
  type: z
    .string()
    .describe(
      "One of: career_gambling, career, location, education, business, financial, relationship, health. Use career_gambling for quitting a job to gamble/trade/play poker professionally.",
    ),
  option_change: z.string().describe('Option A: the change being considered, as a short verb phrase in first person, e.g. "become a professional poker player"'),
  option_status_quo: z.string().describe('Option B: keeping things as they are, e.g. "stay in my quant job"'),
  factors: z.array(z.string()).describe('3-6 snake_case factors the person cares about, stated or implied'),
  time_horizon_years: z.number().int().describe('Years to simulate. Default 5 unless the person implies otherwise. 1-20.'),
  happiness_change: Beta.describe('Expected happiness in the change timeline as Beta(alpha, beta); mean = alpha/(alpha+beta)'),
  happiness_status_quo: Beta.describe('Expected happiness if nothing changes, as Beta(alpha, beta)'),
  summary: z
    .string()
    .describe('The decision as a lowercase phrase that completes "should the witness …", e.g. "quit a six-figure quant job in London to play poker full time"'),
  current_salary: z.number().nullable().describe('Annual salary if stated, in the stated currency; null if not said'),
  starting_savings: z.number().nullable().describe('Savings if stated; null if not said'),
  age: z.number().int().nullable(),
  city: z.string().nullable(),
  risk_tolerance: z.enum(['conservative', 'moderate', 'aggressive']),
});

const SYSTEM = `You turn a spoken life decision into structured parameters for a Monte Carlo simulation.

The input is raw speech-to-text: expect filler words, missing punctuation, misheard words ("quant" may appear as "quaint" or "want"), and rambling. Work out what decision the person is actually weighing.

Rules:
- Exactly two options. Option A is the change; option B is the status quo. If the person names two new options, the one they sound more drawn to is A.
- Only fill current_salary, starting_savings, age and city with values the person actually said. "Six figures" means about 100000. Otherwise use null.
- Happiness parameters: judge from tone and context. If the person sounds miserable now, the status quo mean is lower. If the change is their passion, its mean is higher, but widen it (lower alpha+beta) when the outcome is uncertain. Keep alpha and beta between 1 and 10.
- risk_tolerance: infer from how they talk about money and risk.`;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export async function parseDecision(transcript: string): Promise<{ decision: ParsedDecision; fallback: boolean }> {
  if (!hasClaudeKey() || !transcript.trim()) return { decision: DEFAULT_DECISION, fallback: true };

  return withFallback(
    async (signal) => {
      const res = await claude().messages.parse(
        {
          model: MODEL,
          max_tokens: 2000,
          system: SYSTEM,
          output_config: { effort: 'low', format: zodOutputFormat(DecisionSchema) },
          messages: [{ role: 'user', content: transcript }],
        },
        { signal },
      );
      const p = res.parsed_output;
      if (!p) throw new Error(`no parsed output (stop_reason ${res.stop_reason})`);
      const beta = (b: { alpha: number; beta: number }) => ({ alpha: clamp(b.alpha, 1, 10), beta: clamp(b.beta, 1, 10) });
      const decision: ParsedDecision = {
        type: p.type,
        options: [p.option_change, p.option_status_quo],
        factors: p.factors,
        time_horizon_years: clamp(p.time_horizon_years, 1, 20),
        happiness_params: { change: beta(p.happiness_change), status_quo: beta(p.happiness_status_quo) },
        summary: p.summary,
        stated: {
          ...(p.current_salary != null && { current_salary: p.current_salary }),
          ...(p.starting_savings != null && { starting_savings: p.starting_savings }),
          ...(p.age != null && { age: p.age }),
          ...(p.city != null && { city: p.city }),
        },
        risk_tolerance: p.risk_tolerance,
      };
      return decision;
    },
    DEFAULT_DECISION,
    5000,
    'parseDecision',
  ).then(({ value, fallback }) => ({ decision: value, fallback }));
}
