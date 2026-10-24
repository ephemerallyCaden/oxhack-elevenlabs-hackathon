# Session Replay — Shareable Debate Export

## Recommended Plan (2-3 hours total)

### Primary: Shareable Replay Link (1-2 hours)

Log every debate event as structured JSON. Save TTS audio clips to Supabase Storage. Replay through the **same courtroom component**.

```typescript
interface DebateEvent {
  timestamp: number;
  type: 'speech' | 'objection' | 'effect' | 'music_change' | 'expression_change' | 'verdict';
  speaker: 'prosecution' | 'defense' | 'judge' | 'user';
  text: string;
  audioUrl?: string;  // Supabase Storage URL to TTS clip
  effect?: 'flash' | 'shake' | 'action_lines' | 'gavel';
  expression?: 'idle' | 'talking' | 'sweating' | 'shocked' | 'confident';
}
```

Save to Supabase after verdict. Replay at `/replay/[debateId]`.

### Secondary: Comic Strip OG Image (1-2 hours)

Use **Satori via `next/og` ImageResponse** — server-side, generates the preview card when someone shares the replay link.

1. Claude picks 4 best moments from transcript
2. Render as 2x2 comic panel grid (1200x630px)
3. Auto-shows as preview card on Twitter/Discord/iMessage

```typescript
// app/api/og/[debateId]/route.tsx
import { ImageResponse } from 'next/og';
export async function GET(req, { params }) {
  const debate = await getDebate(params.debateId);
  return new ImageResponse(/* 2x2 comic panel JSX */, { width: 1200, height: 630 });
}
```

### Bonus: Audio Export (30 min)

Concatenate TTS clips via Web Audio API + `audiobuffer-to-wav`. "Download full debate audio" button.

## Why NOT video

| Approach | Effort | Verdict |
|---|---|---|
| DOM → Canvas recording | 3-4 hours, fragile | Skip |
| Remotion server-side | 5-8 hours | Post-hackathon |
| objection_engine (Python) | 4-6 hours | Skip |
| objection.lol | No public API | Impossible |

The replay link + OG comic covers Twitter, Discord, and iMessage automatically. That's 80% of sharing. Video is a post-hackathon feature.

## Key Decisions

- **Use existing courtroom component** for replay — don't build a separate renderer
- **Store TTS audio blobs to Supabase Storage** during the live debate — replay fetches them
- **rrweb is overkill** — structured event log is simpler and gives more control
- **`html-to-image`** for client-side comic download, **Satori** for server-side OG image
