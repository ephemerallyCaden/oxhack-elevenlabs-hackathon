import Link from "next/link";

// Placeholder home. C5 replaces this with the decision input + Monte Carlo loading screen.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-8 px-6 text-center">
      <p className="text-sm uppercase tracking-[0.4em] text-amber-400">The Council of Future Selves</p>
      <h1 className="text-6xl font-black tracking-tight sm:text-8xl">ROULETTE</h1>
      <p className="max-w-md text-lg text-zinc-400">Bet on your future.</p>
      <Link
        href="/court"
        className="rounded-full bg-red-600 px-8 py-3 text-lg font-bold uppercase tracking-wide transition-colors hover:bg-red-500"
      >
        Enter the court
      </Link>
    </main>
  );
}
