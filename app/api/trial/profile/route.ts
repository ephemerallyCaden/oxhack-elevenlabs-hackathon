import type { ProfileRequest } from '@/types';
import { extractProfile } from '@/lib/debate/trial';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ProfileRequest;
  return Response.json(await extractProfile(body, request.signal));
}
