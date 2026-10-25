import { connection } from "next/server";
import { createCommunityFetcher } from "@/lib/ingest/community-fetch";

export async function GET() {
  await connection();
  return Response.json({ sources: createCommunityFetcher().catalog() });
}
