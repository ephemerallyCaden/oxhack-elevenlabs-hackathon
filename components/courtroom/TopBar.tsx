// Round indicator + remaining interrupt tokens.
export default function TopBar({ round, totalRounds, tokens }: { round: number; totalRounds: number; tokens: number }) {
  return (
    <div className="absolute inset-x-[3cqw] top-[3cqh] flex items-center justify-between text-[2.4cqh] font-bold uppercase tracking-[0.2em] text-white">
      <span className="rounded-full bg-black/60 px-[1.5cqw] py-[0.8cqh]">
        Round {round} / {totalRounds}
      </span>
      <span className="flex items-center gap-[1cqw] rounded-full bg-black/60 px-[1.5cqw] py-[0.8cqh]">
        Objections
        {Array.from({ length: 3 }, (_, i) => (
          <span
            key={i}
            className={`inline-block size-[2.6cqh] rounded-full border-[0.4cqh] border-red-500 ${i < tokens ? "bg-red-500" : "bg-transparent opacity-40"}`}
          />
        ))}
      </span>
    </div>
  );
}
