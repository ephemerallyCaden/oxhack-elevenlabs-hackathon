// Every external call goes through withFallback: slow or broken → mock, and the trial keeps going.

export async function withFallback<T>(
  work: (signal: AbortSignal) => Promise<T>,
  fallback: T | (() => T),
  ms: number,
  label = 'call',
): Promise<{ value: T; fallback: boolean }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  try {
    return { value: await Promise.race([work(controller.signal), timeout]), fallback: false };
  } catch (err) {
    console.warn(`[fallback] ${label}: ${(err as Error).message}`);
    return { value: typeof fallback === 'function' ? (fallback as () => T)() : fallback, fallback: true };
  } finally {
    clearTimeout(timer);
  }
}

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

let n = 0;
/** Short unique id with a readable prefix: uid('line') → 'line-k3x9-7'. */
export const uid = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(n++).toString(36)}`;

/** Rough speech length when there's no audio yet (~15 chars/s). */
export const estimateMs = (text: string) => Math.max(1500, Math.round(text.length * 65));
