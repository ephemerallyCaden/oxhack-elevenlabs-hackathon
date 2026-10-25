// The browser only lets audio start after a user gesture, and engine.unlock() (AudioContext.resume)
// can hang without one or reject (Safari). Never let it block the trial: give up after `ms`.
export function unlockSoon(unlock: () => Promise<unknown>, ms = 1500): Promise<boolean> {
  return Promise.race([unlock().then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}
