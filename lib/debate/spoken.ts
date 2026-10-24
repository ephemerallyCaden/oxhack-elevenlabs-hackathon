// Numbers → words for TTS ("91" → "ninety-one"), and small text helpers.

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Integer 0-100 → words. */
export function intWords(n: number): string {
  n = Math.round(n);
  if (n >= 100) return 'one hundred';
  if (n < 20) return ONES[Math.max(0, n)];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]}-${ONES[o]}` : TENS[t];
}

/** 0.91 → { text: "91%", spoken: "ninety-one percent" } */
export function pct(p: number): { text: string; spoken: string } {
  const n = Math.round(p * 100);
  return { text: `${n}%`, spoken: `${intWords(n)} percent` };
}

/** Rough audio length before real TTS exists (~15 chars/s of speech). */
export const estimateDurationMs = (text: string) => Math.max(1500, Math.round(text.length * 65));

export const wordCount = (s: string) => s.replace(/\[[^\]]*\]/g, ' ').split(/\s+/).filter(Boolean).length;
