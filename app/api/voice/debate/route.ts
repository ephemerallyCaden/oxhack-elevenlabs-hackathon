import { z } from "zod";
import type { Line } from "@/types";
import { voiceLines } from "@/lib/voice/debate";

const LineSchema = z
  .object({
    id: z.string(),
    speaker: z.enum(["prosecution", "defense", "judge", "user"]),
    kind: z.enum(["opening", "intro", "argument", "answer", "user", "agenda_change", "score", "verdict"]),
    text: z.string(),
    tts: z.string().optional(),
    cites: z.array(z.string()).default([]),
  })
  .passthrough();

const Body = z.object({ lines: z.array(LineSchema), voiceId: z.string().optional() });

// POST { lines: Line[], voiceId? } → { lines (with audioUrl + durationMs), fallback }.
// X-TTS-Characters = credits spent (0 when cached).
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });

  const { characters, ...res } = await voiceLines(parsed.data.lines as Line[], parsed.data.voiceId);
  return Response.json(res, { headers: { "X-TTS-Characters": String(characters) } });
}
