import { Suspense } from "react";
import type { Metadata } from "next";
import type { Speaker } from "@/types";
import { getTrial } from "@/lib/share/store";
import { footnotes } from "@/lib/debate/transcript";

// Shareable trial: the QR code at the verdict points here. Phone-first layout.
export const metadata: Metadata = { title: "Court of Future Selves — your trial" };

const WHO: Record<Speaker, { name: string; color: string }> = {
  prosecution: { name: "Future you (YES)", color: "#ef4444" },
  defense: { name: "Future you (NO)", color: "#3b82f6" },
  judge: { name: "The Judge", color: "#eab308" },
  user: { name: "You", color: "#e4e4e7" },
};

export default function SharedTrial({ params }: PageProps<"/t/[id]">) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-8">
      <p className="text-xs uppercase tracking-[0.35em] text-amber-400">Court of Future Selves</p>
      <Suspense fallback={<p className="text-zinc-400">Fetching the court record…</p>}>
        {params.then(({ id }) => (
          <Trial id={id} />
        ))}
      </Suspense>
    </main>
  );
}

async function Trial({ id }: { id: string }) {
  const t = await getTrial(id);
  if (!t) return <p className="text-zinc-400">This trial doesn’t exist (or has been cleared).</p>;
  const v = t.verdict;
  return (
    <>
      <h1 className="text-2xl font-black leading-tight">“{t.question}”</h1>
      {v && (
        <section className="flex flex-col gap-3 rounded-xl bg-zinc-900 p-5">
          <p className="text-sm uppercase tracking-widest text-zinc-400">Verdict</p>
          <p className="text-3xl font-black">
            {v.spectrum.label} <span className="text-zinc-400">({v.spectrum.value > 0 ? "+" : ""}{v.spectrum.value})</span>
          </p>
          <div className="relative h-2 rounded-full bg-gradient-to-r from-blue-600 via-zinc-600 to-red-600">
            <span className="absolute -top-1 h-4 w-1 rounded bg-white" style={{ left: `${(v.spectrum.value + 100) / 2}%` }} />
          </div>
          <p className="text-zinc-300">{v.explanation}</p>
          <ul className="flex flex-col gap-1 text-sm text-zinc-400">
            {v.breakdown.map((b) => (
              <li key={b.topic_id}>
                <b className="text-zinc-200">{b.title}</b> ({Math.round(b.weight * 100)}%): {b.deciding_argument}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Transcript</h2>
        <ol className="flex flex-col gap-2 text-sm leading-relaxed">
          {t.lines.map((l) => (
            <li key={l.id}>
              <b style={{ color: WHO[l.speaker].color }}>{WHO[l.speaker].name}:</b> {l.text}
              {footnotes(t, l).map((n) => (
                <sup key={n} className="ml-0.5 text-zinc-500">[{n}]</sup>
              ))}
            </li>
          ))}
        </ol>
      </section>
      {t.sources.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Sources</h2>
          <ol className="flex flex-col gap-1 text-sm text-zinc-300">
            {t.sources.map((c, i) => (
              <li key={c.id}>
                [{i + 1}] {c.evidence}
                {c.source_url && <a className="block break-all text-xs text-zinc-500 underline" href={c.source_url} target="_blank" rel="noreferrer">{c.source_url}</a>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
