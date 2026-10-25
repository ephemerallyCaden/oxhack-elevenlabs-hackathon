import { getJury } from "@/lib/users/jury";

// POST → { jurors: [{ key, name?, face }] } — the homepage jury (lib/users/jury.ts): every saved
// user's face as a 112px WebP thumbnail, their first name, and an opaque key. Nothing else.
// POST (not GET): Next 16 Cache Components prerenders GET handlers.
export async function POST() {
  try {
    return Response.json({ jurors: await getJury() });
  } catch {
    return Response.json({ jurors: [] }); // the jury is decoration: never break the menu
  }
}
