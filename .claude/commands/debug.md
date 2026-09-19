---
description: Root-cause a bug like a live production incident — trace it, prove it, then fix it.
argument-hint: <the symptom — what you saw, on what device/browser>
allowed-tools: Bash, Read, Grep, Glob, Edit
---

Read `.claude/house-rules.md` first.

Symptom: **$ARGUMENTS**

If that symptom is vague ("it's broken", "looks wrong"), ask exactly what was
seen, on what device, browser, and viewport, and whether it reproduces — and
ask *before* touching code. A guess dressed as a diagnosis wastes a real
person's afternoon.

## Method

1. **Reproduce first.** Serve locally (`python3 -m http.server 8000`), drive it
   with the pre-installed Chromium/Playwright, at the reported viewport. If you
   cannot reproduce, say so and stop guessing — narrow it by asking, or by
   reading the exact code path and stating the precondition you cannot create
   here. Cloudinary is unreachable from this sandbox; a bug in the frame
   sequence cannot be reproduced here and you must say that instead of
   pretending.
2. **Read the actual path.** Follow it in `index.html` line by line. Name every
   line that touches the symptom.
3. **Prove the cause.** Change one thing, show the symptom moves with it. A
   cause you cannot toggle is a theory.
4. **Then look wider.** This page fails in ways that are easy to miss:
   reduced-motion on, `saveData` on, 2G, `innerWidth < 340`, JS disabled, the
   `?film=0`/`?film=1` overrides, iOS URL-bar resize storms, back/forward
   cache restore, a sold-out edition, an empty `checkout` string, a frame that
   404s, a font that never arrives.
5. **Fix minimally.** The narrowest change that removes the cause. Not the
   refactor you noticed on the way past — note that separately.
6. **Verify.** Re-run the reproduction. Then check the neighbouring states you
   just listed, because this page's states share code.

## Deliver

- What the code in that path actually does (so the owner can follow you).
- Root cause, at `index.html:LINE`, with the proof.
- Why it failed *there* and not elsewhere.
- Edge cases in the same code path, each marked fixed / still open / accepted.
- The diff, and the verification you ran.

Never "fix" by deleting a fallback, widening a `try/catch`, or removing the
feature. If the real fix is out of scope, say what it is and what you did
instead.
