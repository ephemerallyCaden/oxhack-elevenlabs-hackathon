import { elevenlabs, STT_MODEL } from "@/lib/voice/client";

const MOCK_TRANSCRIPT = "Should I quit my quant job in London to become a professional poker player?";
const KEYTERMS = ["poker", "quant", "Monte Carlo", "bankroll", "objection"];

// POST multipart form with `file` (audio blob) → { text, mock }
export async function POST(req: Request) {
  const file = (await req.formData().catch(() => null))?.get("file");
  if (!(file instanceof Blob)) return Response.json({ error: "missing audio `file`" }, { status: 400 });

  if (!elevenlabs) return Response.json({ text: MOCK_TRANSCRIPT, mock: true });

  const res = await elevenlabs.speechToText.convert({ file, modelId: STT_MODEL, keyterms: KEYTERMS });
  return Response.json({ text: "text" in res ? res.text : "", mock: false });
}
