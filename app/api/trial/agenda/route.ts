import type { AgendaRequest } from '@/types';
import { buildAgenda } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as AgendaRequest;
  return Response.json(await buildAgenda(body.question ?? ''));
}
