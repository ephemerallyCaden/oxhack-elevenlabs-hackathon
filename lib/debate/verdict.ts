// D9: the Judge's verdict. Ruling + confidence come from the simulation; Claude only writes the words.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DebateEvent, KeyFinding, ParsedDecision, Sensitivity, SimResult, Verdict } from '@/types';
import { claude, hasClaudeKey, MODEL } from './claude';
import { withFallback } from './fallback';
import { simBrief, VERDICT_SYSTEM } from './prompts';
import { estimateDurationMs, pct } from './spoken';

export interface VerdictInput {
  decision: ParsedDecision;
  result: SimResult;
  findings: KeyFinding[];
  sensitivity?: Sensitivity;
  userChallenges?: string[];
}

const Line = z.object({ text: z.string(), tts: z.string() });
const VerdictSchema = z.object({
  preamble: Line,
  acknowledgement: Line.describe('Empty strings if there were no witness challenges'),
  reasoning: Line,
});
type VerdictWords = z.infer<typeof VerdictSchema>;

/** Deterministic part: who wins and how confident, straight from the simulation. */
export function ruling(decision: ParsedDecision, result: SimResult) {
  const changeWins = result.p_change_ahead >= 0.5;
  const confidence = changeWins ? result.p_change_ahead : 1 - result.p_change_ahead;
  return {
    winner: changeWins ? ('change' as const) : ('status_quo' as const),
    winner_label: changeWins ? decision.options[0] : decision.options[1],
    confidence,
    pct: pct(confidence),
  };
}

/** The 2 most dramatic findings on the winning side — what the verdict cites (C7 shows their sources). */
function decisive(input: VerdictInput): KeyFinding[] {
  const side = ruling(input.decision, input.result).winner === 'change' ? 'for_change' : 'against_change';
  return [...input.findings].filter((f) => f.side === side).sort((a, b) => b.drama - a.drama).slice(0, 2);
}

/** The verdict without Claude — used when there's no key, on timeout, or as the script's default. */
function templateWords(input: VerdictInput): VerdictWords {
  const top = decisive(input);
  const challenge = input.userChallenges?.[0];
  return {
    preamble: {
      text: 'This court has heard compelling arguments from both sides... and several unnecessary ones. Before I deliver my verdict...',
      tts: '[authoritative] This court has heard compelling arguments from both sides... [thoughtful] and several unnecessary ones. Before I deliver my verdict...',
    },
    acknowledgement: challenge
      ? {
          text: `The court notes the witness's point: "${challenge}". It has been weighed.`,
          tts: `[measured] The court notes the witness's point. It has been weighed.`,
        }
      : { text: '', tts: '' },
    reasoning: {
      text: top.map((f) => `${f.statement}.`).join(' ') || 'The numbers speak for themselves.',
      tts: `[measured] ${top.map((f) => `${f.spoken}.`).join(' ') || 'The numbers speak for themselves.'}`,
    },
  };
}

async function claudeWords(input: VerdictInput, signal: AbortSignal): Promise<VerdictWords> {
  const r = ruling(input.decision, input.result);
  const res = await claude().messages.parse(
    {
      model: MODEL,
      max_tokens: 3000,
      system: VERDICT_SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(VerdictSchema) },
      messages: [
        {
          role: 'user',
          content: `${simBrief(input.decision, input.result, input.findings, input.sensitivity)}

RULING (fixed): the court finds in favour of "${r.winner_label}" with ${r.pct.text} confidence (spoken: "${r.pct.spoken}").

WITNESS CHALLENGES: ${input.userChallenges?.length ? input.userChallenges.map((c) => `"${c}"`).join('; ') : '(none)'}`,
        },
      ],
    },
    { signal },
  );
  if (!res.parsed_output) throw new Error(`no parsed output (stop_reason ${res.stop_reason})`);
  return res.parsed_output;
}

/** Words → events. Order: music, gavel, preamble, [acknowledgement], verdict, flip line, gavel ×1 + shake. */
function toEvents(input: VerdictInput, w: VerdictWords, idPrefix: string): DebateEvent[] {
  const r = ruling(input.decision, input.result);
  const flip = input.sensitivity?.flip_point;
  const verdict: Verdict = {
    winner: r.winner,
    winner_label: r.winner_label,
    confidence: r.confidence,
    reasoning: w.reasoning.text,
    flip_line: flip ? flip.statement : '',
  };
  const ruleText = `This court finds in favour of: ${r.winner_label}, with ${r.pct.text} confidence.`;
  const ruleTts = `[authoritative] This court finds in favour of: ${r.winner_label}, with ${r.pct.spoken} confidence.`;
  const speech = (id: string, text: string, tts: string): DebateEvent => ({
    id: `${idPrefix}-${id}`,
    timestamp: 0,
    type: 'speech',
    speaker: 'judge',
    text,
    tts,
    durationMs: estimateDurationMs(text),
  });

  const events: DebateEvent[] = [
    { id: `${idPrefix}-music`, timestamp: 0, type: 'music_change', music: 'verdict' },
    { id: `${idPrefix}-gavel1`, timestamp: 0, type: 'effect', effect: 'gavel' },
    speech('preamble', w.preamble.text, w.preamble.tts),
  ];
  if (w.acknowledgement.text.trim()) events.push(speech('ack', w.acknowledgement.text, w.acknowledgement.tts));
  const vText = `${ruleText} ${w.reasoning.text}`;
  events.push({
    id: `${idPrefix}-verdict`,
    timestamp: 0,
    type: 'verdict',
    speaker: 'judge',
    text: vText,
    tts: `${ruleTts} ${w.reasoning.tts}`,
    durationMs: estimateDurationMs(vText),
    verdict,
    cites: decisive(input).map((f) => f.id),
  });
  if (flip) events.push(speech('flip', `But: ${flip.statement}`, `[calm] But... ${flip.spoken}.`));
  events.push(
    { id: `${idPrefix}-gavel2`, timestamp: 0, type: 'effect', effect: 'gavel' },
    { id: `${idPrefix}-shake`, timestamp: 0, type: 'effect', effect: 'shake' },
  );
  return events;
}

export function templateVerdict(input: VerdictInput, idPrefix = 'v'): DebateEvent[] {
  return toEvents(input, templateWords(input), idPrefix);
}

export async function generateVerdict(
  input: VerdictInput,
  idPrefix = 'v',
  ms = 8000,
): Promise<{ events: DebateEvent[]; fallback: boolean }> {
  if (!hasClaudeKey()) return { events: templateVerdict(input, idPrefix), fallback: true };
  const { value, fallback } = await withFallback((signal) => claudeWords(input, signal), () => templateWords(input), ms, 'verdict');
  return { events: toEvents(input, value, idPrefix), fallback };
}
