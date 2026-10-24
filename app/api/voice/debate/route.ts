import { z } from "zod";
import { DebateEventsSchema } from "@/lib/debate/schema";
import { voiceDebate } from "@/lib/voice/debate";

const Body = z.object({
  events: DebateEventsSchema,
  elaborations: z.record(z.string(), DebateEventsSchema).default({}),
  voiceId: z.string().optional(),
});

// POST VoiceDebateRequest (types.ts) → VoiceDebateResponse. X-TTS-Characters = credits spent (0 when cached).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { characters, ...res } = await voiceDebate(parsed.data);
  return Response.json(res, { headers: { "X-TTS-Characters": String(characters) } });
}
