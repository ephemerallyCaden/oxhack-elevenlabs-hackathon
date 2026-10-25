import { z } from "zod";
import type { UserProfile } from "@/types";
import { elevenlabs } from "@/lib/voice/client";
import { saveUser } from "@/lib/users/store";

const Body = z.object({
  id: z.string().max(64).optional(),
  profile: z.record(z.string(), z.unknown()).default({}),
  voiceId: z.string().max(64).nullable().optional(),
  selfie: z.string().startsWith("data:image/").max(2_000_000).nullable().optional(),
});

// POST { id?, profile, voiceId?, selfie? } → { id } — "Remember me". Renames the session_* voice
// clone to user_<id> so scripts/delete-clones.mjs (which removes session_* after the demo) keeps it.
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { id, profile, voiceId, selfie } = parsed.data;
  try {
    const saved = await saveUser({ id, profile: profile as UserProfile, voiceId: voiceId ?? null, selfie: selfie ?? null });
    if (voiceId && elevenlabs) {
      const voice = await elevenlabs.voices.get(voiceId).catch(() => null);
      if (voice?.name?.startsWith("session_")) await elevenlabs.voices.update(voiceId, { name: `user_${saved}` }).catch(() => {});
    }
    return Response.json({ id: saved });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
