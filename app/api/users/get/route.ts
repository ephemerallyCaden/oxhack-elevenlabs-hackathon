import { requireUser, unauthorized } from "@/lib/auth/server";
import { getUser } from "@/lib/users/store";

// POST → { user } (the signed-in user's own saved voice, face and profile) or 404.
// POST (not GET): Next 16 Cache Components prerenders GET handlers.
export async function POST(req: Request) {
  const me = await requireUser(req);
  if (!me) return unauthorized();
  const user = await getUser(me.id);
  return user ? Response.json({ user }) : Response.json({ error: "not found" }, { status: 404 });
}
