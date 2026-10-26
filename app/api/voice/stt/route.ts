import type { SttResponse } from "@/types";
import { elevenlabs, STT_MODEL } from "@/lib/voice/client";
import { byok } from '@/lib/keys';

const MOCK_TRANSCRIPT = "Should I quit my quant job in London to become a professional poker player?";
const KEYTERMS = ["poker", "quant", "Monte Carlo", "bankroll", "objection"];

// POST multipart form with an `audio` file field → SttResponse (types.ts)
async function handle(req: Request) {
  const el = elevenlabs(); // this request's key (lib/keys.ts)
  const audio = (await req.formData().catch(() => null))?.get("audio");
  if (!(audio instanceof Blob)) return Response.json({ error: "missing `audio` file field" }, { status: 400 });

  if (!el) return Response.json({ transcript: MOCK_TRANSCRIPT, fallback: true } satisfies SttResponse);

  // tagAudioEvents off: we want only words (no "(laughs)"), for user input and for the voice lab's tag check.
  const res = await el.speechToText.convert({ file: audio, modelId: STT_MODEL, keyterms: KEYTERMS, tagAudioEvents: false });
  return Response.json({ transcript: "text" in res ? res.text : "", fallback: false } satisfies SttResponse);
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
