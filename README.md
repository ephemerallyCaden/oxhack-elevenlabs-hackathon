<p align="center">
  <img src="public/assets/logo/roulette-seal-600.webp" alt="Roulette court seal" width="220">
</p>

<h1 align="center">Roulette</h1>

<p align="center"><b>The Court of Future Selves.</b> Ask a life question out loud, and two future versions of you argue it out in your own cloned voice while a Judge rules on real evidence.</p>

<p align="center"><a href="https://hackathon-template-vert.vercel.app"><b>Try it live →</b></a></p>

You read a short script, the app clones your voice with ElevenLabs and cuts out your face from a selfie, then you ask a yes/no question ("Should I quit my job to play poker?"). The court opens: YES is the future where it went well, NO is the future where it went wrong. Both speak in your voice, cite researched facts, cut each other off, and you can shout OBJECTION! at any point to argue back. The Judge scores each topic and delivers the verdict.

<table>
  <tr>
    <td><img src="docs/media/objection-wide.png" alt="Wide courtroom shot during an objection: the Judge in the centre, YES and NO selves at their desks with the spectrum bar overhead"></td>
    <td><img src="docs/media/punch-shot.png" alt="Punch shot: close-up on the YES self with speed lines and the Hold to interrupt button"></td>
  </tr>
  <tr>
    <td><img src="docs/media/shocked-closeup.png" alt="Close-up of a future self with a shocked exclamation mark, the topic agenda in the corner"></td>
    <td><img src="docs/media/verdict-screen.png" alt="Verdict screen: YES and NO selves either side of the court's finding, with New case and Save and share"></td>
  </tr>
</table>

Watch a full run: [docs/media/demo-run.mp4](docs/media/demo-run.mp4)

## Built with

- **ElevenLabs**: Instant Voice Clone, `eleven_v4` text-to-speech with audio tags and per-role voice settings, Scribe speech-to-text
- **Next.js 16** on Vercel, Tailwind CSS 4, Framer Motion
- **Groq / Gemini** to write the debate; Exa search for public-source evidence
- **Supabase** for returning users and shareable trial links
- MediaPipe face landmarks for the selfie head cut-outs

## Run locally

```bash
npm install
vercel env pull .env.local   # or copy .env.example to .env.local and add your keys
npm run dev                  # http://localhost:3000
```

Use Chrome: the onboarding needs the microphone and camera. Without keys the app still runs end to end on mock data, so `DEBATE_LLM=mock npm run dev` costs nothing.

Built at OxHack by [@ephemerallyCaden](https://github.com/ephemerallyCaden), [@randodeh](https://github.com/randodeh), [@awckiu](https://github.com/awckiu) and [@Dust-OP](https://github.com/Dust-OP).
