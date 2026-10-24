import type { JudgeInterruptRequest } from '@/types';
import { judgeInterrupt } from '@/lib/debate/trial';

export async function POST(request: Request) {
  const body = (await request.json()) as JudgeInterruptRequest;
  return Response.json(await judgeInterrupt(body));
}
