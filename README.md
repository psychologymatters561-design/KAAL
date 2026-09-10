# KAAL, thekaal.co

Series 01. Twenty numbered watches, one case design, four dials. A scroll
driven landing page built to sell to cold traffic.

One `index.html`, plain CSS, vanilla JavaScript, no build step, no npm, and
nothing loaded from another domain except the film while it still lives on
Cloudinary.

---

## Before the ads run

### 1. Upload the eight photographs and the film

`incoming/DROP.md` is the whole job, with the exact filenames. The page is
already wired to them.

Nothing breaks while they are missing. Every photograph that has not landed
renders as a designed panel reading "photograph pending" instead of a broken
image icon, so the site can go live before the files do.

### 2. The payment link

Find `var KAAL = {` near the bottom of `index.html`. Five lines govern the
commercial behaviour of the entire page.

```js
var KAAL = {
  checkout: "",            // the live Razorpay payment-page URL
  price:    "5,999",       // every price on the page reads from this
  edition:  20,
  sold:     [1, 2],        // the numbers already claimed
  film:     "https://res.cloudinary.com/...",
  dials:    { 1:"bone", 2:"onyx", 3:"brass", ... }
};
```

While `checkout` is empty the button is visibly inert and says so: *"Checkout
opens when the payment link goes live."* No dead `href="#"`, no fake funnel.
Paste the URL and every button on the page becomes real, and carries the
chosen number through as `?kaal_no=07`.

**Use a Razorpay Payment Page with a stock limit of 20, not a bare payment
link.** This is a static site on GitHub Pages with no backend, so it cannot
know a piece has sold. Razorpay's own inventory limit can, and closes the page
when the count runs out. Without it, two people can buy number 07.

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

The current mix is five of each, interleaved on purpose so there is no block
of consecutive numbers carrying one colour to shop from.

---

## How the page renders

### The film is the scroll

The hero is a real `<video>` whose transport is the scrollbar. Scroll position
inside a 340vh section maps to `currentTime`, eased, and the page is never
hijacked: nothing calls `preventDefault`, so there is no wheel to fight and no
touch momentum to reinvent. What makes it feel like silk is that every derived
value carries weight, not that the scrollbar was taken away.

Three details earned their place, and each one is a bug that was found by
running the thing rather than reasoning about it:

- **The film is fetched as a Blob, not streamed.** A ranged seek against a CDN
  is where scroll video usually falls apart. Behind an honest loading ring
  that reports real bytes, and only if the file is big enough to be worth
  waiting for.
- **Seeks are gated, and measured against the request rather than the clock.**
  The browser snaps a seek to the nearest decodable frame, so a target landing
  between two frames reads back as a miss on every frame, and the page sits
  there seeking forever without arriving. Comparing to what was last asked for
  makes arriving unambiguous.
- **A video that has never played does not reliably paint on a bare
  `currentTime` write.** One muted play, immediately paused, wakes the decoder.

Verified against a timecoded test clip: scroll 15% put the film at 15%, 60% at
60%, 100% at 100%, and scrolling back up ran it backwards. Frames confirmed
painting by drawing the video to a canvas and reading pixels, not by assuming.

### Five gates serve the still instead

The film is never fetched when any one of these is true: reduced motion is
requested, the viewport is under 900px, Save-Data is on, the connection
reports 2g or 3g, or there is no film configured. Those visitors get shot 7 as
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
- All eleven acts reveal in order on desktop and on a phone
- Scroll to film mapping measured linear across eight sample points, and
  correct in reverse
- Contrast on void: bone **16.3:1**, secondary **7.3:1**, tertiary **5.1:1**,
  gold **8.2:1**, and the button's dark-on-gold **8.2:1**. Bone measured on all
  four world backgrounds, worst case **15.6:1**. Everything passes AA.
- No text sits over a photograph anywhere on the page
- Keyboard focus visible on every focusable element
- `prefers-reduced-motion`: settled, film never fetched, dust removed
- JavaScript disabled: every act, the grid, the footer and the button render
- No horizontal overflow at 393px
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
```

**Dead weight still in the repo, kept rather than deleted without asking:**
`assets/js/three.min.js`, `assets/seq/`, `assets/seq-src/` and the older
`assets/img/*.webp` renderings are no longer referenced by anything. They cost
a visitor nothing, because nothing requests them, but they are about 4 MB of
history. Say the word and they go in one commit.

Published by GitHub Pages at the domain in `CNAME`. `.nojekyll` keeps the
files as they are.
