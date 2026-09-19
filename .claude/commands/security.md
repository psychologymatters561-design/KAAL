---
description: Security review of the money path — Razorpay checkout, the sold-sync worker, client-trusted state.
argument-hint: [optional scope, e.g. "worker", "checkout"]
allowed-tools: Bash, Read, Grep, Glob
---

Read `.claude/house-rules.md` first.

Scope: **$ARGUMENTS** (empty = everything with money or secrets near it).

This is a static site. The attack surface is small, which is exactly why the
review must be precise instead of generic. Do not produce an OWASP Top 10
recital. Audit the four things that exist:

## 1. The Cloudflare Worker — `worker/index.js` and `worker/lib/`

It takes a webhook from the internet and **commits to a GitHub repo**. That is
the highest-privilege thing in this project. Check, line by line:
- Signature verification: is the Razorpay signature checked *before* any
  parsing or side effect, against the raw body, with a constant-time compare?
- Replay: can the same captured webhook be posted twice? Ten thousand times?
- Input trust: the buyer controls `notes`. What happens with a number that is
  `"7"`, `7`, `0`, `-1`, `21`, `"7; DROP"`, `1e400`, an array, or absent?
- The GitHub write: can crafted input make it commit something other than a
  `sold` array — path, branch, or file content injection into `index.html`?
  Content that lands in `index.html` is content that runs in a buyer's browser.
- Secret handling: token scope (is it repo-wide when it needs one file?),
  anything leaked into a response body, an error message, or a log.
- Failure modes: GitHub 409/rate-limit, concurrent webhooks racing the same
  file, a partial write. What does the page serve if it commits garbage?

## 2. The checkout hand-off in `index.html`

- `KAAL.checkout` is a URL built into a page anyone can edit in devtools. What
  *actually* stops a buyer from altering the price, the number, or the notes
  before Razorpay sees them? Trace what is server-verified and what is only
  client-decorated, and state it plainly.
- Is anything sensitive placed in a query string (referrer-leaked, logged)?
- Does the claim flow expose buyer PII anywhere client-side?

## 3. Client-trusted state

`sold`, `edition`, `dials`, `price` all live in the page. Say out loud what an
attacker gains by changing each (usually: nothing, sometimes: a confused
support conversation, occasionally: a real double-sale). Rank by what actually
costs money — do not inflate devtools-editing into a vulnerability when the
server is the one deciding.

## 4. Delivery and headers

GitHub Pages + `CNAME` (`thekaal.co`). Check: HTTPS enforcement, the
cross-origin surface (Cloudinary is the only one — what does a compromised or
hijacked Cloudinary account get to run?), `rel="noopener"` on outbound links,
whether a CSP is feasible given the inline CSS/JS (be honest: inline-everything
makes a strict CSP expensive — say what it would cost, do not hand-wave a
`unsafe-inline` policy and call it hardened).

## Deliver

Per finding: severity (with the reasoning, not a vibe), the concrete attack
walked through step by step, the exact fix, and the residual risk after it.
Then: what you checked and found clean — that list is as useful as the faults.

Report only; do not push changes to the worker without asking. And do not
report theoretical vulnerabilities in code paths that do not exist here.
