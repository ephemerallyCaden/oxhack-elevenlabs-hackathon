import { elevenlabs } from "@/lib/voice/client";

// POST { voiceId } → { deleted }. Onboarding's "Redo" throws away the clone it just made, so redos
// don't pile up in the account's limited voice slots. Anonymous like every route here (no accounts),
// so it only ever deletes onboarding clones (named session_* by /api/voice/clone), never the
// presenter/backup voices or anything else in the account.

const PROTECTED = new Set([process.env.ELEVENLABS_VOICE_ID, process.env.ELEVENLABS_BACKUP_VOICE_ID].filter(Boolean));

export async function POST(req: Request) {
  const { voiceId } = ((await req.json().catch(() => null)) ?? {}) as { voiceId?: unknown };
  if (typeof voiceId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    return Response.json({ error: "missing or invalid `voiceId`" }, { status: 400 });
  }
  if (PROTECTED.has(voiceId)) return Response.json({ error: "not an onboarding clone" }, { status: 403 });
  if (!elevenlabs) return Response.json({ deleted: false });

  try {
    const voice = await elevenlabs.voices.get(voiceId, undefined, { timeoutInSeconds: 10, maxRetries: 0 });
    if (!voice.name?.startsWith("session_")) return Response.json({ error: "not an onboarding clone" }, { status: 403 });
    await elevenlabs.voices.delete(voiceId, { timeoutInSeconds: 10, maxRetries: 0 });
    return Response.json({ deleted: true });
  } catch (e) {
    // Already gone, or ElevenLabs is down: the redo carries on either way; scripts/delete-clones.mjs sweeps leftovers.
    console.error(`[voice/clone/delete] couldn't delete ${voiceId}:`, e);
    return Response.json({ deleted: false });
  }
}
