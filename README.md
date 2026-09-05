# काल / KAAL — thekaal.co

A scroll driven landing page for काल Edition 01, built for cold Meta ads traffic.
One `index.html`, plain CSS and vanilla JavaScript, no build step, no npm.

## Change these before the ads go live

Open `index.html`, find the `const KAAL = {` block near the bottom, and edit
four lines. Everything on the page follows from them.

```js
const KAAL = {
  buyUrl:  "",              // ← paste the Razorpay or Shopify payment link here
  price:   "4,999",         // ← every price on the page reads from this
  edition: 20,              // ← how many pieces exist
  email:   "connect@thekaal.co"
};
```

While `buyUrl` is empty every Buy button opens a pre written email to
connect@thekaal.co with name, phone and address fields, so the page is never a
dead end. The moment you paste the payment link, the same buttons go straight
to checkout.

## Meta pixel

Search `META PIXEL` in `index.html` and paste the snippet from Events Manager
between the two comment lines. The page already fires the events:

| event | when |
|---|---|
| `ViewContent` | page loads |
| `CustomizeProduct` | a visitor winds the dial |
| `InitiateCheckout` | Buy is clicked, once `buyUrl` is set |
| `Lead` | Buy is clicked while it is still the email fallback |
| `Contact` | any click on connect@thekaal.co |

## Going live

The site is served by GitHub Pages at the domain in `CNAME` (thekaal.co).
It publishes from whichever branch Pages is pointed at, so this work reaches
the live domain when it is merged into that branch.

`.nojekyll` is present so Pages serves the files exactly as they are.

## What is in here

```
index.html          the whole site
assets/img/         29 files, the real product photography, WebP with srcset
assets/fonts/       6 files, subset to the characters this page uses
assets/js/          GSAP and ScrollTrigger, self hosted
docs/design-package.md   why the page is shaped the way it is
```

Nothing is loaded from another domain. No Google Fonts, no CDN. That removes
two DNS lookups and two TLS handshakes from the critical path, which matters
when the visitor arrives from an Instagram ad on 4G.

## If JavaScript or GSAP never loads

The page renders as a finished static site: every headline, all five spec
cards, the comparison, the twenty edition numbers, the questions, and a
working Buy button. Motion is opted into, never assumed.
