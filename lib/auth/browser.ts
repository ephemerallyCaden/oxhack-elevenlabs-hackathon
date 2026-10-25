"use client";
// Google sign-in (Supabase Auth, PKCE). The publishable anon key is public by design: it can't
// read any table (RLS on, no policies); every user row goes through /api/users*, which verifies
// the session token server-side (lib/auth/server.ts).
// Without NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY, sign-in is simply not offered.
// The session lives in sessionStorage (this tab only): on a shared laptop, closing the tab or
// leaving the court signs you out, so the next person can't act as you. Faces on this laptop
// (lib/onboarding/session.ts) make signing back in one click.
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const authConfigured = !!(URL_ && KEY);

let client: SupabaseClient | null = null;
function auth() {
  if (!authConfigured || typeof window === "undefined") return null;
  client ??= createClient(URL_!, KEY!, {
    auth: { flowType: "pkce", persistSession: true, detectSessionInUrl: true, storageKey: "sb-roulette-auth", storage: window.sessionStorage },
  });
  return client.auth;
}

/** The signed-in session; `ready` once the stored session (or the ?code= return) is resolved. */
export function useSession(): { session: Session | null; ready: boolean } {
  const [state, setState] = useState<{ session: Session | null; ready: boolean }>({ session: null, ready: !authConfigured });
  useEffect(() => {
    const a = auth();
    if (!a) return;
    a.getSession().then(({ data }) => {
      setState({ session: data.session, ready: true });
      if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname); // OAuth return
    });
    const { data } = a.onAuthStateChange((_event, session) => setState({ session, ready: true }));
    return () => data.subscription.unsubscribe();
  }, []);
  return state;
}

/** Leaves for Google and comes back to the homepage. `email` pre-selects a known account. */
export function signInWithGoogle(email?: string) {
  return auth()?.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${location.origin}/`, queryParams: email ? { login_hint: email } : { prompt: "select_account" } },
  });
}

/** This tab only ("local"): never ends the user's sessions on their other devices, no network wait. */
export async function signOut() {
  await auth()?.signOut({ scope: "local" });
}

/** POST with the session's access token (the server checks it). */
export function authedPost(url: string, session: Session, body: unknown = {}, signal?: AbortSignal) {
  return fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
}
