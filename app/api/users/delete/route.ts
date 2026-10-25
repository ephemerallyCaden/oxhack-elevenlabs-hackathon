import { z } from "zod";
import { elevenlabs } from "@/lib/voice/client";
import { deleteUser } from "@/lib/users/store";

// POST { id } → { deleted } — "Forget me": removes the stored profile + selfie and deletes their
// voice clone at ElevenLabs (only clones we made for users, never the presenter/backup voice).
export async function POST(req: Request) {
  const parsed = z.object({ id: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "missing id" }, { status: 400 });
  const user = await deleteUser(parsed.data.id);
  if (user?.voiceId && elevenlabs) {
    const voice = await elevenlabs.voices.get(user.voiceId).catch(() => null);
    if (voice?.name?.startsWith("user_") || voice?.name?.startsWith("session_")) await elevenlabs.voices.delete(user.voiceId).catch(() => {});
  }
  return Response.json({ deleted: !!user });
}
