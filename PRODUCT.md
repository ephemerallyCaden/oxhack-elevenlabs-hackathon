# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Visitors trying Roulette on their own laptops from the deployed link, alone at a desk, with a webcam and microphone. Secondary: the team presenting it at the OxHack ElevenLabs hackathon, and people arriving from a shared trial link (/t/[id]).

## Product Purpose
You speak a yes/no life decision. Real data is researched, and three future versions of you (Prosecution argues YES, Defense argues NO, the Judge mediates), speaking in your cloned voice with your face, argue it out in an Ace Attorney-style courtroom. You can interrupt them. The Judge delivers a verdict on a spectrum, with sources. Success: a visitor gets from the homepage into a trial quickly and leaves with a verdict they want to share.

## Positioning
The debate is performed by you, in your own cloned voice and face, as an interactive courtroom game, backed by researched evidence rather than generic advice.

## Operating Context
Onboarding: read a short paragraph aloud (voice clone + profile), take a front photo and a side photo (head cut-outs), confirm the question, then the trial. Returning visitors on the same device ("Remember me") skip onboarding. A shared demo laptop must make "I'm someone new" as easy as "that's me". Finished trials can be shared at /t/[id].

## Capabilities and Constraints
- Next.js 16 on Vercel; mock data whenever an API key is missing (the app always runs end to end).
- Homepage actions: Begin (onboarding), Skip setup (straight to court with the default voice and faces), Welcome back / I'm someone new / Forget me (delete my voice and face), and Watch a past trial.
- Past trials are stored for share links, but there is no endpoint that lists them yet (open decision: which trials are listed, and whether they're public).

## Brand Commitments
Name: Roulette, "Court of Future Selves". Tagline: "Your future is on trial." Terminology: interrupt shown as OBJECTION! / HOLD IT! / MOVE ON!. Prosecution = YES (blue suit), Defense = NO (red suit), the Judge.

## Evidence on Hand
- Courtroom art: public/assets/courtroom-bg-tall.png and its depth planes (public/assets/intro-layers/).
- Character pose art (public/assets/poses/), default head cut-outs (public/assets/heads/), pedestal (public/assets/pedestal.webp), expression particles (public/assets/expressions/).
- No real past trials to show yet: any listed trials in mockups are samples.

## Product Principles
- The courtroom is the product: every screen belongs to it.
- Getting into court beats explaining it.
- The visitor's voice and face are theirs: forgetting them is always one click away.
