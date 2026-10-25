import { elevenlabs, TTS_MODEL } from "@/lib/voice/client";

// POST multipart form with an `audio` file field (the onboarding recording, 45s+)
// → { voiceId, fallback }. Clones are named session_* so scripts/delete-clones.mjs can remove them.
// fallback: true (voiceId null) means "use the presenter voice": no key, recording too short, error,
// > 20s, or ElevenLabs won't let the new clone speak (e.g. flagged "requires verification").
export async function POST(req: Request) {
  const audio = (await req.formData().catch(() => null))?.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "missing `audio` file field" }, { status: 400 });
  if (!elevenlabs || audio.size < 100_000) return Response.json({ voiceId: null, fallback: true });

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
  } catch {
    return Response.json({ voiceId: null, fallback: true });
  }

  // One-word probe: a clone that can't speak would make every trial line fall back later.
  try {
    const stream = await elevenlabs.textToSpeech.convert(voiceId, { text: "Hi.", modelId: TTS_MODEL }, { timeoutInSeconds: 10, maxRetries: 0 });
    const reader = stream.getReader(); // consume immediately (SDK GC gotcha)
    while (!(await reader.read()).done);
  } catch {
    await elevenlabs.voices.delete(voiceId).catch(() => {});
    return Response.json({ voiceId: null, fallback: true });
  }
  return Response.json({ voiceId, fallback: false });
}
