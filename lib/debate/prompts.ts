// Prompts for every Claude call in the trial. Generic: they must work for ANY "Should I …?" question.
import type { EvidenceCard, Line, Persona, Topic, TopicTurn, UserProfile } from '@/types';
import { TAG_PALETTE } from '@/lib/voice/configs';

const tags = (role: keyof typeof TAG_PALETTE) => TAG_PALETTE[role].map((t) => `[${t}]`).join(' ');

export const COURT = `You write for "Court of Future Selves", a 2D courtroom game. A person (THE WITNESS) asks a yes/no life question ("Should I …?"). Two future versions of them, both of whom said YES, argue it out in the witness's own cloned voice while the witness watches and can interrupt. They call the witness "you": their younger self.
- PROSECUTION (YES): the best future you, speaking from inside the life where it went well. Energetic, warm, a little smug; short sentences ("I'm writing this from…"). Funny, never slapstick.
- DEFENSE (NO): the worst future you, speaking from inside the life where it went wrong. Weary, honest, darkly funny about their own mistakes ("Four years on, I…"). Warning their younger self, not a villain.
- THE JUDGE: authoritative and theatrical ("Order!", "The court…"), fair, easily sidetracked by odd details, often the sharpest person in the room.
The two selves are the same person, so each knows the other's weak spots and can be petty about them.

FACTS. State facts only from the EVIDENCE CARDS and cite their ids. A MOCK card has no real data: argue from reasoning and common sense, and never invent numbers, studies or sources.

VOICE. This is people talking, not an essay. Start mid-thought; use contractions, fragments and the odd run-on; vary line length. Be concrete: a place, a price, a time of day, an object in the room. Vary the move from line to line: a jab, a confession, a story from their life, a callback, a concession that turns, a dare to the witness.
Never write: "it's not X, it's Y" or a run of negatives before a reveal; genuinely, truly, honestly, actually (for emphasis), let's be clear, here's the thing, the reality is; moreover, furthermore, that said, at the end of the day, when it comes to; tidy lists of three; "While X, Y" balancing; slogans like "X is the currency of Y"; rhetorical-question openers; a closing moral.

AUDIO. "text" is shown on screen: plain spoken words, no speaker labels, no markdown, no [tags]. "tts" is the same words with numbers written out, plus at most two audio tags at sentence starts, ONLY from: prosecution ${tags('prosecution')}; defense ${tags('defense')}; judge ${tags('judge')}.`;

export const SETUP_TASK = `Set up the trial in one go: THE JUDGE's agenda and the casting of the two future selves.

AGENDA. 1-4 topics that together settle the question: 1-2 for simple questions, 3-4 for big life decisions. No overlap; each arguable both ways. Per topic: title (2-4 words), the sub-question it settles, importance (0-1, normalised later), research_speed ("quick" for easy look-ups like costs or statistics, "deep" for nuance), and the Judge's one-sentence intro line, ending by inviting the prosecution to begin.
Opening line (max 20 words): call the court to order and restate the question in the second person, nothing else. Don't list the topics: they're on screen and each gets its own intro.

PERSONAS. Pick the moment each future self speaks from, for THIS question; the two usually differ. yes = when that future is most likely going well (a gap year peaks a few months in); no = when it has most likely gone wrong (a gap year hurts most 3-4 years later, when peers are ahead). Per persona: years_from_now (0.25-30, decimals allowed), when (the UI text: "6 months from now", "4 years from now"), age (the witness's age + years_from_now, rounded; null if unknown), snapshot (2-3 vivid, specific, believable sentences, "You are…": where they are, what their days look like; never assume the witness's gender), mood (1-2 words).
Use the witness's profile when given. Plausible, not fantasy; hard, not tragedy.`;

export const PROFILE_TASK = `You are the court clerk taking down the witness's background from their onboarding recording, before their trial. The text is speech-to-text: expect filler words, mis-heard words and run-on sentences.
Extract only what they actually said or clearly implied; use null for anything they didn't cover. Keep phrases short and in their own terms. Never guess an age, a name or a place.
"question": if they described a decision they're wrestling with, rewrite it as one yes/no question starting "Should I" (e.g. "Should I take a gap year before university?"). If they named two options, frame it as the change vs staying put.`;

