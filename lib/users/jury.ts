// Server-only: the homepage jury. Every saved user's face as a small thumbnail + first name (public
// by product decision), plus an opaque key so a browser can tell "this juror is me" without learning
// anyone's id. Nothing else leaves the server.
import { createHash } from "node:crypto";
import sharp from "sharp";
import { listFaces } from "./store";

export type Juror = { key: string; name?: string; face: string };

const TTL_MS = 60_000;
const MAX_INPUT_BYTES = 3_000_000; // a stored front head is ~0.4 MB; anything far bigger isn't ours
const MAX_INPUT_PIXELS = 4_000_000; // decompression bombs: refuse images above 4 MP before decoding

/** Opaque per-user key (not reversible to the id). The save route hands it to the user's browser. */
export const juryKey = (id: string) => createHash("sha256").update(`jury:${id}`).digest("base64url").slice(0, 12);

let cache: { at: number; jurors: Juror[] } | null = null;
let building: Promise<Juror[]> | null = null;
let generation = 0;

/**
 * A save or "Forget me" changed the jury: rebuild on the next request (this instance). A rebuild
 * already running started before the change, so it is dropped rather than cached.
 */
export function invalidateJury() {
  generation++;
  cache = null;
  building = null;
}

async function thumb(dataUrl: string): Promise<string | null> {
  const b64 = dataUrl.match(/^data:image\/(?:png|jpeg|webp);base64,(.+)$/)?.[1];
  if (!b64 || b64.length > (MAX_INPUT_BYTES * 4) / 3) return null;
  try {
    const out = await sharp(Buffer.from(b64, "base64"), { limitInputPixels: MAX_INPUT_PIXELS }).resize({ height: 112 }).webp({ quality: 72 }).toBuffer();
    return `data:image/webp;base64,${out.toString("base64")}`;
  } catch {
    return null; // not an image we can read: that seat stays a silhouette
  }
}

async function build(): Promise<Juror[]> {
  const gen = generation;
  const jurors: Juror[] = [];
  for (const f of await listFaces(15)) {
    const face = await thumb(f.selfie); // one at a time: bounded memory
    if (face) jurors.push({ key: juryKey(f.id), name: f.name, face });
  }
  if (gen === generation) cache = { at: Date.now(), jurors }; // stale if a save / Forget me landed meanwhile
  return jurors;
}

export async function getJury(): Promise<Juror[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.jurors;
  if (!building) {
    const run = build().finally(() => {
      if (building === run) building = null;
    });
    building = run; // concurrent misses share one rebuild
  }
  return building;
}
