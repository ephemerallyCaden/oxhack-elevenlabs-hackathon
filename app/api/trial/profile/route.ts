import type { ProfileRequest } from '@/types';
import { extractProfile } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as ProfileRequest;
  return Response.json(await extractProfile(body));
}
