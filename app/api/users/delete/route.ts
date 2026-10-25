import { elevenlabs } from "@/lib/voice/client";
import { authAvailable, authUnavailable, requireUser, unauthorized } from "@/lib/auth/server";
import { deleteUser } from "@/lib/users/store";
import { invalidateJury } from "@/lib/users/jury";

// POST → { deleted } — "Forget me": removes the signed-in user's stored profile + faces and deletes
// their voice clone at ElevenLabs (only the clone named for them, never the presenter/backup voice).
export async function POST(req: Request) {
  if (!authAvailable()) return authUnavailable();
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const user = await deleteUser(me.id);
  invalidateJury();
  if (user?.voiceId && elevenlabs) {
    const voice = await elevenlabs.voices.get(user.voiceId).catch(() => null);
    if (voice?.name === `user_${me.id}`) await elevenlabs.voices.delete(user.voiceId).catch(() => {}); // only their own clone
  }
  return Response.json({ deleted: !!user });
}
