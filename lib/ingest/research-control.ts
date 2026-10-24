/** Absolute wall-clock bound, including queued work. Cancellation is cooperative. */
export class ResearchDeadlineError extends Error {}

export async function withinDeadline<T>(work: (signal: AbortSignal) => Promise<T>, ms: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(1, ms));
  let rejectAbort!: () => void;
  try {
    if (parent?.aborted || ms <= 0) controller.abort();
    if (controller.signal.aborted) throw new ResearchDeadlineError("Research deadline or cancellation");
    const stopped = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(new ResearchDeadlineError("Research deadline or cancellation"));
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return work(controller.signal);
    }), stopped]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", abort);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
  }
}

/** Bounded queue; reserve capacity for quick calls. Occupied work retains its slot
 * until it actually settles, even if the waiting HTTP request has timed out. */
export function createResearchQueue(limit: number) {
  type Entry = { tier: "quick" | "deep"; started: boolean; start: () => void; cancel: () => void };
  const queued: Entry[] = [];
  let active = 0, deep = 0;
  function pump() {
    queued.sort((a, b) => Number(a.tier === "deep") - Number(b.tier === "deep"));
    while (active < limit) {
      const index = queued.findIndex(entry => entry.tier === "quick" || deep < Math.max(1, limit - 1));
      if (index < 0) return;
      queued.splice(index, 1)[0].start();
    }
  }
  return {
    schedule<T>(work: () => Promise<T>, tier: "quick" | "deep", signal: AbortSignal) {
      let entry: Entry;
      const promise = new Promise<T>((resolve, reject) => {
        if (signal.aborted || queued.length >= 32) { reject(new Error("Research queue unavailable")); return; }
        entry = { tier, started: false,
          cancel: () => {
            const index = queued.indexOf(entry);
            if (index >= 0) queued.splice(index, 1);
            signal.removeEventListener("abort", entry.cancel);
            reject(new Error("Research cancelled while queued"));
          },
          start: () => {
            entry.started = true;
            signal.removeEventListener("abort", entry.cancel);
            const wasDeep = entry.tier === "deep";
            active++; if (wasDeep) deep++;
            Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject).finally(() => {
              active--; if (wasDeep) deep--; pump();
            });
          },
        };
        signal.addEventListener("abort", entry.cancel, { once: true });
        queued.push(entry); pump();
      });
      return { promise, promote: () => { if (entry && !entry.started) { entry.tier = "quick"; pump(); } } };
    },
  };
}
