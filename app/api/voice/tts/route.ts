import { z } from "zod";
import { synthesize } from "@/lib/voice/tts";

const Body = z.object({
  text: z.string().min(1).max(2000),
  role: z.enum(["prosecution", "defense", "judge"]),
  voiceId: z.string().optional(),
});

// POST { text, role, voiceId? } → TtsResult (base64 audio + duration + character timings)
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { text, role, voiceId } = parsed.data;
  return Response.json(await synthesize(text, role, voiceId));
}
