import { elevenlabs } from "@/lib/voice/client";

// POST multipart form with an `audio` file field (the onboarding recording, 45s+)
// → { voiceId, fallback }. Clones are named session_* so scripts/delete-clones.mjs can remove them.
// fallback: true (voiceId null) means "use the presenter voice": no key, recording too short, error or > 20s.
export async function POST(req: Request) {
  const audio = (await req.formData().catch(() => null))?.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "missing `audio` file field" }, { status: 400 });
  if (!elevenlabs || audio.size < 100_000) return Response.json({ voiceId: null, fallback: true });

  try {
    const voice = await elevenlabs.voices.ivc.create(
      {
        name: `session_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        files: [new File([audio], "onboarding.webm", { type: audio.type || "audio/webm" })],
        description: "Roulette onboarding clone — deleted after the session",
      },
      { timeoutInSeconds: 20, maxRetries: 0 },
    );
    return Response.json({ voiceId: voice.voiceId, fallback: false });
  } catch {
    return Response.json({ voiceId: null, fallback: true });
  }
}
