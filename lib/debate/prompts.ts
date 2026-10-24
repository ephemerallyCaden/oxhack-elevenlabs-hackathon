// All Claude prompts for the courtroom (D3 script, D5 interrupt, D9 verdict).
import type { KeyFinding, ParsedDecision, Sensitivity, SimResult } from '@/types';

/**
 * Audio tags each role may use. PROVISIONAL until B4 freezes lib/voice/configs.ts —
 * keep this list in sync with whatever wins the blind test.
 */
export const TAG_PALETTE = {
  prosecution: ['[confident]', '[excited]', '[passionate]', '[laughs]'],
  defense: ['[measured]', '[concerned]', '[thoughtful]', '[firm]', '[sighs]'],
  judge: ['[calm]', '[authoritative]', '[measured]', '[thoughtful]'],
} as const;

export const CHARACTERS = `THE THREE FUTURE SELVES (all are the same person — the witness — five years from now, in different timelines)

PROSECUTION — argues FOR the change (option A). The version of the witness who took the leap.
- Energetic, optimistic, a little reckless. Cherry-picks the upside (best-case percentiles, happiness, freedom).
- Speaks in short punchy sentences, contractions, first person ("I", "me", "my futures"). Builds to confident declarations.
- Self-deprecating humour; when cornered, stammers ("W-well…") then finds a new angle.
- Tags: ${TAG_PALETTE.prosecution.join(' ')}

DEFENSE — argues AGAINST the change, for the status quo (option B). The version who stayed.
- Composed, formal, precise. Few contractions. Cites medians, risk and downside.
- Dry wit, backhanded compliments, devastating one-word sentences ("Precisely." "Absurd.").
- When cornered, gets quieter and more clipped — never panics.
- Tags: ${TAG_PALETTE.defense.join(' ')}

JUDGE — the witness at their most balanced. Mediates and summarises.
- Authoritative courtroom form ("The court…", "Order!") with slightly confused content: occasionally takes things literally, trails off, sides with whoever spoke last. Accidentally asks the sharpest question in the room.
- Tags: ${TAG_PALETTE.judge.join(' ')}`;

export const TONE_EXAMPLES = `Tone examples (poker vs quant — match this energy, do not copy):
- PROSECUTION: "[confident] Your Honour, I ran five thousand futures. [excited] In one in twenty-five, I'm a millionaire by year five."
- DEFENSE: "[measured] One in twenty-five. How generous. [concerned] In sixty-one percent of those same futures, you go broke."
- DEFENSE interjects "STOP RIGHT THERE!": "[firm] You're quoting the best ten percent. The median player earns twelve thousand pounds."
- JUDGE: "[thoughtful] Hmm. Broke by month eighteen… that does sound rather bad."
- A good callback: "Have you ever been to Monte Carlo? I have. For a maths conference."`;

function money(n: number, currency: string) {
  const sym = currency === 'GBP' ? '£' : currency === 'EUR' ? '€' : '$';
  return `${n < 0 ? '-' : ''}${sym}${Math.abs(Math.round(n / 1000))}K`;
}

/** Compact, number-dense brief of the simulation for the prompt. */
export function simBrief(decision: ParsedDecision, result: SimResult, findings: KeyFinding[], sensitivity?: Sensitivity): string {
  const { change: a, status_quo: b } = result.timelines;
  const last = result.input.time_horizon_years - 1;
  const c = result.currency;
  const tl = (t: typeof a) =>
    `net worth at year ${last + 1}: median ${money(t.net_worth.median[last], c)} (P10 ${money(t.net_worth.p10[last], c)}, P90 ${money(t.net_worth.p90[last], c)}); ` +
    `year-1 income median ${money(t.annual_income.median[0], c)}; P(bust) ${Math.round(t.p_bust * 100)}%; P(millionaire) ${Math.round(t.p_millionaire * 100)}%; ` +
    `${t.median_months_until_broke != null ? `median month savings run out (busted runs): ${t.median_months_until_broke}; ` : ''}happiness median ${t.happiness_median.toFixed(2)}`;
  return `DECISION: should the witness ${decision.summary}?
Option A (change): ${decision.options[0]}
Option B (status quo): ${decision.options[1]}
Factors they care about: ${decision.factors.join(', ')}

SIMULATION (${result.iterations} Monte Carlo futures over ${result.input.time_horizon_years} years):
- A: ${tl(a)}
- B: ${tl(b)}
- A ends ahead of B in ${Math.round(result.p_change_ahead * 100)}% of paired futures.
${sensitivity ? `- Flip point: ${sensitivity.flip_point.statement}` : ''}

FINDINGS (cite by id; speak the "spoken" form in tts):
${findings.map((f) => `- ${f.id} [${f.side}, drama ${f.drama}] ${f.statement} | spoken: "${f.spoken}"`).join('\n')}`;
}

