# KAAL, thekaal.co

Series 01. Twenty numbered watches, one case design, four dials. A scroll
driven landing page built to sell to cold traffic.

One `index.html`, plain CSS, vanilla JavaScript, no build step, no npm, and
nothing loaded from another domain except the film while it still lives on
Cloudinary.

---

## Security

`SECURITY.md` is the full review: what was found, what it would have cost,
what is now closed in code, and — the half that matters more — the seven
dashboard settings that no commit can fix. Read it before the first ad runs.

The five that decide whether the money is safe:

1. Razorpay Payment Page: **fixed amount**, stock limit 20, field named
   `kaal_no`. Send one ₹1 test payment and confirm it is **rejected**.
2. `GITHUB_TOKEN`: fine-grained, this repo only, Contents read/write,
   never Workflows, with an expiry.
3. 2FA on GitHub, Razorpay, Cloudflare and **the domain registrar** — the
   registrar first, because everything else is downstream of DNS.
4. Cloudflare in front of `thekaal.co`, with a rate-limiting rule on the
   worker's route.
5. Subscribe `refund.processed` and `payment.dispute.created`, set
   `ALERT_TOKEN`, and read `/alerts` daily while the edition is live.

**`docs/LAUNCH-RUNBOOK.md` is that list as clicks** — every dashboard setting
in dependency order, with the command that proves each one took, and what to do
when a token is compromised or two people pay for one watch.

Three things watch, so none of it quietly stops being true:

```
node tools/check.mjs           # the repo's own rules          — every push
node tools/check-autocommit.mjs  # a stolen token's blast radius — every push to main
node tools/verify-live.mjs     # the live site and worker      — every morning, by watch.yml
```

---

## Before the ads run

### 1. Upload the eight photographs

`incoming/DROP.md` is the whole job, with the exact filenames. The page is
already wired to them.

**The site is live without them.** Every picture falls back in three steps,
and each step is a designed state: the photograph at its filename, then a
still cut out of your own film by Cloudinary at a percentage of its duration,
then a panel. Nothing ever renders as a broken image icon.

The frames are a safety net, not the plan, and nobody has inspected them:
this build environment cannot reach Cloudinary, so they were wired but never
seen. Look at the live site and judge them. A real photograph at the matching
filename wins outright and switches its frame off for good.

### 2. The payment link

Find `var KAAL = {` near the bottom of `index.html`. A handful of lines govern
the commercial behaviour of the entire page.

```js
var KAAL = {
  checkout: "",            // the live Razorpay payment-page URL
  price:    "5,999",       // every price on the page reads from this
  edition:  20,
  api:      "",            // the deployed edition worker, or "" for none
  heroDrift: 0.045,        // hero parallax, as a fraction of viewport height
  sold:     [1, 2],        // the numbers already claimed
  film:     "https://res.cloudinary.com/...",
  frames:   ".../so_{T},w_{W},c_limit/...",             // photograph fallbacks
  filmFrames: ".../so_{T},w_{W},h_{H},c_fill,g_center/...",  // the hero scrub
  dials:    { 1:"bone", 2:"onyx", 3:"brass", ... }
};
```

While `checkout` is empty the button is visibly inert and says so: *"Checkout
opens when the payment link goes live."* No dead `href="#"`, no fake funnel.
Paste the URL and every button on the page becomes real, and carries the
chosen number through as `?kaal_no=07`.

**Use a Razorpay Payment Page with a stock limit of 20, not a bare payment
link.** This is a static site on GitHub Pages, so the file itself cannot know a
piece has sold between two pushes. Razorpay's own inventory limit can, and
closes the page when the count runs out. Without it, two people can buy number
07.

**And deploy the edition worker if you want that collision caught before the
money moves.** Razorpay's limit stops the twenty-first sale; it does nothing
about two people both sitting on number 07 at the same moment. `worker/` closes
that: `GET /state` tells a live page what is actually gone, the page asks once
on load and once a minute while it is the visible tab, and a number sold under
a visitor's hands is struck through with *"Number 07 went while you were
looking. Choose another."* rather than becoming a refund and an apology.
Setting `api` to the deployed URL turns it on. Leaving it empty is not a
degraded mode — it is exactly how this site has always run, and every fallback
is tested that way.

`sold` drives the strike-throughs on the twenty, the remaining count, the rail
ticks, the nav, the sticky bar and the `<title>`.

### 3. Confirm what was drafted, not supplied

Search `UNCONFIRMED` in `index.html`. Two things in the footer are required on
display by the Consumer Protection (E-Commerce) Rules 2020 and are not yet
sourced from you:

- registered seller name, address, GSTIN, and the grievance officer's name,
  email and phone
- country of origin, a declarable under the Legal Metrology (Packaged
  Commodities) Rules

Also confirm whether shipping genuinely sits inside ₹5,999, which the footer
currently states.

### 4. Meta pixel

