import { elevenlabs } from "@/lib/voice/client";
import { authAvailable, authUnavailable, requireUser, unauthorized } from "@/lib/auth/server";
import { deleteUser } from "@/lib/users/store";
import { invalidateJury, juryKey } from "@/lib/users/jury";

// POST → { deleted, juryKey } — "Forget me": removes the signed-in user's stored profile + faces and
// deletes their voice clone at ElevenLabs (only the clone named for them, never the presenter/backup
// voice). A failed delete is a 500, never a "forgotten". `juryKey` lets the browser drop the face from
// the jury at once (other server instances may cache it for up to a minute).
export async function POST(req: Request) {
  if (!authAvailable()) return authUnavailable();
  const me = await requireUser(req);
  if (!me) return unauthorized();
  let user;
  try {
    user = await deleteUser(me.id);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
  invalidateJury();
  if (user?.voiceId && elevenlabs) {
    const voice = await elevenlabs.voices.get(user.voiceId).catch(() => null);
    if (voice?.name === `user_${me.id}`) await elevenlabs.voices.delete(user.voiceId).catch(() => {}); // only their own clone
  }
  return Response.json({ deleted: !!user, juryKey: juryKey(me.id) });
}
