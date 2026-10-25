import sharp from "sharp";
import { listFaces } from "@/lib/users/store";

// POST → { jurors: [{ name?, face }] } — the homepage jury: every saved user's face as a small
// thumbnail (112px tall WebP) and their first name. Public by product decision (the menu shows
// everyone who saved); it returns nothing else: no ids, emails, voices or profiles.
// POST (not GET): Next 16 Cache Components prerenders GET handlers.

const TTL_MS = 60_000;
let cache: { at: number; jurors: { name?: string; face: string }[] } | null = null;

async function thumb(dataUrl: string): Promise<string | null> {
  const b64 = dataUrl.match(/^data:image\/[\w+.-]+;base64,(.+)$/)?.[1];
  if (!b64) return null;
  try {
    const out = await sharp(Buffer.from(b64, "base64")).resize({ height: 112 }).webp({ quality: 72 }).toBuffer();
    return `data:image/webp;base64,${out.toString("base64")}`;
  } catch {
    return null;
  }
}

export async function POST() {
  if (cache && Date.now() - cache.at < TTL_MS) return Response.json({ jurors: cache.jurors });
  try {
    const faces = await listFaces(15);
    const jurors = (await Promise.all(faces.map(async (f) => ({ name: f.name, face: await thumb(f.selfie) })))).filter(
      (j): j is { name: string | undefined; face: string } => !!j.face,
    );
    cache = { at: Date.now(), jurors };
    return Response.json({ jurors });
  } catch {
    return Response.json({ jurors: [] }); // the jury is decoration: never break the menu
  }
}
