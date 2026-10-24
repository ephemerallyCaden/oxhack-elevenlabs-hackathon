import type { VerdictRequest } from '@/types';
import { verdict } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as VerdictRequest;
  return Response.json(await verdict(body));
}
