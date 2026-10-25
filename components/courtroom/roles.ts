// Visual config per courtroom role. Swap `CourtRole` for `Role` from types.ts once D1 lands.
import type { Speaker } from "@/types";

export type CourtRole = "prosecution" | "defense" | "judge";

/** Name plate + colour per speaker (textbox and transcript). YES blue, NO red: the suits in the pose art. */
export const WHO: Record<Speaker, { name: string; color: string }> = {
  prosecution: { name: "PROSECUTION · YES", color: "#3b82f6" },
  defense: { name: "DEFENSE · NO", color: "#ef4444" },
  judge: { name: "THE JUDGE", color: "#a16207" },
  user: { name: "YOU", color: "#e4e4e7" },
};

export const ROLE_STYLE: Record<CourtRole, { label: string; color: string; glow: string }> = {
  prosecution: { label: "Future You — Poker", color: "#2563eb", glow: "rgba(37,99,235,0.6)" },
  defense: { label: "Future You — Quant", color: "#dc2626", glow: "rgba(220,38,38,0.6)" },
  judge: { label: "The Judge", color: "#d4a017", glow: "rgba(212,160,23,0.6)" },
};
