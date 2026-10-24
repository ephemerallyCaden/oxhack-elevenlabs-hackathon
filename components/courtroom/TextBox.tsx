import { ROLE_STYLE, type CourtRole } from "./roles";

// Ace Attorney-style dialogue box. C4 adds the typewriter effect.
export default function TextBox({ speaker, name, text }: { speaker: CourtRole; name?: string; text: string }) {
  const { label, color } = ROLE_STYLE[speaker];
  return (
    <div className="absolute inset-x-[3cqw] bottom-[3cqh] h-[24cqh]">
      <div
        className="absolute -top-[4.5cqh] left-[2cqw] rounded-t-[1cqh] px-[1.5cqw] py-[0.6cqh] text-[2.6cqh] font-bold uppercase tracking-wide text-white"
        style={{ backgroundColor: color }}
      >
        {name ?? label}
      </div>
      <div
        className="h-full rounded-[1.5cqh] border-[0.5cqh] bg-black/85 px-[2.5cqw] py-[2.5cqh] text-[3.4cqh] leading-snug text-white"
        style={{ borderColor: color }}
      >
        {text}
      </div>
    </div>
  );
}
