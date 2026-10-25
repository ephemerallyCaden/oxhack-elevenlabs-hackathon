// Every time limit in the trial, in ms. `server` = how long a route waits for the LLM (including waiting
// for a Gemini rate-limit slot, see ratelimit.ts) before returning its mock; `client` = how long the
// browser waits for the route. Keep client > server so the route's own fallback arrives first.
export const TIMEOUTS = {
  profile: { server: 9000, client: 10000 },
  // Cut-scene: on the critical path, but the rate-limit window is fresh at the start of a trial.
  setup: { server: 12000, client: 13000 },
  // Pre-written while the previous topic plays (~1 min), so it can wait for a free slot.
  topic: { server: 50000, client: 55000 },
  // The user just interrupted and is waiting: takes the reserved slot.
  topicUrgent: { server: 15000, client: 16000 },
  judgeInterrupt: { server: 10000, client: 11000 },
  verdict: { server: 12000, client: 13000 },
  tts: { client: 15000 }, // eleven_v4 takes 1.5-5.7s per line (measured), longer with the accent hint; 7s cut long lines to silence
  stt: { client: 8000 },
  quickResearch: { client: 6000 },
  deepResearch: { client: 50000 },
} as const;
