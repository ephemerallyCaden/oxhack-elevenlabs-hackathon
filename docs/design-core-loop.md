# Core logic design: the Court of Future Selves

Status: **draft, replaces all earlier debate designs** · Owner: D (awckiu)

## 1. The game in one paragraph
Before the first trial, the user fills in a short **onboarding form** (age, situation, location) and records a voice sample, which is cloned with ElevenLabs. They then ask a yes/no question: "Should I …?". The answer is a position on a **spectrum** from *definitely no* (−100) to *definitely yes* (+100). Two **future versions of the user** argue it out in their cloned voice. **YES** is the best version of their future, at the moment it's most likely to be going well. **NO** is the worst version, at the moment it's most likely to have gone wrong. **The Judge** mediates: sets an agenda of weighted topics, scores each topic after YES and NO debate it, moves the needle on the spectrum, and finally gives a verdict. Afterwards the user gets the full transcript, with every fact linked to its source.

## 2. Characters: best and worst future you
Both sides are futures of the user **saying yes**, each at its own most likely moment in time:

| Side | Who | When | Example: "Should I take a gap year?" (user is 18) |
|---|---|---|---|
| **YES** (prosecution) | **best** future you | when it's most likely to be going **well** | 1 year later, 19: travelling the world, best year of your life |
| **NO** (defense) | **worst** future you | when it's most likely to have gone **wrong** | 4 years later, 22: peers have jobs, you're older with less experience and struggling to get hired |
| **Judge** | the mediator | now | weighs both futures for present-you |

