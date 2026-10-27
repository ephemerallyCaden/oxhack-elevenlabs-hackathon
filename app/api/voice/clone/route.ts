import { elevenlabs, TTS_MODEL } from "@/lib/voice/client";
import { byok, usingOwnKey } from '@/lib/keys';
import { savedVoiceIds } from "@/lib/users/store";

// POST multipart form with an `audio` file field (the onboarding recording, 45s+)
// → { voiceId, fallback, error? }. Clones are named session_* so scripts/delete-clones.mjs can remove them.
// fallback: true (voiceId null) means "use the presenter voice". It is never silent: `error` says why
// (no key, too short, cloning failed, or ElevenLabs won't let the new clone speak) and it's logged.
// When the account's voice slots are full (30/30), it deletes the oldest unused session_* clone and
// tries once more (see freeSlot).

type El = NonNullable<ReturnType<typeof elevenlabs>>;

/** ElevenLabs SDK errors carry the useful text in body.detail.message. */
function reason(e: unknown): string {
  const err = e as { body?: { detail?: { message?: string } | string }; message?: string };
  const detail = err.body?.detail;
  return (typeof detail === "string" ? detail : detail?.message) ?? err.message ?? String(e);
}

/** "You have reached your maximum amount of custom voices (30 / 30)" (status voice_limit_reached). */
function slotsFull(e: unknown): boolean {
  const status = (e as { body?: { detail?: { status?: string } } }).body?.detail?.status;
  return status === "voice_limit_reached" || /maximum amount of custom voices|voice.?limit/i.test(reason(e));
}

const sessionName = (ms: number) => `session_${new Date(ms).toISOString().replace(/[:.]/g, "-")}`;

/** Deletes the oldest session_* clone that no saved user owns and that is over an hour old (a newer one
 *  may be voicing a trial right now). False when there's none, or the saved users can't be read. */
async function freeSlot(el: El): Promise<boolean> {
  try {
    const [keep, { voices }] = await Promise.all([
      savedVoiceIds(),
      el.voices.search({ voiceType: "personal", pageSize: 100 }, { timeoutInSeconds: 10, maxRetries: 0 }),
    ]);
    const cutoff = sessionName(Date.now() - 60 * 60_000); // same format, so names compare as times
    const oldest = voices
      .filter((v) => v.name?.startsWith("session_") && v.name < cutoff && !keep.has(v.voiceId))
      .sort((a, b) => a.name!.localeCompare(b.name!))[0];
    if (!oldest) return false;
    await el.voices.delete(oldest.voiceId, { timeoutInSeconds: 10, maxRetries: 0 });
    console.warn(`[voice/clone] voice slots full: deleted the oldest unused clone ${oldest.name}`);
    return true;
  } catch (e) {
    console.error("[voice/clone] voice slots full and couldn't free one:", e);
    return false;
  }
}

function fallback(error: string, status = 200) {
  console.error(`[voice/clone] falling back to the presenter voice: ${error}`);
  return Response.json({ voiceId: null, fallback: true, error }, { status });
}

async function handle(req: Request) {
  const el = elevenlabs(); // this request's key (lib/keys.ts)
  const audio = (await req.formData().catch(() => null))?.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "missing `audio` file field" }, { status: 400 });
  if (!el) return fallback("ElevenLabs isn't configured (no API key).");
  if (audio.size < 100_000) return fallback("The recording was too short to clone (it needs about 45 seconds).");

  const create = async () =>
    (
      await el.voices.ivc.create(
        {
          name: sessionName(Date.now()),
          files: [new File([audio], "onboarding.webm", { type: audio.type || "audio/webm" })],
          description: "Roulette onboarding clone — deleted after the session",
        },
        { timeoutInSeconds: 20, maxRetries: 0 },
      )
    ).voiceId;

  let voiceId: string;
  try {
    voiceId = await create();
  } catch (e) {
    // Only the house account is swept: a visitor's own key is their account, not ours to clean.
    if (!slotsFull(e) || usingOwnKey("elevenlabs") || !(await freeSlot(el))) return fallback(`Voice cloning failed: ${reason(e)}`);
    try {
      voiceId = await create();
    } catch (e2) {
      return fallback(`Voice cloning failed: ${reason(e2)}`);
    }
  }

  // One-word probe: a clone that can't speak would make every trial line fall back later.
  try {
    const stream = await el.textToSpeech.convert(voiceId, { text: "Hi.", modelId: TTS_MODEL }, { timeoutInSeconds: 10, maxRetries: 0 });
    const reader = stream.getReader(); // consume immediately (SDK GC gotcha)
    while (!(await reader.read()).done);
  } catch (e) {
    // The clone is unusable, so it's deleted (it would only take a voice slot), but never silently.
    await el.voices.delete(voiceId).catch(() => {});
    return fallback(`ElevenLabs won't use this voice clone: ${reason(e)}`);
  }
  return Response.json({ voiceId, fallback: false });
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
