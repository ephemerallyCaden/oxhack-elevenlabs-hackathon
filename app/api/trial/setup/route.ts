import type { SetupRequest } from '@/types';
import { buildSetup } from '@/lib/debate/trial';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
export async function POST(request: Request) {
  const body = (await request.json()) as SetupRequest;
  return Response.json(await buildSetup(body, request.signal));
}