There is no pixel in the page yet. Twenty pieces is far below Meta's
learning-phase threshold of roughly fifty conversions per week, so you will
never optimise for Purchase. Optimise on an upper-funnel event that has volume,
or buy manually.

### 5. Getting found

The page is built for it. What is on the site already: schema.org for the
brand, the organisation, the product with its offer and return policy, and an
ItemList naming the dial every one of the twenty carries; a `sitemap.xml`; a
`robots.txt` that names the assistant crawlers individually rather than
leaving them to the wildcard; an `llms.txt` stating the whole edition in plain
text; snippet directives that let a search result or an AI answer quote more
than 160 characters; and a manifesto page written so that its sentences
survive being lifted out of context, which is how an answer engine quotes.

**None of that gets you indexed on its own.** Four things only you can do, in
the order they pay:

1. **Google Search Console and Bing Webmaster Tools.** Verify `thekaal.co`,
   submit `sitemap.xml`, and use "Request indexing" on the home page and the
   manifesto. Bing matters more than its market share suggests: several AI
   assistants read from its index rather than Google's.
2. **Put the real social URLs into the structured data.** There is a `sameAs`
   array waiting in the `Organization` block in `index.html` and it is empty,
   because inventing profile URLs would be worse than having none. Instagram
   especially — for an Indian watch brand it is the profile a search engine
   uses to confirm the two mentions are the same company.
3. **A Google Business Profile**, even without a shopfront. It is the fastest
   route to a brand panel on a name search.
4. **Be mentioned somewhere that is not your own site.** This is the one that
   actually decides brand-name ranking, and the only one no amount of markup
   substitutes for.

**On ranking for the bare word "kaal":** be realistic. It is a common Hindi
and Sanskrit word and a 2005 Bollywood film with two decades of accumulated
authority. Nothing on a twenty-piece site outranks that quickly, and chasing
it wastes the effort. What is winnable, and what buyers actually type:
*kaal watches*, *kaal watch india*, *kaal series 01*, *thekaal*, and the brand
plus a dial name. Those are the queries the markup, the manifesto and the
llms.txt are aimed at, and they are the ones that convert.

### 6. Before you push

```
node tools/check.mjs
```

No install, about a second. The push **is** the deploy here — Pages rebuilds
from `main` within a minute, in front of whatever traffic is running — so this
is the only gate between a mistake and a buyer. It checks that every local
asset the page names actually exists (Pages is case-sensitive, your laptop is
not), that `CNAME` and `.nojekyll` survived, that the script parses, that no
id is duplicated, that `dials` covers every number in the edition, that nothing
in the diff looks like a credential, and that `sold:` appears exactly once —
which is the contract the sold-sync worker's regex depends on. The same script
runs in CI on every pull request.

---

## The one commercial mechanic worth understanding

**The number is the product. The dial is an attribute of the number.**

Every one of the twenty numbers is bound to a dial in `KAAL.dials` before the
page goes live. A buyer chooses a number and sees which face it carries. They
keep full agency, so nobody is gambling at the moment of payment, which is
where uncertainty kills a sale. And you keep control of the mix, so no single
colour can sit unsold because everybody wanted a different one.

The lever nobody notices: **a number that has not been bought was never
promised to anyone.** If brass stalls, re-point the unsold numbers in
`KAAL.dials` and the mix rebalances silently. Buyers only ever see the current
state. Nothing was misrepresented, because nothing about an unsold number was
ever stated as permanent.

The current mix is six Emerald (01–06), four Midnight (07–10), four
Champagne (11–14) and six Ivory (15–20) — the edition as it was actually
made, in blocks rather than interleaved. Only `KAAL.dials` states this. The
grid, the number runs under the four faces and the labels a screen reader
announces are all derived from it at load, so there is one place to edit and
no second place to forget.

---

## How the page renders

### The film is the scroll, and it is not a video

The hero does not scrub a `<video>`, and that is the single most
important decision in the page.

Setting `video.currentTime` forces the decoder to jump to the nearest
**keyframe** and decode forward to the target. A normal export carries a
keyframe every one to three seconds, so one seek costs fifty to two
hundred milliseconds and lands on a chunky boundary. Drive that from
scroll and you get five to fifteen updates a second, visibly stepping.
No amount of easing hides it, because it is the codec, not the
animation. That is exactly what the first version of this page did and
exactly why it looked glitchy.

So the film is delivered as frames. Cloudinary cuts stills out of the
same video on demand, they are preloaded, and scroll paints them to a
canvas. No decoder in the loop, no keyframes, no seeks. Painting an
already decoded image is effectively free, so it is frame exact and
cannot stutter. This is how the scroll films on the product pages you
have seen are actually built.

Measured against a 48 frame test sequence, not reasoned about:

| | |
|---|---|
| scroll position to painted frame | exact at all nine sample points |
| distinct frames over a slow drag | 47 of 48 |
| largest gap between painted frames | **1**, meaning no stepping at all |
| backwards jumps during a forward drag | **0** |
| a flick from top to bottom | decelerates over 14 paints, lands exactly on target |

