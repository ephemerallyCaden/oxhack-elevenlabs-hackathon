import type { ScriptRequest } from '@/types';
import { cachedScript, generateScript } from '@/lib/debate/generateScript';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ScriptRequest | null;
  if (!body?.decision || !body.result || !body.findings) return Response.json({ ...cachedScript(), fallback: true });
  return Response.json(await generateScript(body));
}
