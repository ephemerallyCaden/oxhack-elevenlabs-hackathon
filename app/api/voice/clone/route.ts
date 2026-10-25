import { elevenlabs, TTS_MODEL } from "@/lib/voice/client";

// POST multipart form with an `audio` file field (the onboarding recording, 45s+)
// → { voiceId, fallback, error? }. Clones are named session_* so scripts/delete-clones.mjs can remove them.
// fallback: true (voiceId null) means "use the presenter voice". It is never silent: `error` says why
// (no key, too short, cloning failed, or ElevenLabs won't let the new clone speak) and it's logged.

/** ElevenLabs SDK errors carry the useful text in body.detail.message. */
function reason(e: unknown): string {
  const err = e as { body?: { detail?: { message?: string } | string }; message?: string };
  const detail = err.body?.detail;
  return (typeof detail === "string" ? detail : detail?.message) ?? err.message ?? String(e);
}

function fallback(error: string, status = 200) {
  console.error(`[voice/clone] falling back to the presenter voice: ${error}`);
  return Response.json({ voiceId: null, fallback: true, error }, { status });
}

export async function POST(req: Request) {
  const audio = (await req.formData().catch(() => null))?.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "missing `audio` file field" }, { status: 400 });
  if (!elevenlabs) return fallback("ElevenLabs isn't configured (no API key).");
  if (audio.size < 100_000) return fallback("The recording was too short to clone (it needs about 45 seconds).");

  let voiceId: string;
  try {
    const voice = await elevenlabs.voices.ivc.create(
      {
        name: `session_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        files: [new File([audio], "onboarding.webm", { type: audio.type || "audio/webm" })],
        description: "Roulette onboarding clone — deleted after the session",
      },
      { timeoutInSeconds: 20, maxRetries: 0 },
    );
    voiceId = voice.voiceId;
  } catch (e) {
    return fallback(`Voice cloning failed: ${reason(e)}`);
  }

  // One-word probe: a clone that can't speak would make every trial line fall back later.
  try {
    const stream = await elevenlabs.textToSpeech.convert(voiceId, { text: "Hi.", modelId: TTS_MODEL }, { timeoutInSeconds: 10, maxRetries: 0 });
    const reader = stream.getReader(); // consume immediately (SDK GC gotcha)
    while (!(await reader.read()).done);
  } catch (e) {
    // The clone is unusable, so it's deleted (it would only take a voice slot), but never silently.
    await elevenlabs.voices.delete(voiceId).catch(() => {});
    return fallback(`ElevenLabs won't use this voice clone: ${reason(e)}`);
  }
  return Response.json({ voiceId, fallback: false });
}
