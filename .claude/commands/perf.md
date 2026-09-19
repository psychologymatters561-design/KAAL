---
description: Profile and fix the scroll/render performance of the KAAL page — measured, not guessed.
argument-hint: [optional focus, e.g. "mobile", "hero scrub", "first paint"]
allowed-tools: Bash, Read, Grep, Glob, Edit
---

Read `.claude/house-rules.md` first. Every rule there binds this run.

Focus for this pass: **$ARGUMENTS** (empty = the whole scroll path, first paint
to the claim button).

This is a cold-traffic landing page. A visitor who sees a jank on the hero
leaves before reading the price. Performance here is revenue, not hygiene.

## The suspects, by name

Do not start by hunting. Start by confirming or clearing these, because they
are where this specific page can actually hurt:

**The loop** — `tick()` near `index.html:1389`. One rAF calls seven `drive*`
functions per frame. Check in this order:
- Forced synchronous layout. `S.max` reads `scrollHeight` every tick;
  `driveChrome`, `drivePlates`, `driveRail`, `heroProgress` each call
  `getBoundingClientRect()`. If any of them runs *after* a style write or a
  `classList.toggle` in the same tick, the browser relayouts mid-frame — every
  frame. Establish the actual read/write order before claiming a fix.
- The `awake = 14` idle counter. Confirm it genuinely parks the loop
  (`running = false`) when the page is still, and that nothing re-wakes it in
  a cycle. A loop that never sleeps costs battery on every phone that opens
  the page.
- Per-tick allocation and repeated `$()` lookups inside the drive functions.

**The frame sequence** — `loadFilm()` and `SEQ` near `index.html:914–1000`.
- Memory: 48 decoded frames at 1280w (24 at 720w on small) held as live
  `Image` objects. Decoded bitmaps, not JPEG bytes — do the arithmetic and say
  the number out loud. This is the single most likely cause of a low-end
  Android tab dying, and nobody has measured it.
- `nearestReady()` is a linear scan per paint while frames are still arriving.
  Bound it or prove it is cheap.
- `sizeCanvas()` on every resize reallocates a full-viewport canvas at up to
  2× DPR. Check what fires it on a mobile URL-bar show/hide, where `resize`
  storms.
- `paintFrame` guards on `SEQ.painted`; verify the guard actually prevents
  redundant `drawImage` during a slow scroll.

**Paint cost** — `backdrop-filter: blur(9px)` on the nav (`index.html:150`),
stacked `drop-shadow()` filters on the wordmark (`:215`), `will-change` on the
stage and markwrap (`:195`, `:212`), the `position: sticky` stage, and the
`#dust` canvas. Each is cheap alone; check what composites together during the
hero scroll, and whether any `will-change` is left on a layer permanently.

**First paint** — two preloaded woff2, `font-display: swap`, inline
everything. The film is deliberately deferred to `load`. Verify that deferral
still holds and that nothing new blocks the first screen.

## How to measure, in this environment

Chromium and Playwright are already installed (`PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`,
do **not** run `playwright install`). Serve and drive it:

```
python3 -m http.server 8000 --directory . &
```

Then script a scroll and collect real numbers: long tasks via
`PerformanceObserver`, layout-shift entries, `performance.memory` where
available, and frame timing across a programmatic scroll of the hero. Emulate
a mid-tier Android (CPU throttle 4×, 1.5 DPR, 390×844) — the desktop numbers
on this page are meaningless, the buyers are on phones.

Cloudinary is **not reachable from this sandbox**. The frame sequence will not
load here. Say so plainly rather than reporting a hero that "performs well"
because it never ran; reason about the sequence from the code and the byte
math, and mark those findings as unmeasured.

## Deliver

1. **Measured baseline** — the numbers you actually collected, and the ones
   you could not.
2. **Findings, ranked by user-visible cost**, each with `index.html:LINE`, the
   mechanism (why it costs), and the cost (ms, MB, or frames).
3. **Fixes applied** — minimal diffs, behaviour identical, dialect matched.
4. **After numbers** for anything you changed. A fix without an after-number
   is a hypothesis.
5. **Left alone** — what you found, judged not worth the risk, and why.

No fix that trades a fallback for a millisecond. No rewrite of the loop into a
framework. If the honest answer is "this is already fast and the money is
elsewhere," say that and stop.
