// B8: delete the voice clones made during onboarding (named session_*). Run after the demo / each judge.
// Run: node --env-file=.env.local scripts/delete-clones.mjs [--dry-run]
const KEY = process.env.ELEVENLABS_API_KEY;
const dry = process.argv.includes("--dry-run");

const res = await fetch("https://api.elevenlabs.io/v2/voices?page_size=100&voice_type=personal", { headers: { "xi-api-key": KEY } });
const { voices = [] } = await res.json();
const sessions = voices.filter((v) => v.name?.startsWith("session_"));
for (const v of sessions) {
  if (dry) {
    console.log("would delete", v.name, v.voice_id);
    continue;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/voices/${v.voice_id}`, { method: "DELETE", headers: { "xi-api-key": KEY } });
  console.log(r.ok ? "deleted" : `FAILED ${r.status}`, v.name);
}
console.log(`${sessions.length} session clone(s)${dry ? " found" : " processed"}.`);
