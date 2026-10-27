import { elevenlabs } from "@/lib/voice/client";
import { byok } from '@/lib/keys';

// POST { voiceId } → { deleted }. Onboarding's "Redo" throws away the clone it just made, so redos
// don't pile up in the account's limited voice slots. Anonymous like every route here (no accounts),
// so it only ever deletes onboarding clones (named session_* by /api/voice/clone), never the
// presenter/backup voices or anything else in the account.

const PROTECTED = new Set([process.env.ELEVENLABS_VOICE_ID, process.env.ELEVENLABS_BACKUP_VOICE_ID].filter(Boolean));

async function handle(req: Request) {
  const el = elevenlabs(); // this request's key (lib/keys.ts)
  const { voiceId } = ((await req.json().catch(() => null)) ?? {}) as { voiceId?: unknown };
  if (typeof voiceId !== "string" || !/^[A-Za-z0-9]{10,40}$/.test(voiceId)) {
    return Response.json({ error: "missing or invalid `voiceId`" }, { status: 400 });
  }
  if (PROTECTED.has(voiceId)) return Response.json({ error: "not an onboarding clone" }, { status: 403 });
  if (!el) return Response.json({ deleted: false });

  try {
    const voice = await el.voices.get(voiceId, undefined, { timeoutInSeconds: 10, maxRetries: 0 });
    if (!voice.name?.startsWith("session_")) return Response.json({ error: "not an onboarding clone" }, { status: 403 });
    await el.voices.delete(voiceId, { timeoutInSeconds: 10, maxRetries: 0 });
    return Response.json({ deleted: true });
  } catch (e) {
    // Already gone, or ElevenLabs is down: the redo carries on either way; scripts/delete-clones.mjs sweeps leftovers.
    console.error(`[voice/clone/delete] couldn't delete ${voiceId}:`, e);
    return Response.json({ deleted: false });
  }
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
