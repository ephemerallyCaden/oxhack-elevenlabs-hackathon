import type { ParseRequest, ParseResponse } from '@/types';
import { parseDecision } from '@/lib/debate/parseDecision';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Partial<ParseRequest>;
  const result: ParseResponse = await parseDecision(body.transcript ?? '');
  return Response.json(result);
}
