---
description: Senior-engineer audit of the codebase — architecture, duplication, scalability, maintainability. Reports; changes nothing unless told.
argument-hint: [optional scope, e.g. "index.html", "worker", "the claim flow"]
allowed-tools: Bash, Read, Grep, Glob
---

Read `.claude/house-rules.md` first.

Scope: **$ARGUMENTS** (empty = everything shipped: `index.html`,
`claimed.html`, `legal.html`, `worker/`).

You have just joined this project. You do not know why anything is the way it
is. Reverse-engineer it before you judge it.

## Pass 1 — understand, in writing

Trace the real flow before opening your mouth about quality:
- What renders on first paint, and in what order.
- Every piece of state: the `KAAL` config object, `S` (scroll), `SEQ`
  (frames), `FACE`, DOM classes used as state, URL query params.
- The claim path end to end: number selection → Razorpay checkout →
  webhook → worker → `sold` array → page rebuild → `claimed.html`.
- Every fallback chain and what triggers each step.

If you cannot draw this from the code, you are not ready to critique it.

## Pass 2 — find what is actually wrong

- Duplicated logic (genuinely duplicated — not "similar-looking").
- State that can disagree with itself: two sources of truth for sold numbers,
  price, edition size, dial names.
- Coupling that will bite on the next change: what breaks if the price
  changes, if the edition goes to 50, if a ninth photograph arrives, if
  Cloudinary dies permanently.
- Dead code, dead assets, dead CSS.
- Things that only work by accident — implicit globals, load-order luck,
  silent `try/catch`, a `classList` string typo'd in one of two places.
- Failure modes with no designed state.

## The bar for calling something a problem

State the concrete future change or input it breaks under. "Hard to maintain"
is not a finding. "Adding a ninth photograph requires edits in four places,
`index.html:558`, `:572`, `:594`, `:608`" is a finding.

Reflexes that are **banned** here: "split this into modules," "add a build
step," "use a framework," "extract a config file," "add TypeScript." Any of
those must be earned against rule 1 and 2 of the house rules, in the specific
terms of this repo, or not raised at all.

## Deliver

1. **Architecture as it actually is** — components, data flow, state.
2. **What holds up** — say it. An audit that finds only faults is a bad audit,
   and this codebase has real craft in it.
3. **Problems, ranked by expected cost**, each with file:line and a trigger.
4. **Refactor proposals** — smallest intervention that removes the trigger,
   with the risk of doing it and the cost of not.
5. **Verdict on the single-file decision.** Does it still hold at this size?
   Answer directly, with a number, either way.

Report only. Do not edit unless the invocation asked for fixes.
