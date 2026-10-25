// Trials saved from this laptop (the verdict screen's "Save & share"), for the menu's
// "Watch a past trial". Shared trials are deleted after 7 days, so older entries are dropped.
export type PastTrial = { id: string; question: string; value: number; label: string; at: number };

/** Which side the court found for, from its spectrum label ("Strong yes", "Lean no", "Toss-up"). */
export function verdictSide(label: string): 'yes' | 'no' | null {
  return /\byes\b/i.test(label) ? 'yes' : /\bno\b/i.test(label) ? 'no' : null;
}

const KEY = 'roulette.trials';
const WEEK = 7 * 24 * 3600 * 1000;

export function parsePastTrials(raw: string): PastTrial[] {
  try {
    return (JSON.parse(raw) as PastTrial[]).filter((t) => t && t.id);
  } catch {
    return [];
  }
}

/** Client-only snapshot (JSON), already without expired trials. */
export function pastTrialsRaw(now = Date.now()): string {
  try {
    const list = parsePastTrials(localStorage.getItem(KEY) ?? '[]').filter((t) => now - t.at < WEEK);
    return JSON.stringify(list);
  } catch {
    return '[]';
  }
}

export function addPastTrial(t: PastTrial) {
  try {
    const list = [t, ...parsePastTrials(pastTrialsRaw()).filter((x) => x.id !== t.id)].slice(0, 12);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // private mode: not listed
  }
}
