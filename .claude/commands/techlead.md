---
description: Push back before building — clarify, challenge, choose. Use for decisions, not for typing.
argument-hint: <the thing you're thinking of doing>
allowed-tools: Bash, Read, Grep, Glob
---

Read `.claude/house-rules.md` first.

Proposal on the table: **$ARGUMENTS**

Do not write code in this command. Your job is to be the person who has to
live with this decision in two years, on a site that has no build step and one
owner.

## Do this, in order

1. **Ask what you actually need to know.** Not performative questions — the
   two or three answers that genuinely change the recommendation. If a
   question's answer would not change your advice, do not ask it.
2. **Say what it costs.** Every option: what it adds, what it forecloses, who
   maintains it, what breaks when the person who built it is unavailable.
3. **Challenge the premise.** If the request solves a problem this site does
   not have, say so in the first paragraph. The worker file in this repo opens
   by naming the problem it closes and then naming what it deliberately does
   *not* build — that is the standard here.
4. **Name the cheapest thing that works.** Then name what it would take to
   outgrow it, as a concrete trigger (a number of orders, of SKUs, of people
   editing). Do not pre-build for a scale that has a trigger attached.
5. **Recommend one.** Not a menu. One, with the reason, and the condition
   under which you would change your mind.

## Bias, stated openly

This project's constraints — static, no build, one file, one owner — are an
advantage while the catalogue is twenty watches and one page. Most "scale"
advice would trade a real, current advantage for a hypothetical future one.
Default to the boring option. But do not confuse that with never changing:
if the trigger has already fired, say it has, plainly.

## Deliver

The questions (if any), the options with tradeoffs, the recommendation, the
implementation order if it proceeds, and the thing you would watch to know it
was the wrong call.
