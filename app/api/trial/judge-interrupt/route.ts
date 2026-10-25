import type { JudgeInterruptRequest } from '@/types';
import { judgeInterrupt } from '@/lib/debate/trial';

// request.signal: a client that gave up (timeout, a stopped trial) frees the model slot straight away.
export async function POST(request: Request) {
  const body = (await request.json()) as JudgeInterruptRequest;
  return Response.json(await judgeInterrupt(body, request.signal));
}
