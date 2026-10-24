import type { ScoreTopicRequest } from '@/types';
import { scoreTopic } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as ScoreTopicRequest;
  return Response.json(await scoreTopic(body));
}
