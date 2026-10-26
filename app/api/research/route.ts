import { researchRequestSchema } from "@/lib/ingest/research-contract";
import { createResearchAgent } from "@/lib/ingest/research-agent";
import { withinDeadline } from "@/lib/ingest/research-control";
import { readBoundedModelJson } from "@/lib/ingest/model-client";
import type { ResearchResponse } from "@/types";
import { byok, houseKeysOn, mockRequested, usingOwnKey } from '@/lib/keys';

// cacheComponents uses Node.js by default; an explicit runtime export is unsupported.
export const maxDuration = 60;
const agent = createResearchAgent();

async function handle(request: Request) {
  // Research only ever runs on the house keys (lib/ingest reads them from .env): never in mock mode, never
  // with HOUSE_KEYS=off, and not for a visitor who brought their own keys (it would spend ours for them).
  const own = usingOwnKey('groq') || usingOwnKey('gemini') || usingOwnKey('anthropic');
  if (mockRequested() || !houseKeysOn() || own) return Response.json({ cards: [], fallback: true } satisfies ResearchResponse);
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

// In the request's key context (lib/keys.ts), to know whether research may run at all.
export const POST = byok(handle);
