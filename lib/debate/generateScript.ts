// D3: simulation findings → 3-round courtroom script as DebateEvent[] (plus HOLD IT lines and the verdict).
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DebateEvent, ScriptRequest, ScriptResponse } from '@/types';
import mockEvents from './mock-events.json';
import mockElaborations from './mock-elaborations.json';
import { claude, hasClaudeKey, MODEL } from './claude';
import { FIXED_LINES, withFallback } from './fallback';
import { SCRIPT_SYSTEM, simBrief, TAG_PALETTE } from './prompts';
import { DebateEventsSchema, lintEvents } from './schema';
import { estimateDurationMs, wordCount } from './spoken';
import { generateVerdict } from './verdict';

const SCRIPT_TIMEOUT_MS = 25000; // hidden behind the Monte Carlo loading screen; one retry must fit too

const Brief = z.object({ stats: z.array(z.string()), angle: z.string(), killer_line: z.string() });
const Line = z.object({
  round: z.number().int(),
  speaker: z.enum(['prosecution', 'defense', 'judge']),
  kind: z.enum(['speech', 'ai_interject']),
  flavor: z.string().describe('Interjection shout for ai_interject ("STOP RIGHT THERE!"); empty string for speech'),
  text: z.string(),
  tts: z.string(),
  cites: z.array(z.string()),
  reaction_target: z.enum(['prosecution', 'defense', 'judge', 'none']),
  reaction: z.enum(['idle', 'sweating', 'shocked', 'confident', 'breakdown']),
  music: z.enum(['tension', 'pursuit', 'calm', 'none']),
});
const ScriptSchema = z.object({
  briefs: z.object({
    prosecution: Brief,
    defense: Brief,
    judge: z.object({ questions: z.array(z.string()), fair_summary: z.string() }),
  }),
  lines: z.array(Line),
  elaborations: z.array(
    z.object({
      speaker: z.enum(['prosecution', 'defense']),
      round: z.number().int(),
      text: z.string(),
      tts: z.string(),
      cites: z.array(z.string()),
    }),
  ),
});
type Script = z.infer<typeof ScriptSchema>;

/** Content rules from the issue that the schema can't enforce. */
function checkScript(s: Script, findingIds: Set<string>): string[] {
  const problems: string[] = [];
  for (const [r, need] of [[1, 3], [2, 4], [3, 2]] as const) {
    if (s.lines.filter((l) => l.round === r).length < need) problems.push(`round ${r} needs at least ${need} lines`);
  }
  if (s.lines.some((l) => l.round < 1 || l.round > 3)) problems.push('rounds must be 1-3');
  const interjects = s.lines.filter((l) => l.kind === 'ai_interject');
  if (interjects.length < 2) problems.push('need 2 ai_interject lines in round 2 (one by each side)');
  s.lines.forEach((l, i) => {
    const tag = `line ${i + 1} (${l.speaker})`;
    if (wordCount(l.text) > 45) problems.push(`${tag} is ${wordCount(l.text)} words, max 35`);
    if (l.speaker !== 'judge' && !l.cites.some((c) => findingIds.has(c))) problems.push(`${tag} cites no valid finding id`);
    const allowed: readonly string[] = TAG_PALETTE[l.speaker];
    const bad = (l.tts.match(/\[[^\]]+\]/g) ?? []).filter((t) => !allowed.includes(t));
    if (bad.length) problems.push(`${tag} uses tags ${bad.join(' ')} not in its palette`);
    if (/\[[^\]]+\]/.test(l.text)) problems.push(`${tag} has audio tags in "text"`);
  });
  return problems;
}

const FLASH = { prosecution: 'flash_red', defense: 'flash_blue', judge: 'flash_white' } as const;

