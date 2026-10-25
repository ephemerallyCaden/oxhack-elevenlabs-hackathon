// Server-only: returning users ("Remember me"). Stores the onboarding profile, the user's voice clone
// id and their selfie, so next time they skip straight to their question. Opt-in only; "Forget me"
// deletes the row and the clone. Supabase table `users` (docs/supabase.sql), else local JSON.
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_DIR, supabase } from "@/lib/supabase";
import type { UserProfile } from "@/types";

export type SavedUser = {
  id: string;
  profile: UserProfile;
  voiceId: string | null;
  /** PNG data URL from the selfie step (~100-300 KB). */
  selfie: string | null;
};

const DIR = join(LOCAL_DIR, "users");
const validId = (id: string) => /^[\w-]{16,32}$/.test(id);

export async function saveUser(u: Omit<SavedUser, "id"> & { id?: string }): Promise<string> {
  const id = u.id && validId(u.id) ? u.id : randomBytes(16).toString("base64url");
  const row: SavedUser = { id, profile: u.profile ?? {}, voiceId: u.voiceId ?? null, selfie: u.selfie ?? null };
  if (supabase) {
    const { error } = await supabase
      .from("users")
      .upsert({ id, profile: row.profile, voice_id: row.voiceId, selfie: row.selfie, updated_at: new Date().toISOString() });
    if (error) throw new Error(`supabase upsert: ${error.message}`);
  } else {
    await mkdir(DIR, { recursive: true });
    await writeFile(join(DIR, `${id}.json`), JSON.stringify(row));
  }
  return id;
}

export async function getUser(id: string): Promise<SavedUser | null> {
  if (!validId(id)) return null;
  if (supabase) {
    const { data } = await supabase.from("users").select("id, profile, voice_id, selfie").eq("id", id).maybeSingle();
    return data ? { id: data.id, profile: data.profile ?? {}, voiceId: data.voice_id, selfie: data.selfie } : null;
  }
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** Removes the user and returns what was stored (so the caller can delete the voice clone). */
export async function deleteUser(id: string): Promise<SavedUser | null> {
  const user = await getUser(id);
  if (!user) return null;
  if (supabase) await supabase.from("users").delete().eq("id", id);
  else await rm(join(DIR, `${id}.json`), { force: true });
  return user;
}