- The two time points are **chosen per question** in setup, not fixed, together with a short **persona profile** for each: age, time from now, a 2-3 sentence life snapshot, mood. The onboarding form supplies the current age and situation.
- Each side speaks in the first person *from its moment*, e.g. "It's a year from now and I'm writing this from Lima…" or "Four years on, I've had eleven rejections this month…". It argues from that life, using the evidence cards.
- Same cloned voice for both, with different delivery: upbeat for YES, weary for NO (B's voice configs).

## 3. Scenes (all 2D)
| Scene | Shot | When |
|---|---|---|
| **S1 YES** | close-up on best future you | YES is speaking |
| **S2 NO** | close-up on worst future you | NO is speaking |
| **S3 Judge** | close-up on the Judge | agenda, topic intros, scoring, verdict |
| **S4 Witness view** | zoom-out: all three looking at the user | user asks the question, user interrupts |
| **Cut-scene** | "the court prepares" | hides setup: agenda, personas, first research |

## 4. Loops
```
ONBOARDING (once): age, situation, location + voice sample → ElevenLabs clone
USER QUESTION (S4)
  → CUT-SCENE: Judge builds the agenda (≤ 4 topics, weighted) + the best/worst personas
               + quick research for the first topic
  → OUTER LOOP: for each topic (quickest-to-research first; user-added topics join the queue)
       Judge introduces the topic                                         (S3)
       → INNER LOOP: 2 cycles of  YES argues → NO rebuts                   (S1/S2)
            · +1 cycle per USER interrupt on this topic
            · AI interrupts (YES/NO cutting into each other) do NOT change the cycle count
            · background: each line is scored into the pros/cons ledger → passed to the Judge
       → Judge scores the topic, recalculates the spectrum                (S3)
  → VERDICT: spectrum position + reasoning per topic                     (S3)
  → TRANSCRIPT: every line, with source references
```

### 4a. Outer loop: the Judge's agenda
- The opening agenda has **1-4 topics**, chosen by question complexity. Each has a `title`, the sub-question it settles, an `importance` weight (normalised to sum to 1) and `research_speed` (`quick` / `deep`).
- **The 4-topic cap only applies to the Judge's opening agenda.** The user can add as many topics as they like by interrupting the Judge. The trial continues as long as there are topics left.
- **Order:** quickest-to-research first, so the debate starts fast while deep research for later topics runs in the background. User-added topics go to the end of the queue.
- After each topic the Judge scores it: `t` from −1 (lean NO) to +1 (lean YES), plus a confidence. **Spectrum** = importance-weighted average of the scored topics × 100, computed in code.

### 4b. Inner loop: YES vs NO on one topic
- One **cycle** = YES speaks, then NO responds. **2 cycles per topic by default.**
- **User interrupt → +1 cycle.** In the added cycle, the interrupted side answers the user's point first, then the other side replies.
- **AI interrupt → no change.** When YES or NO cuts into the other mid-argument ("Hold on, that's the best case!"), it happens inside the current cycle.
- Each argument has to use the evidence cards for its side and respond to the last thing the other side said.
- **Background scoring:** after every line, a fast call adds `{claim, supports yes/no/neutral, strength 1-5, card ids}` to the topic's **pros/cons ledger**. The user's own points are logged too. The Judge's topic score comes from this ledger.

## 5. Interrupt handling
| Interrupter → target | Treated as | Effect |
|---|---|---|
| **User → YES or NO** | a point that side must address | Zoom out to S4, then +1 cycle: the interrupted side answers the user first, then the other side replies. The user's point goes in the ledger. |
| **User → Judge** | an **agenda change** | Add a topic (no limit) or remove one. Weights re-normalise; research starts for a new topic. The Judge confirms. |
| **YES ↔ NO** (AI interrupt) | debate drama | Happens within the cycle; no change to the count or the agenda. |

The target is whoever is speaking when the user interrupts.

## 6. Research / data
- **Two priority agents per topic:** a **YES researcher** and a **NO researcher**, each doing a *quick* search for the strongest facts on its side. They start in the cut-scene, first topic first.
- **Deep search** per topic runs in the background, and its results feed later cycles and topics.
- **Evidence cards** (the output format both search tiers share, built to drop straight into an argument):
  `{ id, topic_id, side, claim, evidence (the fact/stat), source_name, source_url, strength 1-5, tier }`
- Debaters may only state facts from cards, and each line cites card ids. The transcript turns those into source references.
- Research agents: A (Dust-OP).

## 7. Outputs
- **Verdict:** spectrum position (−100…+100), label (*Strong no / Lean no / Toss-up / Lean yes / Strong yes*), a 2-4 sentence explanation (including how the user's interrupts were weighed), and a per-topic breakdown (weight, score, deciding argument, whether the user added it).
- **Transcript:** every line in order, with footnoted sources, plus the user's interrupts and agenda changes.

## 8. LLM providers
- **Testing: Anthropic** (`ANTHROPIC_API_KEY`). **Deployment/prod: Gemini** (`GEMINI_API_KEY`).
- Every structured LLM call goes through one function, `ask(task, content, schema)`, which switches on `LLM_PROVIDER=anthropic|gemini`. The prompts and zod schemas are shared, so the game logic doesn't know which provider is answering.
- Every call falls back to a mock built from the user's own question if the provider is missing, slow or errors, so the trial always reaches a verdict.

## 9. Engine pieces (lib/debate)
| Piece | Does |
|---|---|
| `buildAgenda(question, profile)` | topics + weights + speed, opening and intro lines |
| `buildPersonas(question, profile)` | best (YES) and worst (NO) future-you profiles at their most likely moments |
| `research(topic, side, tier)` (A) | evidence cards |
| `argue(topic, side, persona, history, cards, userPoint?)` | one line from that persona, with cited cards |
| `scoreArgument(line)` | ledger entry (background) |
| `scoreTopic(topic, ledger)` | t, confidence, reasoning, Judge's line |
| `judgeInterrupt(text, agenda)` | add / remove topic |
| `verdict(agenda)` | explanation + line; spectrum computed in code |
| `orchestrator` | state machine: scenes, both loops, cycle counting, interrupts |

## 10. Owners outside D
- **Onboarding form** (age, situation, location, voice recording): C (UI) + B (ElevenLabs IVC clone → `voice_id`).
- **Research agents:** A.
- **Two voice deliveries** (best / worst) + the Judge from one clone: B.
