'use client';
// After the verdict: the seam again, as the trial's last frame. The winning future gloats, the
// losing one breaks down (a toss-up leaves both sweating), and the band closes the loop: a new
// case (same voice + face), save & share, the court record, or back to the menu.
import { useState } from 'react';
import type { Transcript } from '@/types';
import type { Heads } from '@/components/courtroom/heads';
import { WHO } from '@/components/courtroom/roles';
import { footnotes } from '@/lib/debate/transcript';
import SharePanel from '@/components/share/SharePanel';
import Seam, { type SeamFigure } from './Seam';
import { addPastTrial, verdictSide } from './pastTrials';

const fig = (pose: string, expression: SeamFigure['mood']['expression']): SeamFigure => ({ pose, mood: { expression, talking: false } });

export default function VerdictScreen({
  transcript,
  value,
  label,
  heads,
  onLeave,
}: {
  transcript: Transcript;
  value: number;
  label: string;
  heads?: Heads;
  /** Leave the court: '/?again=1' (new case, same voice + face) or '/' (main menu). */
  onLeave: (href: string) => void;
}) {
  const [record, setRecord] = useState(false);
  // The court's label decides (Strong / Lean / Toss-up): a strong loss breaks the loser, a lean one makes them sweat.
  const side = verdictSide(label);
  const win = fig('confident2', 'confident');
  const lose = /strong/i.test(label) ? fig('breakdown1', 'breakdown') : fig('sweating2', 'sweating');
  const torn = fig('sweating1', 'sweating');
  const [yes, no] = side === 'yes' ? [win, lose] : side === 'no' ? [lose, win] : [torn, torn];
  const tone = side === 'yes' ? 'var(--c-yes)' : side === 'no' ? 'var(--c-no)' : 'var(--c-stone)';

  return (
    <section className="court-ui fixed inset-0 z-[60]" aria-label="Verdict">
      <Seam
        yes={yes}
        no={no}
        heads={heads}
        stripOpen={record}
        strip={
          <div className="grid max-h-[62vh] grid-cols-1 gap-8 overflow-y-auto px-8 py-6 md:grid-cols-[3fr_2fr]">
            <div>
              <h3 className="ct-kicker mb-3">Transcript</h3>
              <ol className="flex flex-col gap-2">
                {transcript.lines.map((l) => (
                  <li key={l.id} className="ct-speech text-[15px]">
                    <strong style={{ color: WHO[l.speaker].color }}>{WHO[l.speaker].name}:</strong> {l.text}
                    {footnotes(transcript, l).map((n) => (
                      <sup key={n} className="ml-0.5 text-[var(--c-stone)]">[{n}]</sup>
                    ))}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="ct-kicker mb-3">Sources</h3>
              <ol className="flex flex-col gap-2">
                {transcript.sources.map((c, i) => (
                  <li key={c.id} className="ct-small !text-[#d9d7d0]">
                    [{i + 1}] {c.evidence} ·{' '}
                    {c.source_url ? (
                      <a className="ct-link" href={c.source_url} target="_blank" rel="noreferrer">{c.source_name}</a>
                    ) : (
                      c.source_name
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        }
      >
        <span className="ct-kicker">The court finds</span>
        <h2 className="ct-verdict" style={{ color: tone }}>{label}</h2>
        <div className="flex flex-col gap-2">
          <div className="ct-meter" aria-hidden="true"><i style={{ left: `${(value + 100) / 2}%` }} /></div>
          <div className="ct-small flex justify-between"><span>No</span><span className="!text-white">{value > 0 ? '+' : ''}{value}</span><span>Yes</span></div>
        </div>
        <p className="ct-small">“{transcript.question}”</p>
        {transcript.verdict?.explanation && <p className="ct-body">{transcript.verdict.explanation}</p>}
        <div className="flex flex-col items-start gap-3">
          {/* Same tab, so the voice, faces and profile in sessionStorage carry over to the new case. */}
          <button className="ct-primary" onClick={() => onLeave('/?again=1')}>New case</button>
          <button className="ct-ghost" aria-expanded={record} onClick={() => setRecord((o) => !o)}>
            {record ? 'Close the court record' : 'Read the court record'}
          </button>
        </div>
        <div className="ct-share">
          <SharePanel transcript={transcript} onSaved={(id) => addPastTrial({ id, question: transcript.question, value, label, at: Date.now() })} />
        </div>
        <button className="ct-link self-start" onClick={() => onLeave('/')}>Main menu</button>
      </Seam>
    </section>
  );
}
