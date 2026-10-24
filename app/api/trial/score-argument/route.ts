import type { ScoreArgumentRequest } from '@/types';
import { scoreArgument } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as ScoreArgumentRequest;
  return Response.json(await scoreArgument(body));
}
