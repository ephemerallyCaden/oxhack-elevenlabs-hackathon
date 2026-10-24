// Visual config per courtroom role. Swap `CourtRole` for `Role` from types.ts once D1 lands.
export type CourtRole = "prosecution" | "defense" | "judge";

export const ROLE_STYLE: Record<CourtRole, { label: string; color: string; glow: string }> = {
  prosecution: { label: "Future You — Poker", color: "#dc2626", glow: "rgba(220,38,38,0.6)" },
  defense: { label: "Future You — Quant", color: "#2563eb", glow: "rgba(37,99,235,0.6)" },
  judge: { label: "The Judge", color: "#d4a017", glow: "rgba(212,160,23,0.6)" },
};