/** Script lines → the event queue C4 plays (effects/expressions/music are expanded deterministically). */
function toEvents(s: Script): DebateEvent[] {
  let n = 0;
  const id = () => `s${String(++n).padStart(2, '0')}`;
  const ev = (e: Omit<DebateEvent, 'id' | 'timestamp'>): DebateEvent => ({ id: id(), timestamp: 0, ...e });

  const out: DebateEvent[] = [ev({ type: 'music_change', music: 'calm' }), ev({ type: 'effect', effect: 'gavel' })];
  for (const l of s.lines) {
    const line = { speaker: l.speaker, round: l.round, text: l.text, tts: l.tts, cites: l.cites, durationMs: estimateDurationMs(l.text) };
    if (l.kind === 'ai_interject') {
      out.push(ev({ type: 'interrupt', interrupt_type: 'ai_interject', interrupt_flavor: l.flavor || 'OBJECTION!', ...line }));
      out.push(ev({ type: 'effect', effect: FLASH[l.speaker], round: l.round }), ev({ type: 'effect', effect: 'shake', round: l.round }));
    } else {
      out.push(ev({ type: 'speech', ...line }));
    }
    if (l.reaction_target !== 'none')
      out.push(ev({ type: 'expression_change', speaker: l.reaction_target, expression: l.reaction, round: l.round }));
    if (l.music !== 'none') out.push(ev({ type: 'music_change', music: l.music, round: l.round }));
  }
  return out;
}

function toElaborations(s: Script): Record<string, DebateEvent[]> {
  const out: Record<string, DebateEvent[]> = {};
  for (const e of s.elaborations) {
    out[`${e.speaker}-${e.round}`] = [
      { id: `x-${e.speaker}-${e.round}`, timestamp: 0, type: 'speech', speaker: e.speaker, round: e.round, text: e.text, tts: e.tts, cites: e.cites, durationMs: estimateDurationMs(e.text) },
    ];
  }
  return out;
}

async function writeScript(req: ScriptRequest, signal: AbortSignal): Promise<Script> {
  const ids = new Set(req.findings.map((f) => f.id));
  const messages: { role: 'user' | 'assistant'; content: string }[] = [
    { role: 'user', content: simBrief(req.decision, req.result, req.findings, req.sensitivity) },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await claude().messages.parse(
      {
        model: MODEL,
        max_tokens: 12000,
        system: SCRIPT_SYSTEM,
        output_config: { effort: 'low', format: zodOutputFormat(ScriptSchema) },
        messages,
      },
      { signal },
    );
    const script = res.parsed_output;
    const problems = script ? checkScript(script, ids) : [`no parsed output (stop_reason ${res.stop_reason})`];
    if (!problems.length && script) return script;
    console.warn(`[script] attempt ${attempt + 1} rejected:`, problems);
    // Retry once with the problems spelled out.
    messages.push(
      { role: 'assistant', content: JSON.stringify(script ?? {}) },
      { role: 'user', content: `That script breaks these rules:\n- ${problems.join('\n- ')}\nRewrite the whole script, fixing every problem.` },
    );
  }
  throw new Error('script failed validation twice');
}

export function cachedScript(): Omit<ScriptResponse, 'fallback'> {
  return {
    events: DebateEventsSchema.parse(mockEvents),
    elaborations: { ...(mockElaborations as Record<string, DebateEvent[]>), ...FIXED_LINES },
  };
}

export async function generateScript(req: ScriptRequest): Promise<ScriptResponse> {
  if (!hasClaudeKey()) return { ...cachedScript(), fallback: true };

  // Script and verdict don't depend on each other — write them in parallel.
  const [script, verdict] = await Promise.all([
    withFallback((signal) => writeScript(req, signal), null, SCRIPT_TIMEOUT_MS, 'script'),
    generateVerdict(req),
  ]);
  if (!script.value) return { ...cachedScript(), fallback: true };

  const events = [...toEvents(script.value), ...verdict.events];
  const problems = lintEvents(DebateEventsSchema.parse(events));
  if (problems.length) {
    console.warn('[script] expanded events failed lint:', problems);
    return { ...cachedScript(), fallback: true };
  }
  return { events, elaborations: { ...toElaborations(script.value), ...FIXED_LINES }, fallback: verdict.fallback };
}
