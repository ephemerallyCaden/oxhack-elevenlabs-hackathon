import { z } from "zod";
import { getUser } from "@/lib/users/store";

// POST { id } → { user } or 404. POST (not GET): Next 16 Cache Components prerenders GET handlers.
export async function POST(req: Request) {
  const parsed = z.object({ id: z.string().max(64) }).safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "missing id" }, { status: 400 });
  const user = await getUser(parsed.data.id);
  return user ? Response.json({ user }) : Response.json({ error: "not found" }, { status: 404 });
}
