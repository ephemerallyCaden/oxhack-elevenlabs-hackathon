// What a saved trial keeps: the words, the sources and the verdict. Never voice audio (data: URLs
// of the user's cloned voice, ~100 KB per line, punch clips included) or TTS-only text. Used in the
// browser before upload (a voiced trial would blow Vercel's 4.5 MB body limit) and on the server.
import type { Line, Transcript } from "@/types";

function slimLine({ audioUrl, tts, punch, ...l }: Line): Line {
  void audioUrl;
  void tts;
  return punch ? { ...l, punch: { text: punch.text } } : l;
}

export function slimTranscript(t: Transcript): Transcript {
  return {
    ...t,
    lines: t.lines.map(slimLine),
    verdict: t.verdict && { ...t.verdict, line: slimLine(t.verdict.line) },
  };
}
