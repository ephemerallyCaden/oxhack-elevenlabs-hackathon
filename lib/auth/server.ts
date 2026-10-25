// Server-side gate for signed-in routes: verifies the caller's Supabase session token with the
// auth server (not just its presence) and returns their user id. Fails closed: no Supabase
// config, no token, or an invalid / expired token → null → 401.
import { supabase } from "@/lib/supabase";

export async function requireUser(req: Request): Promise<{ id: string; email?: string } | null> {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!supabase || !token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? undefined };
}

export const unauthorized = () => Response.json({ error: "sign in required" }, { status: 401 });

/** Sign-in needs the server's Supabase client too: without it say so (503), don't pretend it's the user (401). */
export const authAvailable = () => !!supabase;
export const authUnavailable = () => Response.json({ error: "sign-in is not configured on this server" }, { status: 503 });
