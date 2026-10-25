// Server-only: saved trials for the shareable /t/[id] link (transcript + verdict only, never the
// user’s voice, selfie or profile). Only saved when the user clicks "Save & share", and kept
// for TTL_DAYS: expired trials are hidden on read and deleted on the next save (plus an optional
// nightly pg_cron job, docs/supabase.sql). Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are set (table: docs/supabase.sql), otherwise a local JSON file so it works with no setup.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_DIR, supabase } from "@/lib/supabase";
import type { Transcript } from "@/types";
import { slimTranscript } from "./slim";

const DIR = join(LOCAL_DIR, "trials");

export const storage = supabase ? "supabase" : "local";

export const TTL_DAYS = 7;
const cutoff = () => new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000);

/** Delete trials older than TTL_DAYS. Best effort: a failure never blocks a save. */
async function purgeExpired() {
  if (supabase) {
    await supabase.from("trials").delete().lt("created_at", cutoff().toISOString());
    return;
  }
  const files = await readdir(DIR).catch(() => [] as string[]);
  for (const f of files) {
    const p = join(DIR, f);
    const s = await stat(p).catch(() => null); // another save's purge may have removed it already
    if (s && s.mtime < cutoff()) await rm(p, { force: true });
  }
}

export async function saveTrial(t: Transcript): Promise<string> {
  const id = randomBytes(6).toString("base64url");
  const transcript = slimTranscript(t); // again server-side: never trust the client to have done it
  if (supabase) {
    const { error } = await supabase.from("trials").insert({ id, question: transcript.question, transcript });
    if (error) throw new Error(`supabase insert: ${error.message}`);
  } else {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(transcript));
  }
  await purgeExpired().catch(() => {});
  return id;
}

export async function getTrial(id: string): Promise<Transcript | null> {
  if (!/^[\w-]{6,16}$/.test(id)) return null;
  if (supabase) {
    const { data } = await supabase.from("trials").select("transcript").eq("id", id).gte("created_at", cutoff().toISOString()).maybeSingle();
    return (data?.transcript as Transcript) ?? null;
  }
  try {
    const p = join(DIR, `${id}.json`);
    if ((await stat(p)).mtime < cutoff()) return null; // expired
    return JSON.parse(await readFile(p, "utf8"));
  } catch {
    return null;
  }
}
