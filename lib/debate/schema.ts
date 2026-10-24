// Zod mirror of DebateEvent (types.ts) — used to validate Claude output, the mock and the demo cache.
import { z } from 'zod';
import type { DebateEvent } from '@/types';

export const RoleSchema = z.enum(['prosecution', 'defense', 'judge', 'user']);
export const ExpressionSchema = z.enum(['idle', 'talking', 'sweating', 'shocked', 'confident', 'breakdown']);
export const MusicSchema = z.enum(['calm', 'tension', 'pursuit', 'verdict', 'none']);

export const DebateEventSchema = z.object({
  id: z.string(),
  timestamp: z.number(),
  type: z.enum(['speech', 'interrupt', 'effect', 'music_change', 'expression_change', 'verdict']),
  speaker: RoleSchema.optional(),
  text: z.string().optional(),
  tts: z.string().optional(),
  audioUrl: z.string().optional(),
  durationMs: z.number().optional(),
  round: z.number().int().min(1).max(3).optional(),
  interrupt_type: z.enum(['user_challenge', 'elaborate', 'skip', 'ai_interject']).optional(),
  interrupt_flavor: z.string().optional(),
  effect: z.enum(['flash_white', 'flash_red', 'flash_blue', 'shake', 'gavel']).optional(),
  expression: ExpressionSchema.optional(),
  music: MusicSchema.optional(),
  verdict: z
    .object({
      winner: z.enum(['change', 'status_quo']),
      winner_label: z.string(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
      flip_line: z.string(),
    })
    .optional(),
  cites: z.array(z.string()).optional(),
});

export const DebateEventsSchema = z.array(DebateEventSchema);

// Compile-time check that the schema and the shared type agree.
type Schema = z.infer<typeof DebateEventSchema>;
const _toType = (e: Schema): DebateEvent => e;
const _toSchema = (e: DebateEvent): Schema => e;
void _toType;
void _toSchema;

/** Rules every playable script must follow, beyond shape. Returns a list of problems (empty = OK). */
export function lintEvents(events: DebateEvent[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const e of events) {
    if (ids.has(e.id)) problems.push(`duplicate id ${e.id}`);
    ids.add(e.id);
    const spoken = e.type === 'speech' || e.type === 'interrupt' || e.type === 'verdict';
    if (spoken && (!e.speaker || !e.text)) problems.push(`${e.id}: ${e.type} needs speaker + text`);
    if (e.type === 'interrupt' && !e.interrupt_type) problems.push(`${e.id}: interrupt needs interrupt_type`);
    if (e.type === 'effect' && !e.effect) problems.push(`${e.id}: effect needs effect`);
    if (e.type === 'music_change' && !e.music) problems.push(`${e.id}: music_change needs music`);
    if (e.type === 'expression_change' && (!e.speaker || !e.expression))
      problems.push(`${e.id}: expression_change needs speaker + expression`);
    if (e.type === 'verdict' && !e.verdict) problems.push(`${e.id}: verdict needs verdict payload`);
  }
  if (!events.some((e) => e.type === 'verdict')) problems.push('no verdict event');
  return problems;
}
