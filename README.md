# KAAL, thekaal.co

Series 01. Twenty numbered watches, one case design, four dials. A scroll
driven landing page built to sell to cold traffic.

One `index.html`, plain CSS, vanilla JavaScript, no build step, no npm, and
nothing loaded from another domain. The hero film is a sequence of stills in
this repo. The only line left that names another origin is the fallback under
the eight photographs that have not been shot yet, and a real photograph at
the matching filename switches it off for good.

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

This is the LAST thing on the page that reaches for Cloudinary. The hero used
to as well, on every load, and no longer does — see below.

### 2. The payment link

Find `var KAAL = {` near the bottom of `index.html`. A handful of lines govern
the commercial behaviour of the entire page.

```js
var KAAL = {
  checkout: "",            // the live Razorpay payment-page URL
  pay:      "",            // "" = payment page above, "standard" = checkout modal
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

### 2b. The other way to take money: Standard Checkout

`pay: "standard"` takes the buyer's card **on this page** instead of sending
them to a hosted Payment Page. It needs `api` set, because the worker does the
work: `POST /order` prices the watch and refuses a number that has gone, and
`POST /verify` checks Razorpay's signature before the page believes a payment
happened.

The trade is worth understanding before you flip it. The Payment Page brings
its own stock limit; Standard Checkout does not, so **the worker becomes the
only thing standing between two buyers and the same number**. That is why
`/order` refuses a sold or held number rather than just pricing whatever it is
asked for, and why it reads the price from `PRICE_PAISE` in `wrangler.toml`
instead of from the browser. A page that can name its own price is a page that
sells a ₹5,999 watch for ₹1.

Three things make it safe to run on a static site:

- **The key secret never leaves the worker.** The publishable `key_id` is sent
  to the browser in the `/order` response, which is also why no Razorpay key
  is written into `index.html`. `tools/check.mjs` fails the build if one ever
  is.
- **The price is the worker's.** `PRICE_PAISE` is a second copy of `price`, so
  `tools/check.mjs` fails the build if the two ever disagree.
- **The number is Razorpay's.** `/verify` reads which number sold from the
  order's own notes, never from the browser — otherwise one real payment could
  be used to mark all twenty sold.

To turn it on:

1. `wrangler secret put RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Check `PRICE_PAISE` in `wrangler.toml` matches `price` (₹5,999 → `599900`).
3. `wrangler deploy`, then set `api` to the worker URL and `pay` to
   `"standard"`.
4. Send one real ₹1 test payment through it before trusting it with a real
   ₹5,999 one. Watch `wrangler tail` while you do.

Leave `pay` empty and none of this code is reachable — the page behaves exactly
as it did before any of it existed.

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

So the film is delivered as frames: stills cut out of the same video,
preloaded, and painted to a canvas by scroll. No decoder in the loop, no
keyframes, no seeks. Painting an already decoded image is effectively
free, so it is frame exact and cannot stutter. This is how the scroll
films on the product pages you have seen are actually built.

**The stills are cut ahead of time and live in this repo.** They used to
be cut on demand by Cloudinary, at a size built out of the live viewport
— `so_{T},w_{W},h_{H},c_fill,g_center` — so every distinct combination of
timestamp, width and height was a video seek plus a transcode on someone
else's server before the first byte came back, and widths were rounded to
eighty pixels, which made very nearly every phone width its own cold
start. The preloading, the decode-before-paint and the blending were
never the lag. What they were waiting for was.

`tools/bake-hero-seq.sh` cuts them once, by hand, and the result is
committed under `assets/img/hero-seq/`. Same origin as the page, on the
CDN already serving it. Nothing is transcoded at scroll time because
nothing is transcoded at all.

Measured by wrapping `drawImage` and recording every painted frame, on
the real page in Chromium:

