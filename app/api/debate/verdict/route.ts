import type { VerdictRequest, VerdictResponse } from '@/types';
import { generateVerdict } from '@/lib/debate/verdict';

export async function POST(request: Request) {
  const body = (await request.json()) as VerdictRequest;
  // Fresh id prefix so re-ruled verdict events don't collide with the script's default verdict.
  const result: VerdictResponse = await generateVerdict(body, `v${Date.now().toString(36)}`, 5000);
  return Response.json(result);
}
