// Server-only: returning users ("Remember me", signed in with Google). Stores the onboarding profile,
// the user's voice clone id and their head cut-outs, keyed by their Supabase user id, so next time
// they skip straight to their question. Opt-in only; "Forget me" deletes the row and the clone.
// Supabase table `users` (docs/supabase.sql), else local JSON.
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LOCAL_DIR, supabase } from "@/lib/supabase";
import type { UserProfile } from "@/types";

export type SavedUser = {
  id: string;
  profile: UserProfile;
  voiceId: string | null;
  /** Front head cut-out, PNG data URL (~100-400 KB). */
  selfie: string | null;
  /** Both cut-outs + calibration, when onboarding captured them. Kept in the `selfie` column as JSON. */
  heads?: { front: { src: string }; side?: { src: string } } | null;
};

/** The `selfie` column holds either a data URL (front only) or the heads JSON. */
function packFaces(u: Pick<SavedUser, "selfie" | "heads">): string | null {
  return u.heads ? JSON.stringify(u.heads) : u.selfie;
}
function unpackFaces(stored: string | null): Pick<SavedUser, "selfie" | "heads"> {
  if (!stored?.startsWith("{")) return { selfie: stored, heads: null };
  try {
    const heads = JSON.parse(stored) as NonNullable<SavedUser["heads"]>;
    return { selfie: heads.front.src, heads };
  } catch {
    return { selfie: null, heads: null };
  }
}

const DIR = join(LOCAL_DIR, "users");
const validId = (id: string) => /^[\w-]{16,40}$/.test(id); // Supabase user ids are UUIDs

export async function saveUser(u: Omit<SavedUser, "id"> & { id?: string }): Promise<string> {
  const id = u.id && validId(u.id) ? u.id : randomBytes(16).toString("base64url");
  const row: SavedUser = { id, profile: u.profile ?? {}, voiceId: u.voiceId ?? null, selfie: u.selfie ?? null, heads: u.heads ?? null };
  if (supabase) {
    const { error } = await supabase
      .from("users")
      .upsert({ id, profile: row.profile, voice_id: row.voiceId, selfie: packFaces(row), updated_at: new Date().toISOString() });
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
    const { data, error } = await supabase.from("users").select("id, profile, voice_id, selfie").eq("id", id).maybeSingle();
    if (error) throw new Error(`supabase select: ${error.message}`); // a failed lookup is not "no such user"
    return data ? { id: data.id, profile: data.profile ?? {}, voiceId: data.voice_id, ...unpackFaces(data.selfie) } : null;
  }
  try {
    return JSON.parse(await readFile(join(DIR, `${id}.json`), "utf8"));
  } catch {
    return null;
  }
}

/** The jury on the homepage: every saved user's front face + first name, newest first (server-side only). */
export async function listFaces(limit = 15): Promise<{ id: string; name?: string; selfie: string }[]> {
  type Row = { id: string; profile: UserProfile | null; selfie: string | null };
  let rows: Row[] = [];
  if (supabase) {
    const { data, error } = await supabase.from("users").select("id, profile, selfie").not("selfie", "is", null).order("updated_at", { ascending: false }).limit(limit);
    if (error) throw new Error(`supabase select: ${error.message}`); // not "nobody saved": don't cache an empty jury
    rows = (data ?? []) as Row[];
  } else {
    const files = await readdir(DIR).catch(() => [] as string[]);
    const saved = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readFile(join(DIR, f), "utf8").then((t) => JSON.parse(t) as SavedUser).catch(() => null)));
    rows = saved.filter((u): u is SavedUser => !!u).slice(0, limit).map((u) => ({ id: u.id, profile: u.profile, selfie: packFaces(u) }));
  }
  return rows.flatMap((r) => {
    const { selfie } = unpackFaces(r.selfie);
    const name = typeof r.profile?.name === "string" ? r.profile.name.trim().split(/\s+/)[0].slice(0, 20) || undefined : undefined;
    return selfie ? [{ id: r.id, name, selfie }] : [];
  });
}

/** Every saved user's voice clone id: /api/voice/clone never sweeps these to free a slot. */
export async function savedVoiceIds(): Promise<Set<string>> {
  if (supabase) {
    const { data, error } = await supabase.from("users").select("voice_id").not("voice_id", "is", null);
    if (error) throw new Error(`supabase select: ${error.message}`); // not "nobody saved": that would sweep their voices
    return new Set((data ?? []).map((r: { voice_id: string }) => r.voice_id));
  }
  const files = await readdir(DIR).catch(() => [] as string[]);
  const saved = await Promise.all(files.filter((f) => f.endsWith(".json")).map((f) => readFile(join(DIR, f), "utf8").then((t) => (JSON.parse(t) as SavedUser).voiceId).catch(() => null)));
  return new Set(saved.filter((v): v is string => !!v));
}

/** Removes the user and returns what was stored (so the caller can delete the voice clone). */
export async function deleteUser(id: string): Promise<SavedUser | null> {
  const user = await getUser(id);
  if (!user) return null;
  if (supabase) {
    const { error } = await supabase.from("users").delete().eq("id", id);
    if (error) throw new Error(`supabase delete: ${error.message}`); // never report "forgotten" when it wasn't
  } else await rm(join(DIR, `${id}.json`), { force: true });
  return user;
}
