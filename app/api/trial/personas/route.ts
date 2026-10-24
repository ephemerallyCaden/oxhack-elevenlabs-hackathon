import type { PersonasRequest } from '@/types';
import { buildPersonas } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as PersonasRequest;
  return Response.json(await buildPersonas(body));
}
