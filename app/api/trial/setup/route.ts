import type { SetupRequest } from '@/types';
import { buildSetup } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as SetupRequest;
  return Response.json(await buildSetup(body));
}
