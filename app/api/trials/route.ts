import { z } from "zod";
import type { Transcript } from "@/types";
import { saveTrial, storage } from "@/lib/share/store";

const Body = z.object({
  transcript: z
    .object({ question: z.string().min(1).max(500), lines: z.array(z.any()).max(400), sources: z.array(z.any()).max(200) })
    .passthrough(),
});

// POST { transcript } → { id, storage } — saves a finished trial for the share link /t/[id].
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  try {
    const id = await saveTrial(parsed.data.transcript as unknown as Transcript);
    return Response.json({ id, storage });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
