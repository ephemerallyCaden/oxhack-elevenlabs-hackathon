// Server-only: saved trials for the shareable /t/[id] link (transcript + verdict only — never the
// user's voice, selfie or profile). Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set
// (table: docs/supabase.sql), otherwise a local JSON file so it works with no setup.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_DIR, supabase } from "@/lib/supabase";
import type { Transcript } from "@/types";

const DIR = join(LOCAL_DIR, "trials");

export const storage = supabase ? "supabase" : "local";

/** Drop audio (data: URLs are ~100 KB per line) and TTS-only text before saving. */
function slim(t: Transcript): Transcript {
  return {
    ...t,
    lines: t.lines.map(({ audioUrl, tts, ...l }) => (void audioUrl, void tts, l)),
    verdict: t.verdict && { ...t.verdict, line: { ...t.verdict.line, audioUrl: undefined, tts: undefined } },
  };
}

export async function saveTrial(t: Transcript): Promise<string> {
  const id = randomBytes(6).toString("base64url");
  const transcript = slim(t);
  if (supabase) {
    const { error } = await supabase.from("trials").insert({ id, question: transcript.question, transcript });
    if (error) throw new Error(`supabase insert: ${error.message}`);
  } else {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(transcript));
  }
  return id;
}

export async function getTrial(id: string): Promise<Transcript | null> {
  if (!/^[\w-]{6,16}$/.test(id)) return null;
  if (supabase) {
    const { data } = await supabase.from("trials").select("transcript").eq("id", id).maybeSingle();
    return (data?.transcript as Transcript) ?? null;
  }
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}
