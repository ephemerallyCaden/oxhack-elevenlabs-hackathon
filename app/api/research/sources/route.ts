import { connection } from "next/server";
import { createCommunityFetcher } from "@/lib/ingest/community-fetch";
import { createWebSearch } from "@/lib/ingest/web-search";

export async function GET() {
  await connection();
  return Response.json({ sources: [createWebSearch().catalog(), ...createCommunityFetcher().catalog()] });
}
