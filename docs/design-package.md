# Why the page is shaped this way

Written against the master brand and build brief. Read that first; this records
what was built, what was deviated from, and what still needs your signature.

---

## 1. The finding that reshaped the build

Every image in the repository was AI generated. Not stylised, not retouched —
generated, and not depicting the watches you are selling.

The proof is in the text. Across the hero, the lineup, the share card and all
27 sequence frames, day rings read `THON TUE TRU SAT`, `THU SAO SRU`, `WIL WED
WED THE`, `SRJ`. One black dial repeats `SAT` three times at three rotations.
A day wheel is a stamped mass-produced part; even the cheapest quartz module
carries MON TUE WED THU FRI SAT SUN, spelled correctly, in order. Alongside
that: bracelet links that dissolve and re-form mid-run, a gold piece with no
crown and no subdial hands, subdial counts that change between watches said to
share one case, and a chapter ring numbered `20 25 70 75 45 88 80 100 110 120
130 131`, which is not a scale that exists.

The brief's own rule closed the question:

> do not invent product photography or fabricate a movement reveal to fill a
> gap. Placeholder canvas textures are the correct fallback until real assets
> arrive, not AI-generated stand-ins for the actual product.

So the files are quarantined in `assets/_unverified/`, unreferenced, with the
evidence written beside them. The site carries no product photograph.

This is not fastidiousness. The brand's entire argument is that it does not
borrow legitimacy — that is what Section 3 is protecting when it forbids
staging a mechanical reveal you cannot back physically. A generated photograph
is the same sin against a harder object: the buyer receives the watch, holds it
next to the hero image, and sees a different thing. On a twenty-piece edition
each buyer is five percent of the customer base. There is also exposure under
the Consumer Protection Act 2019 for misleading representation of goods, and
Meta's advertising policies prohibit ads that misrepresent the product — a
rejected ad account against a budget with no reserve is a total loss.

## 2. What the page shows instead

Not placeholders labelled "placeholder". Materials and light, honest about
being renderings, carrying the meaning of each scene.

| Scene | What is drawn | Why it is honest |
|---|---|---|
| 1 VOID | wordmark, dust, a ring barely sensed | nothing is claimed |
| 2 REVEAL | a lit torus, real cast shadow | a case silhouette as geometry, not a photograph of one |
| 3 COLOURWAY | four dials as CSS discs with their number ranges | these *are* the colours; they are labelled and screen-readable |
| 5 PRECISION | three marks | three functions, three strokes |
| 7 NUMBERED | a drawn caseback, then twenty numbers in space | the engraving as a diagram; two struck through |
| 8 RETIREMENT | nothing but dust | silence as the design device |
| 10 CLOSE | a closed box form | a box, presented as a box |

Scenes 4, 8 and 9 carry no geometry at all. The brief asked for that; the
strongest line in the whole site earns an empty frame.

## 3. Deviations from the brief, and why

**GSAP and ScrollTrigger removed.** The brief specifies them. Section 8 also
flags that scrubbed ScrollTrigger has known touch-scroll quirks on iOS Safari
and Android Chrome. Reading `window.scrollY` on the animation frame and easing
it into `camera.position.z` is 115 KB smaller, frame-synced, and cannot
desync. The mechanism the brief actually specifies — one scroll value driving
the camera — is unchanged. Only the dependency is gone.

**Three.js is desktop-only.** The brief mandates the Three.js dolly; Section 8
mandates that the page load fast on a mid-range Android on mobile data. At 146
KB gzipped these conflict, and the brief resolves it itself: *a cinematic site
that loads slowly on 4G defeats its own purpose before the first scene
renders.* Phones never request the file. They get the full typographic site
and a dust field that does its own perspective divide, at 54 KB total.

**Scene 3 has no WebGL object.** Four dials already exist in the DOM, crisper
and labelled and readable by a screen reader. A second set in WebGL competed
with them and won nothing.

**The repeated line is deployed, not rewritten.** "Twenty pieces. One design.
Never repeated." appears at scenes 2 and 4 in the brief's table. Verbatim twice,
two scenes apart, reads as a copy-paste error. Scene 2 sets it small beneath the
`01 — 20`; scene 4 gives it the full frame alone. Same words, whispered then
stated. No copy was changed.

**Scene 5's line is split at its own caesura.** "Day. Date. 24-hour." becomes
the three marks; "Three functions, one movement, zero compromise." sits beneath.
Every word present, in order, nothing added.

## 4. New copy, unlocked, for your review

The brief asked that anything not in its table be flagged. This is all of it.

| Where | Words | Note |
|---|---|---|
| title, share card, close | "Eighteen of twenty remain" | derives from `sold` |
| close | "Checkout opens when the payment link goes live." | the pre-launch state |
| close, once live | "₹5,999, shipped across India." | confirm shipping inclusion |
| scene 3 | "Green / Black / Golden / White", "01–06" etc. | from the brief's numbering |
| scene 5 | "Pointer" under Date | the brief says "pointer date" |
| footer eyebrow | "The part the scroll stays quiet about" | — |
| footer, four blocks | the piece, warranty, ordering, returns | see below |

The warranty block is sourced: 24 months, movement only, September 2026, no
dealer field. **The returns block is not.** Seven days, unworn, refund to
original method — that is a drafted default, and it is a binding commercial
term. So is whether shipping sits inside ₹5,999. So is country of origin, which
currently reads "to be confirmed" because guessing a Legal Metrology declarable
is worse than leaving it visibly open. All three are marked `UNCONFIRMED` in
the HTML.

## 5. Why the footer exists at all

The scroll is silent by design. Indian law is not optional about the rest: the
Consumer Protection (E-Commerce) Rules 2020 require seller identity, a
grievance contact and a returns policy on display, and the Legal Metrology
(Packaged Commodities) Rules require the declarations that go with a
pre-packed good, including on the listing.

A page that stays quiet about all of it is not more exclusive, it is
non-compliant. So the disclosure lives below the scroll, under its own line —
silence upstairs, the paperwork in the basement. It costs the narrative
nothing.

## 6. The number nobody has said out loud

Twenty pieces at ₹5,999 is ₹1,19,980 of revenue at a complete sellout. Against
₹28,000–40,000 of cost, ₹25,000 of ads, roughly ₹2,800 of payment fees and
₹4,000–8,000 of shipping twenty boxed units, the ceiling on a perfect outcome
is somewhere near ₹45,000–60,000.

That is not a criticism of the plan, it is the plan's actual shape: this is a
paid brand proof, not a revenue engine. Judge it on whether it produces twenty
buyers who talk. Which is exactly why shipping a generated photograph would
have been the expensive mistake, and why an inert honest button is better than
a live dishonest one.
