import { z } from "zod";
import type { UserProfile } from "@/types";
import { saveUser } from "@/lib/users/store";
import { invalidateJury, juryKey } from "@/lib/users/jury";
import { byok } from '@/lib/keys';

// Same limits as /api/users: faces are only ever PNG/JPEG/WebP data URLs (the jury decodes them server-side).
const IMAGE = /^data:image\/(?:png|jpeg|webp);base64,/;
const Head = z.object({ src: z.string().regex(IMAGE).max(1_500_000) }).passthrough();
const Body = z.object({
  profile: z.record(z.string(), z.unknown()).default({}),
  voiceId: z.string().max(64).nullable().optional(),
  selfie: z.string().regex(IMAGE).max(2_000_000).nullable().optional(),
  heads: z.object({ front: Head, side: Head.optional() }).nullable().optional(),
});

// POST { profile, voiceId?, selfie?, heads? } → { id, juryKey } — put a visitor who isn't signed in on
// the homepage jury. No sign-in, so it only ever creates a new row under an id the server picks: a
// guest can't name, read, overwrite or delete any row (those stay on the signed-in /api/users routes).
// The voice clone isn't renamed, so scripts/delete-clones.mjs still removes it after the demo.
async function handle(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues }, { status: 400 });
  const { profile, voiceId, selfie, heads } = parsed.data;
  if (!selfie && !heads) return Response.json({ error: "no face to keep" }, { status: 400 });
  try {
    const id = await saveUser({ profile: profile as UserProfile, voiceId: voiceId ?? null, selfie: selfie ?? heads?.front.src ?? null, heads: heads ?? null });
    invalidateJury();
    return Response.json({ id, juryKey: juryKey(id) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Every call it makes uses this request's keys (a visitor's own, else the house's: lib/keys.ts).
export const POST = byok(handle);
