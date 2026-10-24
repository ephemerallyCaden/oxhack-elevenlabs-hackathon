// Every time limit in the trial, in ms, from the team's timing budget (handoff page "Timing budget").
// `server` = how long a route waits for Claude before returning its mock; `client` = how long the
// browser waits for the route. Keep client > server so the route's own fallback arrives first.
// Tune these after the real-key smoke test (scripts/smoke-trial.ts).
export const TIMEOUTS = {
  profile: { server: 7000, client: 8000 },
  agenda: { server: 7000, client: 8000 },
  personas: { server: 7000, client: 8000 },
  argue: { server: 7000, client: 8000 },
  scoreArgument: { server: 6000, client: 7000 },
  scoreTopic: { server: 7000, client: 8000 },
  judgeInterrupt: { server: 6000, client: 7000 },
  verdict: { server: 8000, client: 9000 },
  tts: { client: 15000 }, // eleven_v4 takes 1.5-5.7s per line (measured), longer with the accent hint; 7s cut long lines to silence
  stt: { client: 8000 },
  quickResearch: { client: 6000 },
  deepResearch: { client: 50000 },
} as const;
