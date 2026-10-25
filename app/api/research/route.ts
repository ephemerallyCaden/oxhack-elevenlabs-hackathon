import { researchRequestSchema } from "@/lib/ingest/research-contract";
import { createResearchAgent } from "@/lib/ingest/research-agent";
import { withinDeadline } from "@/lib/ingest/research-control";
import { readBoundedModelJson } from "@/lib/ingest/model-client";
import type { ResearchResponse } from "@/types";

// cacheComponents uses Node.js by default; an explicit runtime export is unsupported.
export const maxDuration = 60;
const agent = createResearchAgent();

export async function POST(request: Request) {
  const started = Date.now();
  try {
    const body = await withinDeadline(signal => readBoundedModelJson(new Response(request.body), signal, 16000), 1000, request.signal);
    const parsed = researchRequestSchema.safeParse(body);
    if (!parsed.success) return Response.json({ error: "Invalid research request" }, { status: 400 });
    const result = await agent.run(parsed.data, { signal: request.signal, elapsedMs: Date.now() - started });
    return Response.json(result satisfies ResearchResponse);
  } catch {
    return Response.json({ error: "Research input is invalid, too large, cancelled or too slow" }, { status: 400 });
  }
}
