import { ROLE_STYLE, type CourtRole } from "./roles";

// Colored silhouette. Expressions (sweating, shocked, ...) are added in C6.
export default function Character({ role, speaking }: { role: CourtRole; speaking: boolean }) {
  const { color, glow } = ROLE_STYLE[role];
  return (
    <svg
      viewBox="0 0 100 120"
      className={`h-full w-auto transition-[opacity,filter] duration-300 ${speaking ? "animate-talk" : "opacity-55"}`}
      style={{ filter: speaking ? `drop-shadow(0 0 2cqh ${glow})` : "brightness(0.6)" }}
      aria-label={ROLE_STYLE[role].label}
    >
      <defs>
        <linearGradient id={`fill-${role}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="#0a0a0a" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="32" r="20" fill={`url(#fill-${role})`} />
      <path d="M8 120 C8 82 28 60 50 60 C72 60 92 82 92 120 Z" fill={`url(#fill-${role})`} />
    </svg>
  );
}
