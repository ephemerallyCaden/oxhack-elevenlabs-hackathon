import type { CollectionRecord } from "./collection";
import type { CollectionReport } from "./collection-fetch";

export type CommunitySourceId = "stackexchange" | "discourse" | "wordpress" | "telegram" | "youtube" | "x" | "wikipedia" | "crossref";
export type CommunityTransport = {
  json(url: string, signal: AbortSignal, init?: RequestInit): Promise<unknown>;
  text(url: string, signal: AbortSignal, init?: RequestInit): Promise<string>;
};
export type CommunityContext = {
  query: string; signal: AbortSignal; transport: CommunityTransport;
  env: Record<string, string | undefined>; now: () => number;
};
export type CommunityAdapter = {
  id: CommunitySourceId;
  hosts: readonly string[];
  capabilities: { discovery: string; replies: string; pagination: string };
  matches(query: string): boolean;
  configured(env: CommunityContext["env"]): boolean;
  collect(context: CommunityContext): Promise<CollectionReport>;
};
export type CommunityRecordInput = {
  url: string; title: string; text: string; publishedAt?: string;
  textFormat?: "html" | "plain";
  threadUrl?: string; postId?: string; parentId?: string; parentText?: string;
  kind?: "post" | "reply"; limitations?: string[];
};
export type CommunityRecordFactory = (source: CommunitySourceId, input: CommunityRecordInput, now: () => number) => CollectionRecord;
