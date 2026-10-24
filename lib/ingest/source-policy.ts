import type { CollectionRecord } from "./collection";

const sourceHosts = new Set(["www.ons.gov.uk", "ons.gov.uk", "journals.plos.org",
  "community.nomadgate.com", "www.nomadicmatt.com", "t.me", "www.youtube.com",
  "x.com", "en.wikipedia.org", "doi.org"]);
const lifeExchange = new Set(["academia", "travel", "expatriates", "workplace", "pets", "parenting", "money", "fitness", "interpersonal"]);
const technical = /\b(?:devops|kubernetes|api\s+(?:gateway|endpoint)|(?:programming|python|javascript)\s+(?:tutorial|language))\b/i;

export function allowedEvidenceUrl(value: string): boolean {
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port
      || !/^[a-z0-9.-]+\.[a-z]{2,63}$/.test(host)
      || /(?:^|\.)(?:cn|xn--fiqs8s|xn--fiqz9s|localhost|local|internal|invalid|test)$/.test(host)) return false;
    if (host.endsWith(".stackexchange.com")) {
      const parts = host.split(".");
      return parts.length === 3 && lifeExchange.has(parts[0]);
    }
    return sourceHosts.has(host);
  } catch { return false; }
}

export function allowedSourceRecord(record: CollectionRecord): boolean {
  if (!allowedEvidenceUrl(record.sourceUrl) || !record.text.trim() || technical.test(`${record.title} ${record.text}`)) return false;
  if (record.discussion) {
    if (!allowedEvidenceUrl(record.discussion.threadUrl)) return false;
    if (record.discussion.kind === "reply" && (!record.discussion.parentId || !record.discussion.parentText?.trim())) return false;
  }
  return true;
}

export const sourcePolicySummary = {
  theme: "Life decisions: education, work, relocation, travel, family, pets, housing and everyday wellbeing.",
  evidence: "Discussion posts remain opinions or experiences with parent context; exact quotations do not prove a claim.",
};
