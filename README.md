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

Two tiers, chosen at runtime. Neither is a cut-down of the other; they are two
ways of drawing the same corridor.

| | who gets it | what it is |
|---|---|---|
| **A** | desktop, fine pointer, ≥900 px, WebGL present | a real Three.js `PerspectiveCamera` dollying z +4 → −34. The photographs are textures on planes standing at their own depths, so the parallax between them is a projection matrix. Dust is a point cloud with its own perspective divide; haze slabs pass the lens. |
| **B** | phones, reduced motion, no WebGL, no JS | the same photographs as DOM images, the same scroll value, a 2 KB dust field. **Three.js is never fetched.** This is the tier the ad budget actually lands on. |

First view on a phone is about **119 KB**, of which 42 KB is the two fonts.
Desktop adds 145 KB gzipped of Three.js, deferred until after first paint, and
1.1 MB of scroll frames fetched a scene early.

**Scroll is never hijacked.** `window.scrollY` is read on the animation frame
and eased into `camera.position.z`. GSAP and ScrollTrigger stay out: a scrubbed
ScrollTrigger is the known source of touch-scroll bugs on iOS Safari and
Android Chrome, and there is nothing here to desync because nothing calls
`preventDefault`. Verified with real touch events, not mouse events pretending.

### The photograph is a framed still, not a background

This is the one decision the rest of the design hangs off. The picture sits in
a band in the upper part of the frame; the type lives in the void underneath
it. Two things follow.

**Legibility.** Bone on void is 15.7:1. Bone over a lit dial is a coin toss,
and the build before this one had to pour a vignette over every photograph to
win that toss — which is exactly why the images read as murky. With nothing
resting on the picture the scrim is decoration, so the photographs are allowed
to be bright.

**Sharpness.** A 1200 px photograph stretched over a 2560 px monitor is being
asked for detail it does not have, and no shader invents it. Held to an 1180 px
plate it is doubled at worst on a retina panel and exactly itself on
everything else. That is the whole of the fix, and it costs nothing but
restraint. `PLATE_MAX_CSS_W` in `index.html` is the cap; raise it the day 4K
sources land. See `incoming/PICKUP.md` — four of them are already paid for and
waiting.

The plate shader also runs a four-tap unsharp mask, because the GPU is still
magnifying, and feathers its own edges so the picture dissolves into the void
instead of ending at a rectangle.

### Three things that are not obvious from reading the code

- **Plates have a depth of field.** Ownership alone cannot hide a neighbour: a
  plate the lens has nearly reached fills the whole frame, so three percent of
  it is a full-screen wash, and the eased camera is always slightly behind the
  scroll. A plate now exists only inside a narrow window either side of its
  focus distance, and the lens travels ~3.7 units between scene centres, so a
  neighbour is always outside it.
- **Plates follow their caption.** A sticky hold rides the top of the frame
  until its section's bottom catches it, then it climbs away. The plate carries
  the same displacement, so a picture and the words it belongs to move as one
  unit rather than the photograph hanging in the air while the line leaves.
- **Depth is measured, not assumed.** Every depth derives from where a section
  actually sits, so a stale measurement points the camera at the wrong scene. A
  `ResizeObserver` on the scroll body catches webfonts swapping, images landing
  and a phone's URL bar collapsing.

### Scene 3 carries the move

The 27 recorded frames were shot pushing in on the row of four. Played
backwards they pull out from one dial to all four — which is the sentence that
scene is already making, so the camera says it too. Desktop only; phones get
the still.

---

## Verified

Chromium at 1440×900 and as a Pixel 5, both settled, run rather than reasoned
about.

- No console errors, no page errors, no failed requests, in either tier
- All ten scenes reveal in order, on wheel and on **real dispatched touch
  events** — a swipe run drives 0 → 9778 px with all ten lit
- Contrast on void: bone **15.69:1**, secondary **5.43:1**, gold **6.97:1** —
  all pass AA. No text sits over a photograph anywhere on the page.
- Keyboard focus visible on every focusable element: 2 px gold ring, measured
- `prefers-reduced-motion`: settled, stage removed, Three.js never fetched
- JavaScript disabled: all ten scenes, six photographs, footer and button render
- Phone first view ≈119 KB; Three.js confirmed **not** requested on mobile
- OG, Twitter and canonical tags all resolve

Still needs a person, and no headless browser can stand in for it: **an actual
mid-range Android handset on actual mobile data**, and a real Lighthouse run.
The software renderer here manages 7 fps, which says nothing about a real GPU
but says plainly that this has not been watched on hardware.

## What is in here

```
index.html               the whole site
assets/fonts/            Fraunces and Inter, subset, self hosted, 21 KB each
assets/js/three.min.js   r128, self hosted, desktop only, deferred
assets/seq-src/          the crop the generated pull-back was anchored on
assets/img/og.jpg        the share card, typographic
assets/brand/            the KA∧L wordmark
assets/_unverified/      the AI generated images. Not referenced. Read its README.
incoming/                where real photographs land
incoming/PICKUP.md       five paid-for files still sitting in Higgsfield
docs/design-package.md   why the page is shaped this way
```

Published by GitHub Pages at the domain in `CNAME`, from whichever branch Pages
is pointed at. `.nojekyll` keeps the files as they are.
