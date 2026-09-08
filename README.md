# KAAL — thekaal.co

Series 01. Twenty numbered watches, one case design, four dials. A scroll
driven landing page built for cold traffic from Meta ads.

One `index.html`, plain CSS, vanilla JavaScript, no build step, no npm, nothing
loaded from another domain.

---

## Before the ads run

### 1. The payment link

Open `index.html`, find `const KAAL = {` near the bottom. Four lines govern the
whole page.

```js
const KAAL = {
  checkout: "",            // ← the live Razorpay payment-page URL
  price:    "5,999",       // every price on the page reads from this
  edition:  20,
  sold:     [1, 2]         // the numbers already claimed
};
```

While `checkout` is empty the button is visibly inert and says so: *"Checkout
opens when the payment link goes live."* No dead `href="#"`, no email funnel,
no ambiguity. Paste the URL and the button becomes a real link everywhere it
appears. Nothing else changes.

**Use a Razorpay Payment Page with stock limits, not a bare payment link.**
This is a static site on GitHub Pages with no backend, so it cannot know a
piece has sold. Razorpay's own inventory limit can, and closes the page when
the count runs out. Without that, two people can buy number 07.

`sold` drives the strike-throughs on the twenty, the remaining count, the
`<title>` and the share card. The grid printed in the HTML is the
no-JavaScript fallback; the config overrides it on load.

### 2. Confirm what was drafted, not supplied

Search `UNCONFIRMED` in `index.html`. Three commercial terms in the footer were
written to fill a legally required gap, not sourced from you:

- the seven-day returns window and its conditions
- whether shipping is included in ₹5,999
- country of origin (currently reads "to be confirmed")

These are binding, and the last is a declarable under the Legal Metrology
(Packaged Commodities) Rules. Fix the words before spending money on traffic.

### 3. Meta pixel

There is no pixel in the page yet. Note that twenty pieces is smaller than
Meta's learning-phase threshold of roughly fifty conversions per week, so you
will never optimise for Purchase. Optimise on an upper-funnel event that has
volume, or buy manually.

---

## About the imagery

The photography in `assets/img/` and the 27 frames in `assets/seq/` are AI
generated, and the owner has decided to ship them. That decision is recorded
here rather than buried: the day rings carry invented text (`THON TUE TRU
SAT`), and some bracelet runs do not hold together under close inspection.

The page is built to flatter them rather than expose them. Every photograph
sits under a radial vignette that darkens the caption band to roughly a third
of its original luminance, so the dial printing reads as texture rather than as
something a visitor tries to read. Worst-case measured contrast of bone text
over any photograph is 4.46:1, which clears AA for body text.

If real photographs are ever shot, they drop into the same filenames and
nothing else changes. `incoming/README.md` carries the shot list.

---

## How the page renders

Two tiers, chosen at runtime.

| | first view | gets |
|---|---|---|
| Phone, reduced motion, no JS | **99.6 KB** gzipped | every scene, every photograph, the dust field |
| Desktop, fine pointer | the above | plus the 27-frame sequence scrubbed by scroll, 1.1 MB, fetched from scene 6 |

**Three.js was removed.** It existed to stand in for photography that did not
exist, rendering the case as geometry. The photographs are in now, so 600 KB of
WebGL would only muddy them while costing every desktop visitor the download.
The dust field, which does its own perspective divide in about 2 KB, carries
the air instead. The scroll mechanism is unchanged.

Scroll drives everything through one value. `window.scrollY` is read on the
animation frame and eased into `camera.position.z`. **GSAP and ScrollTrigger
were removed**: a scrubbed ScrollTrigger is the known source of touch-scroll
bugs on iOS Safari and Android Chrome, and reading native scroll on rAF is
both smaller and steadier. The brief's mechanism — one scroll value driving the
camera — is intact; only the library is gone.

Each scene owns its geometry by distance from its own centre, so an actor is
fully present when its scene centres and exactly zero when its neighbour does.
Two objects can never crowd one frame. Scenes 4, 8 and 9 carry no geometry at
all, by design.

---

## Verified

Run in Chromium at 1440×900 and as a Pixel 5, both settled.

- No console errors, no failed requests
- All ten scenes reveal in order, on mouse wheel and on touch
- Contrast on void: bone 15.7:1, secondary text 5.4:1, gold 7.0:1 — all pass AA
- Keyboard focus visible on every focusable element, gold 2px
- `prefers-reduced-motion`: canvas removed, everything settled, Three.js not fetched
- JavaScript disabled: all ten scenes, the footer and the button still render
- Mobile first load 54.1 KB gzipped, of which 42.5 KB is the two fonts

Still untested, and it needs a person: **an actual mid-range Android handset on
actual mobile data**, and a real Lighthouse run. A headless browser on a
datacentre link is not that.

---

## What is in here

```
index.html               the whole site
assets/fonts/            Fraunces and Inter, subset, self hosted, 21 KB each
assets/js/three.min.js   r128, self hosted, desktop only
assets/img/og.jpg        the share card, typographic
assets/brand/            the KA∧L wordmark
assets/_unverified/      the AI generated images. Not referenced. Read its README.
incoming/                where real photographs land
docs/design-package.md   why the page is shaped this way
```

Published by GitHub Pages at the domain in `CNAME`, from whichever branch Pages
is pointed at. `.nojekyll` keeps the files as they are.