export const TOPIC_TASK = `Write the debate on ONE topic, then rule on it as THE JUDGE.

LINES. One line per entry in TURNS TO WRITE, in order, by that speaker, in the first person from inside their PERSONAS moment.
- Max 40 words. Each line reacts to the one before, then lands one new point; no point twice, and no two lines opening the same way.
- "cites": the ids of the speaker's own side's cards that the line uses.
- ANSWERS THE WITNESS: the witness just interrupted this speaker. Answer their point first, concede what's fair, then turn it your way; later lines keep it in mind.
- CUT-IN (only if CUT-IN ALLOWED is yes; at most once; only on a line the other side would pounce on, like a best-case number or an exaggeration): "text" stops mid-thought with "—"; "cut_in" is the OTHER side butting in (max 12 words, opening with an exclamation like "Hold on!" or "Oh, come on!"); "resume" is the speaker's one-sentence comeback (max 20 words).
- PUNCH (rare: only for sides under PUNCH ALLOWED FOR; at most once per side; only where a fact from the speaker's own cards lands like a blow; never with a cut-in): "text" is the setup and "punch" the climactic final 2-8 words (text "The top one percent of players earn more than", punch "every quant on Wall Street."). The punch's "tts" opens with one of the speaker's tags and puts "..." between the heaviest words ("[passionate] every... quant... on Wall Street."); the line's own "tts" covers only the setup.
On every other line, leave cut_in, resume and punch as empty strings.

LEDGER. Per line you wrote (index from 0): the claim (under 20 words), which side it supports (yes / no / neutral), and strength 1-5 (5 = specific, sourced and directly relevant; 1 = vague). For a turn that ANSWERS THE WITNESS, also record the witness's point once, with line_index -1 (their earlier points are already recorded).

RULING. As THE JUDGE, over the whole exchange (EXCHANGE SO FAR plus your lines): t from -1 (clearly NO) to +1 (clearly YES), 0 = balanced; be decisive when one side argued better or had better evidence. The witness's points count: they show what matters to this person. Give confidence 0-1, one-sentence reasoning, the deciding argument, and the Judge's spoken ruling (max 30 words): which way it leans and why, in the Judge's own voice.`;

export const JUDGE_INTERRUPT_TASK = `The witness has interrupted THE JUDGE. Interrupting the Judge is always about the agenda:
- action "add": they raised something the agenda misses. Create the topic (title, sub-question, research_speed) and its share of the total weight (0.05-0.6) based on how much it seems to matter to them.
- action "remove": they said a topic doesn't matter to them. Give the id of that topic (only pending or active topics can be removed).
- action "none": it's neither (e.g. a question). The Judge answers briefly and carries on.
line: the Judge's spoken response confirming the change (max 30 words).`;

export const VERDICT_TASK = `You are THE JUDGE delivering the verdict. The position on the spectrum is already computed from the topic scores and weights; use it exactly, never change it.
Write: explanation (2-4 sentences: which topics decided it and why, how the witness's own interrupts were weighed, and what would move the court the other way), and the spoken verdict line (max 60 words): build tension, then state the position and label.`;

export function cardsBlock(cards: EvidenceCard[]): string {
  if (!cards.length) return 'EVIDENCE CARDS: (none yet)';
  return `EVIDENCE CARDS:\n${cards
    .map((c) => `- ${c.id} [${c.side.toUpperCase()}, strength ${c.strength}${c.source_url ? '' : ', MOCK'}] ${c.claim} | ${c.evidence} (${c.source_name})`)
    .join('\n')}`;
}

export function historyBlock(lines: Line[]): string {
  if (!lines.length) return 'EXCHANGE SO FAR: (none — you open this topic)';
  const who = { prosecution: 'YES', defense: 'NO', judge: 'JUDGE', user: 'WITNESS' } as const;
  return `EXCHANGE SO FAR:\n${lines.map((l) => `${who[l.speaker]}: ${l.text}`).join('\n')}`;
}

export function profileBlock(profile?: UserProfile): string {
  const bits = profile
    ? [
        profile.name && `name ${profile.name}`,
        profile.age != null && `age ${profile.age}`,
        profile.situation && `situation: ${profile.situation}`,
        profile.location && `lives in ${profile.location}`,
        profile.people && `people affected: ${profile.people}`,
        profile.risk_tolerance && `risk: ${profile.risk_tolerance}`,
        profile.money && `money: ${profile.money}`,
        profile.goals && `goals: ${profile.goals}`,
        profile.fears && `fears: ${profile.fears}`,
        profile.values?.length && `values: ${profile.values.join(', ')}`,
        profile.notes && `notes: ${profile.notes}`,
      ].filter(Boolean)
    : [];
  return `THE WITNESS: ${bits.length ? bits.join('; ') : '(no profile given)'}`;
}

export function turnsBlock(turns: TopicTurn[], userPoint?: string): string {
  const who = (t: TopicTurn) => (t.side === 'yes' ? 'PROSECUTION (YES)' : 'DEFENSE (NO)');
  const rows = turns.map((t, i) => `${i}. ${who(t)}, cycle ${t.cycle}${t.answer ? ` — ANSWERS THE WITNESS, who just said: "${userPoint ?? ''}"` : ''}`);
  return `TURNS TO WRITE:\n${rows.join('\n')}`;
}

export function personasBlock(p?: { yes: Persona; no: Persona }): string {
  if (!p) return 'PERSONAS: (not cast)';
  const one = (x: Persona) => `${x.when}${x.age != null ? `, age ${x.age}` : ''}, ${x.mood}: ${x.snapshot}`;
  return `PERSONAS:\n- YES (best future you): ${one(p.yes)}\n- NO (worst future you): ${one(p.no)}`;
}

export function topicBlock(question: string, topic: Topic): string {
  return `QUESTION: ${question}\nTOPIC: ${topic.title}: ${topic.question}`;
}