Three details earned their place, each one a defect found by running it:

- **The opening frame is fetched alone and first.** Requesting frames in
  a clever order is not enough: they all go out together, multiplex, and
  finish in any order. Going live on "any three have landed" opened the
  hero on whichever frame won the race and then eased backwards to the
  one the scrollbar was on, which read as the film rewinding the instant
  it appeared.
- **Going live is conditional on something being paintable**, never on a
  request merely having finished. An opening frame that errored used to
  take the still down with it and leave a black hero.
- **The wordmark clears the frame.** A product film keeps its subject in
  the middle, and so does a centred wordmark. It lifts away between three
  and sixteen percent so the watch gets the screen.

The hero is 230vh, not 340. At 340 it took two and a half screens of
scrolling to play the film through, which is what read as slow.

`KAAL.frameCount` is the one dial that trades smoothness against bytes.
48 on a laptop at 1280px wide, 24 on a phone at 720px.

### Five gates serve the still instead

The frames are never fetched when any one of these is true: reduced
motion is requested, the viewport is under 340px, Save-Data is on, the
connection reports 2g, or there is no film configured. **Phones are no
longer locked out**: a phone is paid for by spending less rather than
nothing, so it gets the film at 24 frames and 720px instead of 48 and
1280. Those visitors get shot 7 as
a full hero, which was composed to be a complete first screen on its own.
`?film=1` forces the film on for reviewing the real thing on your own phone.

The page is also complete with **no images and no film at all**, which is the
state it is in right now.

### One continuous world

A single fixed layer sits behind everything and its colour is a function of
which act owns the middle of the screen. Five worlds: void, stone, jade, onyx,
ember. That is what makes ten sections read as one building rather than a
stack of pages.

### Entrances that earn their own

Most things rise, because varying every single one is noise. The exceptions:
the wordmark draws itself stroke by stroke out of nothing; the four dials deal
in like cards; the returns section arrives from both sides and meets in the
middle, because that is what a door does; and the line about who this is for
has **no entrance at all**. On a page where everything moves, arriving already
still is the loudest entrance available.

### The rail

A hairline draws itself down the page carrying twenty ticks, two struck
because those numbers are gone. A numbered rail is a generic device almost
everywhere. Here the content genuinely is a sequence of twenty, which is the
one context where it is earned. Under 1180px it becomes a hairline across the
top instead.

---

## Verified

Chromium at 1440×900 and as a Pixel 5, run rather than reasoned about.

- No JavaScript errors and no page errors in any tier
- No horizontal overflow at 360, 390, 768, 1024, 1440 or 2560 px
- Keyboard: every number reachable and selectable with Enter, focus ring
  measured at 2px gold, sold numbers correctly unreachable
- All eleven acts reveal in order on desktop and on a phone
- Scroll to frame mapping exact at nine sample points and correct in
  reverse; largest gap between painted frames measured at 1, with zero
  backwards jumps during a forward drag
- All four loader branches exercised: frames available on desktop and on
  a phone, every frame blocked, and the opening frame alone failing. The
  still keeps the screen whenever nothing is paintable; there is no
  state that shows a black hero.
- Contrast on void: bone **16.3:1**, secondary **7.3:1**, tertiary **5.1:1**,
  gold **8.2:1**, and the button's dark-on-gold **8.2:1**. Bone measured on all
  four world backgrounds, worst case **15.6:1**. Everything passes AA.
- No text sits over a photograph anywhere on the page
- Keyboard focus visible on every focusable element
- `prefers-reduced-motion`: settled, film never fetched, dust removed
- JavaScript disabled: all eleven acts, **all twenty numbers with the two
  struck**, the footer and the button all render, and nothing is left invisible
  behind a reveal that will never fire. The twenty are printed into the HTML;
  the config rebuilds them on load.
- The main animation loop measured **asleep** when idle rather than assumed to be

Still needs a person, and no headless browser substitutes for it: **a real
mid-range Android on real mobile data**, and a Lighthouse run.

## What is in here

```
index.html               the whole site
assets/fonts/            Instrument Serif and Inter, latin subsets, self hosted
assets/img/              the photographs (see incoming/DROP.md)
assets/brand/            the KΛΛL wordmark, both A's bare, matching the dial
incoming/DROP.md         the eight filenames and the film encode
docs/design-package.md   why the page is shaped the way it is
docs/og-card.html        source for the share card, re-render at 1200x630
```

**Dead weight, now removed:** `assets/js/three.min.js`, `assets/seq/`,
`assets/seq-src/` and the older `assets/img/*.webp` renderings are gone. Every
filename was grepped against the whole repo first and none of them was
referenced by anything. They are recoverable from git history if a render in
there is ever wanted back.

Published by GitHub Pages at the domain in `CNAME`. `.nojekyll` keeps the
files as they are.
