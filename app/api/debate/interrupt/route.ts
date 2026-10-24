import type { InterruptRequest } from '@/types';
import { handleInterrupt } from '@/lib/debate/interrupt';

export async function POST(request: Request) {
  const body = (await request.json()) as InterruptRequest;
  return Response.json(await handleInterrupt(body, new URL(request.url).origin));
}
