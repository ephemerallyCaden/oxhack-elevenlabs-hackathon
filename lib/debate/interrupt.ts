// D5: the user objects out loud → the right future self answers in character, citing a number.
// Budget ≤ 4s total (Claude ~2-3s + one TTS clip). > 5s → the rehearsed fallback reply.
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { DebateEvent, InterruptRequest, InterruptResponse, TtsResponse } from '@/types';
import { claude, hasClaudeKey, MODEL } from './claude';
import { FALLBACK_INTERRUPT_REPLY, FIXED_LINES, postJson, withFallback } from './fallback';
import { INTERRUPT_SYSTEM } from './prompts';
import { estimateDurationMs } from './spoken';

const ReplySchema = z.object({
  relevant: z.boolean(),
  responder: z.enum(['prosecution', 'defense', 'judge']),
  text: z.string(),
  tts: z.string(),
  cites: z.array(z.string()),
});

const fallbackResponse = (): InterruptResponse => ({
  relevant: true,
  responder: 'prosecution',
  events: [FALLBACK_INTERRUPT_REPLY, { id: 'fallback-music', timestamp: 0, type: 'music_change', music: 'pursuit' }],
  fallback: true,
});

async function live(req: InterruptRequest, origin: string, signal: AbortSignal): Promise<InterruptResponse> {
  const { context } = req;
  const res = await claude().messages.parse(
    {
      model: MODEL,
      max_tokens: 2000,
      system: INTERRUPT_SYSTEM,
      output_config: { effort: 'low', format: zodOutputFormat(ReplySchema) },
      messages: [
        {
          role: 'user',
          content: `DECISION: should the witness ${context.decision.summary}?
Option A (change, argued by prosecution): ${context.decision.options[0]}
Option B (status quo, argued by defense): ${context.decision.options[1]}
Round: ${context.round} of 3

LAST LINES:
${context.recentLines.map((l) => `${l.speaker?.toUpperCase()}: ${l.text}`).join('\n') || '(debate just started)'}

FINDINGS:
${context.findings.map((f) => `- ${f.id} [${f.side}] ${f.statement} | spoken: "${f.spoken}"`).join('\n')}

THE WITNESS SHOUTS OBJECTION AND SAYS: "${req.transcript}"`,
        },
      ],
    },
    { signal },
  );
  const r = res.parsed_output;
  if (!r) throw new Error(`no parsed output (stop_reason ${res.stop_reason})`);

  if (!r.relevant) return { relevant: false, responder: 'judge', events: FIXED_LINES['judge-penalty'], fallback: false };

  const reply: DebateEvent = {
    id: `live-${Date.now().toString(36)}`,
    timestamp: 0,
    type: 'speech',
    speaker: r.responder,
    round: context.round,
    text: r.text,
    tts: r.tts,
    cites: r.cites,
    durationMs: estimateDurationMs(r.text),
  };
  // Voice it via B2's route. If voice isn't up yet, play text-only rather than fail.
  try {
    const tts = await postJson<TtsResponse>(`${origin}/api/voice/tts`, { text: r.tts, role: r.responder }, signal);
    reply.audioUrl = tts.audioUrl;
    reply.durationMs = tts.durationMs;
  } catch (err) {
    if (signal.aborted) throw err;
    console.warn('[interrupt] tts failed, text only:', (err as Error).message);
  }
  return { relevant: true, responder: r.responder, events: [reply], fallback: false };
}

export async function handleInterrupt(req: InterruptRequest, origin: string): Promise<InterruptResponse> {
  if (!hasClaudeKey() || !req.transcript?.trim()) return fallbackResponse();
  const { value } = await withFallback((signal) => live(req, origin, signal), fallbackResponse, 5000, 'interrupt');
  return value;
}
