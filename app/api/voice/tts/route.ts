import { z } from "zod";
import { mockSpeech, synthesize } from "@/lib/voice/tts";
import { byok } from '@/lib/keys';

const VoiceRoleSchema = z.enum(["prosecution", "defense", "judge"]);

const Body = z
  .object({
    text: z.string().min(1).max(2000),
    speaker: VoiceRoleSchema.optional(),
    role: VoiceRoleSchema.optional(), // older name for `speaker`
    voiceId: z.string().optional(),
    // Voice lab only: try settings without editing lib/voice/configs.ts.
    voiceSettings: z
      .object({
        stability: z.number().min(0).max(1),
        similarityBoost: z.number().min(0).max(1),
        useSpeakerBoost: z.boolean().optional(),
      })
      .optional(),
  })
  .refine((b) => b.speaker ?? b.role, { message: "speaker is required" });

// POST TtsRequest (types.ts) → TtsResponse + alignment
async function handle(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { text, speaker, role, voiceId, voiceSettings } = parsed.data;
  try {
    return Response.json(await synthesize(text, (speaker ?? role)!, voiceId, voiceSettings));
  } catch (e) {
    // ElevenLabs down / out of credits: silent audio of the right length, so the trial keeps going.
    console.error(`[voice/tts] ElevenLabs failed, returning silent audio: ${(e as Error).message}`);
    return Response.json(mockSpeech(text));
  }
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
