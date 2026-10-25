import { z } from "zod";
import type { UserProfile } from "@/types";
import { elevenlabs } from "@/lib/voice/client";
import { requireUser, unauthorized } from "@/lib/auth/server";
import { getUser, saveUser } from "@/lib/users/store";

const Head = z.object({ src: z.string().startsWith("data:image/").max(1_500_000) }).passthrough();
const Body = z.object({
  profile: z.record(z.string(), z.unknown()).default({}),
  voiceId: z.string().max(64).nullable().optional(),
  selfie: z.string().startsWith("data:image/").max(2_000_000).nullable().optional(),
  /** Both head cut-outs + their calibration (components/courtroom/heads.ts). */
  heads: z.object({ front: Head, side: Head.optional() }).nullable().optional(),
});

// POST { profile, voiceId?, selfie?, heads? } → { id } — keep the signed-in user's voice, face and
// profile ("Remember me"). Signed-in only: the row is keyed by their Supabase user id. Renames the
// session_* voice clone to user_<id> so scripts/delete-clones.mjs (which removes session_* after
// the demo) keeps it.
export async function POST(req: Request) {
  const user = await requireUser(req);
  if (!user) return unauthorized();
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { profile, voiceId, selfie, heads } = parsed.data;
  try {
    const before = await getUser(user.id);
    const saved = await saveUser({ id: user.id, profile: profile as UserProfile, voiceId: voiceId ?? null, selfie: selfie ?? heads?.front.src ?? null, heads: heads ?? null });
    if (elevenlabs) {
      const mine = `user_${saved}`;
      if (voiceId) {
        const voice = await elevenlabs.voices.get(voiceId).catch(() => null);
        if (voice?.name?.startsWith("session_")) await elevenlabs.voices.update(voiceId, { name: mine }).catch(() => {});
      }
      // Re-onboarding replaced their clone: delete the old one (only if it is theirs), or clones pile up.
      if (before?.voiceId && before.voiceId !== voiceId) {
        const old = await elevenlabs.voices.get(before.voiceId).catch(() => null);
        if (old?.name === mine) await elevenlabs.voices.delete(before.voiceId).catch(() => {});
      }
    }
    return Response.json({ id: saved });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