| | phone, 43 frames | laptop, 61 frames |
|---|---|---|
| distinct frames over a slow drag | **43 of 43** | **61 of 61** |
| largest gap between painted frames | **1**, no stepping at all | **1** |
| backwards jumps during a forward drag | **0** | **0** |
| forward jumps while dragging back | **0** | **0** |
| a hard flick | 33 paints, lands exactly on the last frame | 34 paints, same |
| Cloudinary requests, whole session | **0** | **0** |

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

`KAAL.frameCount` and `KAAL.frameCountSmall` are how many stills were
CUT — 61 at 1080x675 for landscape viewports, 43 at 400x880 for portrait
ones — and they have to match the files on disk, which `tools/check.mjs`
enforces. They are 61 and 43 rather than 60 and 44 because a fixed set of
files can only be sampled evenly at a whole-number stride, and a stride
has to divide n-1 to land on the last frame as well as the first. 60 and
42 divide by 2 and by 3. 59 and 43 divide by nothing, and an unevenly
sampled film is one whose motion speeds up and slows down twice a second.

Two sizes, not a continuum. The canvas is set to the frame's size and CSS
covers the stage with it, so `drawImage` is a one-to-one blit at every
viewport — and the canvas now has a constant size for the life of the
page, which means the iOS URL bar appearing mid scroll can no longer
reallocate it and blank a frame.

### Five gates serve the still instead

The frames are never fetched when any one of these is true: reduced
motion is requested, the viewport is under 340px, Save-Data is on, the
connection reports 2g, there is no sequence configured, or the device
reports a gigabyte of memory or two cores. **Phones are no longer locked
out**: a phone is paid for by spending less rather than nothing, so it
gets the film from the portrait tier at whatever evenly spaced fraction of
43 frames it can hold. Those visitors get the still as a full hero, which
was composed to be a complete first screen on its own. `?film=1` forces
the film on for reviewing the real thing on your own phone.

Gates three and four — Save-Data and 2g — read `navigator.connection`,
**which has never shipped in any WebKit**. They are real answers on the
Android half of this page's traffic and they are silence on every iPhone,
so they were the only throttle a phone had and they were not running. The
sixth gate and the frame budget read `deviceMemory` and
`hardwareConcurrency` instead, and `hardwareConcurrency` is answered
everywhere. A four-core device with no memory figure — which is what an
older iPhone looks like — now takes 22 frames where it used to take the
lot.

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
- **Hero frames served from this origin.** Chromium at 320, 390 and 1512px,
  plus a 390 viewport with `deviceMemory` deleted and `hardwareConcurrency`
  forced to 4 and to 6, and a phone held sideways at 844x390. Requests to
  `res.cloudinary.com` for the hero: **0 in every case**, against 22 to 60
  per session on the build before this one. Frames requested per session:
  43 portrait, 61 landscape, 22 on a low-memory or four-core device, 21 on
  a phone held sideways — every one of them an evenly spaced subset
- **The frame budget throttles WebKit, which it did not before.** A 390
  viewport with no `deviceMemory` and four cores took 32 frames on the old
  build and takes 22 on this one; the same viewport with six cores takes 43.
  The old reduction read `navigator.connection`, which no Safari implements
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

**Known, and older than this change:** at a 320px viewport the document is
11px wider than the viewport. Measured identically on `main` and on this
branch, in `ul.four` inside `div.hold`, which is nothing to do with the film.
It is not fixed here.

Still needs a person, and no headless browser substitutes for it: **a real
mid-range Android on real mobile data**, **a real iPhone** — the device the
frame budget was rewritten for is the one no headless Chromium can stand in
for — and a Lighthouse run.

## What is in here

```
index.html               the whole site
assets/fonts/            Instrument Serif and Inter, latin subsets, self hosted
assets/img/              the photographs (see incoming/DROP.md)
assets/img/hero-seq/     the hero film, baked to stills: tall/ and wide/
assets/img/hero-still.webp  the hero when the film does not run
tools/bake-hero-seq.sh   cuts hero-seq/ out of the film. Run by hand, never
                         at deploy: its output is committed, not built.
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
