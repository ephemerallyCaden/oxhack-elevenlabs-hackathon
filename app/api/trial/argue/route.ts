import type { ArgueRequest } from '@/types';
import { argue } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as ArgueRequest;
  return Response.json(await argue(body));
}
