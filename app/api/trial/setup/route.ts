import type { SetupRequest } from '@/types';
import { buildSetup } from '@/lib/debate/trial';
import { byok } from '@/lib/keys';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
async function handle(request: Request) {
  const body = (await request.json()) as SetupRequest;
  return Response.json(await buildSetup(body, request.signal));
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
