import type { VerdictRequest } from '@/types';
import { verdict } from '@/lib/debate/trial';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
export async function POST(request: Request) {
  const body = (await request.json()) as VerdictRequest;
  return Response.json(await verdict(body, request.signal));
}
