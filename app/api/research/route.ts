import type { ResearchRequest, ResearchResponse } from '@/types';
import { mockCards } from '@/lib/debate/mock';

export async function POST(request: Request) {
  const body = (await request.json()) as ResearchRequest;
  const cards = mockCards(body);
  return Response.json({ cards, fallback: true } satisfies ResearchResponse);
}
