---
description: Build or harden UI on KAAL — every state, every input method, no framework.
argument-hint: <what to build or harden, e.g. "the sold-out state", "keyboard path to claim">
allowed-tools: Bash, Read, Grep, Glob, Edit
---

Read `.claude/house-rules.md` first.

Task: **$ARGUMENTS**

Vanilla JS, inline CSS, no build, no components in the framework sense. The
reusability that matters here is CSS custom properties, one class-driven state
machine, and functions that already exist — not a component library.

## Every state, named

Nothing ships until each of these is a designed state, not an accident:
- **Loading** — including the honest ring that only appears past 400ms.
- **Empty / absent** — no photograph, no film, empty `checkout`, no JS at all.
- **Failed** — a frame 404s, Cloudinary is down, the font never arrives.
- **Sold** — a single number gone, and the whole edition gone.
- **Refused** — `prefers-reduced-motion`, `saveData`, 2G, `innerWidth < 340`.
  These users are not second-class; they get a complete hero, not a hole.

## Inputs and bodies

- Keyboard: the entire claim path reachable and visible. `:focus-visible` must
  survive your CSS.
- Screen reader: number selection announces what changed. `aria-hidden` on the
  decorative canvases stays.
- Touch: target sizes, no hover-only affordance, no 300ms surprises.
- Motion: `prefers-reduced-motion` honoured for anything you add, the same way
  `filmAllowed()` already honours it.
- Contrast: this palette is near-black on near-black by design. Check the real
  ratio for anything you add against the *actual* background behind it, which
  changes as `.world` transitions.

## Rules of construction

- Extend the existing patterns. New CSS uses the existing custom properties
  and easings. New JS goes in the existing IIFE, in the existing dialect.
- Drive visual state with a class on an element and CSS transitions, the way
  the rest of the page does. Do not animate from JS per frame unless it must
  be scroll-linked — and if it must, hook the existing `tick()` loop rather
  than starting a second rAF.
- Responsive: this is `svh`-based and sticky-heavy. Test at 390×844 with the
  URL bar showing and hidden; iOS resize storms are the local weather.

## Deliver

The working code, the state matrix you actually tested (state × viewport ×
input), what you could not test here and why, and any existing state your
change touched. Screenshot the states if you drove a browser.
