import { z } from "zod";
import { synthesize } from "@/lib/voice/tts";

const Body = z.object({
  text: z.string().min(1).max(2000),
  role: z.enum(["prosecution", "defense", "judge"]),
  voiceId: z.string().optional(),
  // Voice lab only: try settings without editing lib/voice/configs.ts.
  voiceSettings: z
    .object({
      stability: z.number().min(0).max(1),
      similarityBoost: z.number().min(0).max(1),
      style: z.number().min(0).max(1).optional(),
      speed: z.number().min(0.7).max(1.2).optional(),
      useSpeakerBoost: z.boolean().optional(),
    })
    .optional(),
});

// POST TtsRequest (types.ts) → TtsResponse + alignment
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { text, role, voiceId, voiceSettings } = parsed.data;
  return Response.json(await synthesize(text, role, voiceId, voiceSettings));
}
