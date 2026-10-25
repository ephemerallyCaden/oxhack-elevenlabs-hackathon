import { authAvailable, authUnavailable, requireUser, unauthorized } from "@/lib/auth/server";
import { getUser } from "@/lib/users/store";
import { juryKey } from "@/lib/users/jury";

// POST → { user, juryKey } (the signed-in user's own saved voice, face and profile) or 404.
// `juryKey` lets this browser recognise their own seat in the jury. A failed lookup is a 500.
// POST (not GET): Next 16 Cache Components prerenders GET handlers.
export async function POST(req: Request) {
  if (!authAvailable()) return authUnavailable();
  const me = await requireUser(req);
  if (!me) return unauthorized();
  try {
    const user = await getUser(me.id);
    return user ? Response.json({ user, juryKey: juryKey(me.id) }) : Response.json({ error: "not found" }, { status: 404 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
