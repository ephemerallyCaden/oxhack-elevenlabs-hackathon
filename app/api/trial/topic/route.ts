import type { TopicRequest } from '@/types';
import { writeTopic } from '@/lib/debate/trial';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
export async function POST(request: Request) {
  const body = (await request.json()) as TopicRequest;
  return Response.json(await writeTopic(body, request.signal));
}
