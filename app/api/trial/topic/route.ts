import type { TopicRequest } from '@/types';
import { writeTopic } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as TopicRequest;
  return Response.json(await writeTopic(body));
}
