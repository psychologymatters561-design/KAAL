# The funnel, and how fast the page is

## What is measured

Every step from landing to paying is an event. `assets/tags.js` sends them
to the Meta Pixel (`1607748840888926`). GA4 is wired but has no ID yet: put
one in `TAGS.ga4` and the same events go there too. Nothing else on the page
sends data anywhere.

| Step | Meta event | GA4 event | Fires when |
|---|---|---|---|
| Landed | `ViewContent` | `view_item` | the page loads |
| Watched the film | `HeroComplete` | `hero_complete` | the hero scrub reaches its last frame, once |
| Leaned toward a dial early | `EarlyDial` | `early_dial` | a dial is tapped in "Which one is yours?" |
| Asked for a dial from its act | `ContextCta` | `ctx_cta` | "Emerald · 4 of 6 remain → Choose yours" is tapped |
| Chose a dial | `CustomizeProduct` | `select_item` | any dial is chosen in the twenty |
| Chose a number | `AddToCart` | `add_to_cart` | a number is chosen |
| Saw their caseback | `CasebackView` | `caseback_view` | the piece turns to "LIMITED EDITION NO. 07" |
| Added the gift card | `GiftOrder` | `add_gift` | the gift option is turned on |
| Opened checkout | `InitiateCheckout` | `begin_checkout` | the buy button is pressed (with details before payment on, this opens the "Where should it go?" form) |
| Gave their details | (not sent to Meta or Google) | (not sent) | the form is completed and Razorpay opens; counted only in the site's own daily report, with nothing about who |
| Paid | `Purchase` | `purchase` | the receipt page, once per payment id (the worker sends the same event server-side, so Meta counts it once) |
| Joined Series 02 | `Lead` | `generate_lead` | the email is accepted |
| Checked who is selling | `ProvenanceClick` | `provenance_click` | "Who is selling this →" |
| Came from a shared number | `DeepLink` | `deep_link` | the page opens on `#n7` and the like |

**Reading it once a week.** In Meta Events Manager, put these side by side
for the same seven days: ViewContent → HeroComplete → AddToCart →
InitiateCheckout → Purchase. The biggest drop between two neighbours is the
one step worth working on that week. Small numbers swing a lot: with a few
hundred visits, treat any single week as a hint, not a verdict.

## Speed, before and after

Measured the same way for both: Chromium at phone size (390×844, 3×), CDP
"slow 4G" (150ms round trip, 1.6Mbps), CPU slowed 4×, three runs each,
median shown. "Before" is the live site as it was on 2 October 2026
(`live-snapshot-2026-10-02`), "after" is this branch.

| | Before | After | |
|---|---|---|---|
| Largest Contentful Paint | 1,048ms | 1,068ms | the same, within run-to-run noise (1,032–1,124ms) |
| Hero picture on screen | 2,341ms | 647ms | 3.6× sooner: the poster is now the film's own first frame (13KB against 52KB) and no longer waits behind a second font preload |
| Interaction to Next Paint | 144ms | 160ms | slightly slower; under the 200ms "good" line in 5 of 6 runs (one run each side touched 200 and 216) |
| Cumulative Layout Shift | 0 | 0.0005 | nothing a person can see |
| Film frames before LCP | n/a | 0 | the film never competes with the first screen |

**The scrub under a hard fling** (phone size, CPU slowed 4×, a throw from the
top of the film to the end and back): no blank frame, the largest jump
between two painted frames 12 frames (half a second of film), back to a
crisp single frame as soon as the scroll stops.

**What this cannot measure.** These are Chromium numbers on a server. An
iPhone runs a different engine, and the 3D world needs a real GPU (this
machine has none, so the world steps aside here exactly as it would on a
device without one). The test that matters is on your own phone: see the
pull request for what to try.

## A proposal, not installed: Microsoft Clarity

Events say *where* people leave. They do not say *why*. Clarity is free and
records anonymous sessions and heatmaps: where people stop scrolling, what
they tap that is not a button, where they hesitate.

It is **not** on the page, because it is a new third-party script and that is
your call. If you want it:

1. Sign up at clarity.microsoft.com, add thekaal.co, copy the project ID.
2. Ask for it to be added; it is one script tag, loaded after the page.
3. Add one line to the privacy section of `legal.html` saying sessions are
   recorded anonymously to improve the site. India's DPDP Act asks you to
   say so. Clarity masks typed text by default; leave that on.

Watch ten recordings of people who reached the twenty and did not pay. That
is usually worth more than a month of funnel charts.
