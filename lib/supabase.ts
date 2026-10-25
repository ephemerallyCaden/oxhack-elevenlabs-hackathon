// Server-only Supabase client (service role: bypasses RLS, never send it to the browser).
// null without SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY → callers use a local JSON fallback.
import { createClient } from "@supabase/supabase-js";

export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    : null;

// Vercel's filesystem is read-only except /tmp, which isn't shared between instances:
// the local fallback is for development; deployed storage needs Supabase.
export const LOCAL_DIR = process.env.VERCEL ? "/tmp/roulette" : ".cache";
