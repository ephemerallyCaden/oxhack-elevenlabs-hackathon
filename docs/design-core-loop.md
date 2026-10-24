# Core logic design: the Court of Future Selves

Status: **draft, replaces all earlier debate designs** · Owner: D (awckiu)

## 1. The game in one paragraph
The user asks a yes/no question: "Should I …?". The answer isn't yes or no but a position on a **spectrum** from *definitely no* (−100) to *definitely yes* (+100). Three characters argue it in a 2D courtroom: **the Prosecution (YES)**, **the Defense (NO)** and **the Judge (mediator)**. The Judge sets the agenda of topics. For each topic, YES and NO argue (up to 3 cycles) while the Judge keeps score. After each topic the Judge moves the needle on the spectrum, weighted by how important that topic is. At the end the Judge gives a verdict: where they landed on the spectrum and why. Afterwards the user gets the full transcript, with every fact linked to its source.

## 2. Scenes (all 2D)
| Scene | Shot | When |
|---|---|---|
| **S1 YES** | close-up on the Prosecution | YES is speaking |
| **S2 NO** | close-up on the Defense | NO is speaking |
| **S3 Judge** | close-up on the Judge | agenda, topic intros, scoring, verdict |
| **S4 Witness view** | zoom-out: all three looking at the user (camera = user) | user asks the question, user interrupts |
| **Cut-scene** | transition / "the court prepares" | hides the agenda generation + first research |

Every line of dialogue picks its scene from its speaker. Scene changes are cuts, so a camera system isn't needed.

## 3. Loops
```
USER QUESTION  (S4)
  → CUT-SCENE: Judge builds the agenda (1-N topics, weighted) + research starts
  → OUTER LOOP: for each topic on the agenda (quickest-to-research first)
       Judge introduces the topic                                   (S3)
       → INNER LOOP: up to 3 cycles of  YES argues → NO rebuts       (S1/S2)
            · background: each argument is scored as pros/cons → passed to the Judge
            · user interrupt extends the loop (doesn't use up a cycle)
       → Judge scores the topic and recalculates the spectrum       (S3)
  → VERDICT: final spectrum position + reasoning per topic         (S3)
  → TRANSCRIPT: every line, with source references
```

### 3a. Outer loop: the Judge's agenda
- **Agenda** = 1-N topics, each with a `title`, the `question` it settles, an `importance` weight (0-1, normalised to sum 1) and `research_speed` (`quick` / `deep`).
- N depends on how complex the question is: 1 for "Should I buy this jacket?", up to 3-4 for "Should I drop out to start a company?".
- **Order:** the topic whose facts are quickest to find goes first, so the debate starts fast while deep research for later topics runs in the background.
- After each topic, the Judge produces a **topic score** `t ∈ [−1, +1]` (lean NO … lean YES) and a confidence. The **spectrum** is the importance-weighted average of the scored topics × 100.
- The agenda can change mid-trial through user interrupts (§4).

### 3b. Inner loop: YES vs NO on one topic
- One **cycle** = YES speaks, then NO responds. **Maximum 3 cycles** per topic, unless the user interrupts.
- Each argument has to use the evidence cards for its side (§5) and respond to the last thing the other side said.
- **Background scoring:** after every argument, a fast call extracts `{claim, side, evidence_ids, strength 1-5}` into the topic's **pros/cons ledger**. The Judge's topic score is computed from that ledger, so the Judge scores what was actually argued.
- Early stop: if a side has nothing new (repeats itself or concedes), the Judge may close the topic before 3 cycles.

## 4. Interrupt handling
| User interrupts… | It's treated as | What happens |
|---|---|---|
| **YES or NO** (while they speak) | a point the interrupted side must address | Cut to S4, then back. The interrupted side's next line **must answer the user's point**. The other side may reply. The point goes in the ledger as a `user` entry. The cycle doesn't count toward the 3. |
| **The Judge** | an **agenda change** | Add a topic ("what about my family?") or remove one ("I don't care about money"). The Judge confirms, assigns or re-normalises weights, and research starts for any new topic. |

## 5. Research / data
- **Two priority agents per topic:** a **YES researcher** and a **NO researcher**, each doing a *quick* search for the strongest facts on its side. They start in the cut-scene, for the first topic first.
- **Deep search** per topic runs in the background (more queries, better sources). Its results land in the evidence pool and get used in later cycles and topics.
- **Evidence cards** (the output format both search tiers share, built to drop straight into an argument):
  `{ id, topic_id, side: 'yes'|'no', claim, evidence (the stat/fact), source_name, source_url, strength 1-5, tier: 'quick'|'deep' }`
- Debaters may only state facts that come from cards, and each line cites card ids. The transcript turns those ids into source references.

## 6. Outputs
- **Verdict:** spectrum position (−100…+100) with a label (*Strong no / Lean no / Toss-up / Lean yes / Strong yes*), a 2-4 sentence explanation, and a per-topic breakdown (weight, score, deciding argument).
- **Transcript:** every line in order (speaker, scene, text) with footnoted sources from the cited cards, plus the user's interrupts and agenda changes.

## 7. Engine pieces (lib/debate)
| Piece | Kind | Speed |
|---|---|---|
| `buildAgenda(question)` | Claude call → topics + weights + speed | fast |
| `research(topic, side, tier)` | search agent → evidence cards | quick ≤ 5s / deep ~30s |
| `nextArgument(topic, side, ledger, cards, userPoint?)` | Claude call → one line + cited card ids | fast (generated while the previous line plays) |
| `scoreArgument(line)` | Claude call → ledger entry | fast, background |
| `scoreTopic(topic, ledger)` | Claude call → t, confidence, reasoning | fast |
| `handleInterrupt(target, text, state)` | Claude call → side response OR agenda change | fast |
| `verdict(agenda, scores)` | Claude call; spectrum computed in code, not by Claude | fast |
| `orchestrator` | state machine driving scenes + loops | — |

## 8. Points to decide (see chat)