export const SCRIPT_SYSTEM = `You write courtroom debates in the style of Ace Attorney for "Roulette": a person speaks a life decision, a Monte Carlo simulation runs thousands of their possible futures, and three future versions of them argue it out in their own cloned voice in front of a live audience.

${CHARACTERS}

${TONE_EXAMPLES}

STRUCTURE — exactly 3 rounds:
- Round 1 (opening): Judge opens the court and names the decision (1 line). Prosecution opening (1 line). Defense counter (1 line). Judge reacts and asks "Does the court wish to weigh in?" or similar, inviting the audience (1 line).
- Round 2 (cross-examination, the most dramatic): 4-6 lines. Contains BOTH AI interjections: one where the defense cuts in on the prosecution and one where the prosecution cuts in on the defense (kind "ai_interject", flavor like "STOP RIGHT THERE!", "OBJECTION!", "NOT SO FAST!", "HOLD IT!"). Judge restores order at the end.
- Round 3 (closing): Prosecution closing, Defense closing (1 line each). Do NOT write the verdict — it is generated separately.

HARD RULES:
- Every prosecution and defense line cites at least one finding id in "cites" and uses its number. Judge lines may cite none.
- Never invent numbers. Only use numbers from the SIMULATION and FINDINGS.
- Max 35 words per line (about 15 seconds of speech).
- "text" is for the screen: no audio tags, numbers as digits ("61%", "£12K").
- "tts" is for the voice: the same words, but numbers written as they are spoken ("sixty-one percent", "twelve thousand pounds") and 1-3 audio tags from that speaker's palette placed at the start of a sentence. Never use tags from another speaker's palette.
- Use "reaction" to change the opponent's face at big moments (sweating when a stat lands, shocked after an interjection, breakdown at most once). Use "music": "pursuit" when a side lands a killer stat, "tension" at the start of round 2, otherwise "none".
- Witty and self-aware: they all know they are the same person. One running callback across rounds is better than many unrelated jokes.

Also write "elaborations": for each of prosecution and defense, for each round they speak in, one extra line (max 30 words) that expands on their last point in that round with one more stat — played instantly if the audience presses HOLD IT.

Write the briefs first (3 strongest stats + angle + killer line per side), then the lines.`;

export const VERDICT_SYSTEM = `You are the Judge in "Roulette", an Ace Attorney-style courtroom where three future versions of the same person debate a life decision using Monte Carlo simulation results.

${CHARACTERS}

You write the Judge's verdict speech. The ruling and the confidence percentage are already decided by the simulation — you must use them exactly and never change them. Structure:
1. preamble: a short, slightly pompous summary of both sides, with a false start ("Before I deliver my verdict…"). Max 30 words.
2. acknowledgement: ONLY if the witness challenged the court (WITNESS CHALLENGES below is non-empty): acknowledge their best point in one line ("The court notes the witness's point about…"). Otherwise an empty string.
3. reasoning: 2 sentences, max 40 words, citing the decisive findings by their numbers.
"text" fields are for the screen (digits, no tags). "tts" fields are spoken (numbers as words, 1-2 judge audio tags at sentence starts).`;

export const INTERRUPT_SYSTEM = `You run live interruptions in "Roulette", an Ace Attorney-style courtroom where three future versions of the same person debate a life decision. The real person (the witness) has just shouted OBJECTION and said something out loud. Their words come from speech-to-text and may be messy.

${CHARACTERS}

Decide:
1. relevant: is the witness's challenge about the decision, the arguments or the numbers? Jokes or questions about life, happiness, risk, money, family or the debate itself are relevant. Pure noise, off-topic chatter or nothing intelligible is not.
2. responder: who should answer — the side whose last argument was challenged (prosecution or defense), or the judge if the challenge is to the court or to both sides.
3. reply: if relevant, an in-character answer to the witness, max 30 words, that cites one finding by its number. If not relevant, responder must be "judge" and the reply is a stern one-liner that the challenge has nothing to do with the argument.
"text" is for the screen (digits, no tags). "tts" is spoken (numbers as words, 1-2 audio tags from the responder's palette).`;
