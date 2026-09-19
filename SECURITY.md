# KAAL — security review

A senior-engineer audit of everything between a stranger on the internet and
₹5,999 of somebody's money. Reviewed: `index.html`, `claimed.html`,
`legal.html`, `manifesto.html`, `worker/kaal-sold-sync.js`, `wrangler.toml`,
`tools/check.mjs`, `.github/workflows/check.yml`, and the full git history.

**The one-line finding.** No credential was ever leaked and the webhook's
signature check was correct from the start. Everything downstream of that
check assumed that a correctly signed webhook was a webhook that told the
truth, and that assumption was worth the entire edition for about twenty
rupees.

Two lists follow. The first is closed in this commit. The second cannot be
closed from a text editor — it is dashboard work, and it is the half that
actually protects the money.

---

## How to read the severities

Not CVSS. CVSS scores a library; this is one shop. The question asked of each
finding was: **what does it cost, who can do it, and what do they need?**

| | Meaning |
|---|---|
| **Critical** | An unauthenticated stranger takes the money, the inventory, or the domain. |
| **High** | Real money or real customer trust is lost, but the attacker needs a foothold, a mistake, or luck. |
| **Medium** | The shop degrades, the owner is blind to it, or a buyer can be convincingly lied to. |
| **Low** | Defence in depth. Nothing is lost today; something is lost the day something else goes wrong. |

---

## Part one — closed in this commit

### K-01 · Critical · The entire edition, for twenty rupees

**Where** `worker/kaal-sold-sync.js`, the `payment.captured` handler.

**What was true.** The worker read `notes.kaal_no` out of the webhook and
marked that number sold. It never looked at what was paid.

Two facts make that fatal, and each is harmless alone:

1. A Razorpay webhook fires for **every** payment on the account, not only for
   the one Payment Page this shop sells from. A ₹1 test link, a repair
   invoice, a friend's payment — the same endpoint, the same secret, the same
   valid signature.
2. `kaal_no` is a **buyer-filled field**. The page prefills it from the URL;
   the buyer can type whatever they like.

**The attack, concretely.** Find any payment route on the account. Pay ₹1.
Put `7` in the notes. Number 07 is struck through on the live storefront
within seconds, and a commit lands in the repo saying so. Do it twenty times.
Total spend: ₹20. Result: a storefront reading SOLD OUT, twenty unsold
watches, every ad rupee burning against a shop that says there is nothing to
buy — and a `sold` array in git that looks like a legitimate sales record.
The owner's own automation did it, so nothing looks compromised.

**The fix.** `verifyPayment()` now checks currency and amount before anything
is committed. The expected amount is not typed into the worker — it is read
out of the `price:` line in `index.html`, in paise, the same way the edition
bound already was, so a price change cannot leave a stale copy behind. A
mismatch commits nothing, writes an alert, and logs at error level.
`MIN_AMOUNT_PAISE` turns the exact match into a floor for the day a coupon is
real. `AMOUNT_CHECK=off` restores the old behaviour and `tools/check.mjs`
fails the build if it is ever committed that way.

**Verified.** A ₹1 payment naming No.07 → `200`, nothing committed, alert
raised. A ₹5,999 payment naming No.07 → committed. Same amount in USD →
refused.

---

### K-02 · High · Two people paid for one watch, and it was a silent 200

**Where** `worker/kaal-sold-sync.js`, `commitSold()` returning `"already"`.

**What was true.** A captured payment naming a number that was already sold
returned `Number 7 already recorded as sold.` and stopped. That is exactly the
shape of a real double-sale, and the only trace of it was an HTTP status
nobody reads.

**Why it matters more than it looks.** `legal.html` promises "where two orders
reach us for the same number, the earlier captured payment stands and the
later one is refunded in full." That promise is only keepable if somebody
*knows*. The worker was the only witness and it said nothing.

**The fix.** It now writes an `alert:` record, logs `ALERT double-sale` at
error level, and still returns 200 so Razorpay stops retrying. A new
`GET /alerts?token=…` route lists them, closed unless `ALERT_TOKEN` is set.

---

### K-03 · High · Every Claim button, repointed

**Where** `index.html`, `paintCta()`.

**What was true.** Every Claim button was `<a href>` built from
`KAAL.checkout`, with no constraint on what that string was. Change one line
of `index.html` and every buyer on the site walks to a host of your choosing,
wearing this brand's design, with their card out.

**That is not hypothetical here.** The worker holds a GitHub token that writes
`index.html` on `main`, and the push is the deploy. "A commit nobody meant to
make" is a category this architecture already contains.

**The fix.** `checkoutOk` refuses to build a link that is not `https` on a
host named in the new `KAAL.checkoutHosts` (`razorpay.com`, `rzp.io`).
Misconfigured, the button falls back to the inert state it already has when
there is no link at all — a shop that cannot take money is recoverable in a
minute; a shop that takes money to the wrong place is not. `tools/check.mjs`
refuses to let a mismatch reach a deploy at all, so there are two independent
gates and the CI one runs before the traffic does.

---

### K-04 · Medium-High · The site sent no security headers, because it cannot

**Where** every page.

**What was true.** GitHub Pages does not let you set response headers. So
there was no Content-Security-Policy, no `X-Content-Type-Options`, no
referrer policy, nothing. Any injected `<script src>`, any `<base>` tag, any
`<form>` posting a buyer's details elsewhere — all permitted.

**The fix.** A `<meta http-equiv="Content-Security-Policy">` on all four
pages: `default-src 'none'` with an explicit allowance for each thing the
site genuinely uses, plus `base-uri 'none'`, `object-src 'none'`,
`form-action 'none'`, `frame-src 'none'` and `upgrade-insecure-requests`.
Plus `<meta name="referrer" content="strict-origin-when-cross-origin">`.

**What a meta CSP does not do.** `frame-ancestors` is ignored from a meta tag
— see K-11 — and a header set by a CDN is strictly better. That is item A6 in
part two.

**Verified in Chromium.** All four pages render with zero CSP violations, the
grid builds, choosing a number works, the claim line updates.

---

### K-05 · Medium · A signed webhook replays forever

**Where** the webhook handler.

A Razorpay signature proves the secret, not freshness. The same body and
signature stay valid indefinitely, so anyone who ever holds one — a log
export, a screenshot of a webhook debug pane, a forwarded curl — can resend
it. The GitHub side happened to be idempotent; the KV write and the alerting
were not.

**The fix.** `x-razorpay-event-id` is remembered in KV for 24 hours. A repeat
returns `Already processed.` and does nothing.

---

### K-06 · Medium · Refunds and disputes were invisible, and burned a number permanently

**Where** the event filter — everything but `payment.captured` was ignored.

**The attack.** Buy number 07. It is marked sold and committed. Raise a
chargeback, or ask for a refund under the returns policy. The money comes
back. **Number 07 stays sold forever**, because nothing ever un-sells it and
nobody was told. Repeat across the edition and the shop closes itself at the
cost of some card fees and some patience.

**The fix, and why it is deliberately not automatic.** `refund.*` and
`payment.dispute.*` now raise an alert and log loudly — and **never**
auto-unsell. A machine that can mark a number available again is a machine
that can be made to resell a watch that has already shipped. A refund on a
piece that has gone out and a refund on a piece that has not are different
decisions, and both have a person's judgement in them.

**Action required:** subscribe those events in the Razorpay dashboard (A7).

---

### K-07 · Medium · `/hold` could be used to spend the KV write budget

**Where** `postHold()`.

`/hold` is public and unauthenticated by design. Every call wrote to KV,
including re-holding the same number with the same token — so fifty clicks of
the same button were fifty writes. Workers KV's free tier is 1,000 writes a
day. Exhaust it and `/state` stops being able to tell the page anything.

**The fix.** A hold with most of its life left is now a no-op (measured:
**fifty repeat holds → one write**, down from fifty), plus a per-IP cap and a
cap on live holds. When a cap is hit the response is shaped like success,
because a rate limiter must never stand between a buyer and a checkout page —
the hold is advisory and the page proceeds regardless.

**This is a speed bump, not a wall.** The real control for a public endpoint
is a rate-limiting rule in front of it: A6.

---

### K-08 · Medium · Free HMAC-SHA256 over as many megabytes as you like

**Where** `await request.text()` before any signature check.

The body had to be read in full before it could be verified, so an
unauthenticated caller chose how much work the worker did. The fix caps it at
64 KB — checked against `Content-Length` first because that is free, then
against the actual bytes. Verified: a 2 MB body returns `413` without
computing anything.

---

### K-09 · Medium · A phishing page on the real domain, with the real certificate

**Where** `claimed.html`.

It read `razorpay_payment_id` from the query string and printed it as
"Payment reference", unvalidated. `textContent` made it XSS-proof — that was
never the risk. The risk is `thekaal.co/claimed.html?razorpay_payment_id=…`
being a genuine page on the genuine domain, showing whatever a stranger's
link says, under a padlock. "KAAL confirms your payment — reference: call
+91-XXXXX to claim" is a scam with our certificate on it.

**The fix.** The reference is shown only if it matches `pay_[A-Za-z0-9]{8,32}`,
Razorpay's actual format. The stored number is checked for two digits inside
the edition. Anything else and the row stays hidden, exactly as it does for a
visitor arriving directly. Verified in Chromium both ways.

---

### K-10 · Medium · The privacy policy said something that was not true

**Where** `legal.html`, the Privacy section.

> "The site stores the number you pick in your own browser… **It never leaves
> your device** and is cleared once shown."

The site also stores `kaal_client`, a persistent random identifier, and
`holdNumber()` **POSTs it to the worker** with every checkout click. A
published privacy statement that is factually wrong is a liability under the
Digital Personal Data Protection Act, 2023, independent of whether anything
bad happens with the data.

**The fix.** The bullet now describes the identifier honestly, says where it
goes, and states plainly that there are no cookies and no analytics,
advertising or tracking script on the site — which is true and is worth
saying. A second bullet covers server logs. **Read both before shipping and
make sure they still describe what you actually do.**

---

### K-11 · Low-Medium · Nothing stopped the site being framed

`frame-ancestors` cannot be set from a meta tag and Pages sends no header, so
the page has to refuse on its own. Framed, this site is a beautiful backdrop
for somebody else's "Claim" button. A head-time guard now replaces the page
with a plain link to `thekaal.co` if `window.self !== window.top`, on all four
pages. `tools/check.mjs` fails the build if any page loses it. Verified inside
a real iframe.

---

### K-12 · Low · Any website could call the worker from a visitor's browser

`/state` and `/hold` had CORS response headers but never checked the request's
`Origin`. They now reject an `Origin` this shop does not own, while still
allowing a request with no `Origin` at all — curl, health checks and Razorpay
itself, none of which a CORS policy is for. A non-browser client still
bypasses this entirely; that is what the WAF rule in A6 is for.

---

### K-13 · Low · Routing was loose

`if (request.method === "POST") return webhook(...)` sent **every** POST, on
every path, into the webhook handler, and unknown routes answered `200`.
Routes are now named, and anything else gets a `405` with an `Allow` header —
so a typo'd webhook URL in the Razorpay dashboard fails visibly instead of
looking like a wrong secret. All responses carry `nosniff`, `no-referrer`,
`Cross-Origin-Resource-Policy` and a `default-src 'none'` CSP.

---

### K-14 · Low · One bad GitHub response would have committed a blank storefront

The contents API returns an **empty** `content` with no error for files over
1 MB. `atob("")` is `""`, the regex would not match, and the failure mode was
a blank page rather than an error. `index.html` is 118 KB today, so this was
never live — it was waiting for the day the page grew. The encoding and the
content are now checked before anything is decoded.

---

### K-15 · Low · `$` in a replacement string

`String.replace(pattern, str)` interprets `$&`, `$1`, `` $` `` in the
replacement. Today the replacement is built from integers so nothing can carry
a `$`. It is now a function, which never interprets anything, because "today
it is integers" is a property of the code above it and not of this line.

---

### K-16 · Low · CI kept a credential it did not need

`actions/checkout` writes the job's `GITHUB_TOKEN` into `.git/config` by
default, where any later step — or anything a step pulls in — can read it.
This job only reads files. `persist-credentials: false` is now set. A new step
fails the build if a secret is ever assigned in `worker/` or `wrangler.toml`.
Both actions are still on mutable `v4` tags; pinning to SHAs is noted inline
with the exact commands, and needs `gh` to do properly.

---

### K-17 · Low · No way to see any of the above

Every alerting path above writes to a KV `alert:` key with a 30-day TTL,
readable at `GET /alerts?token=…`. Without `ALERT_TOKEN` set, the route
returns 404 — closed rather than open.

---

### What was already right, and is worth knowing why

- **HMAC signature verification with a constant-time compare.** `a === b` on
  strings returns as soon as two characters differ, which leaks how much of a
  guess was correct. The existing `timingSafeEqual` reads both strings to the
  end. This is the textbook mistake and it was not made.
- **The state merge is one-directional.** The page only ever *adds* to its
  sold set from `/state`, never removes. A backend that can only be more
  cautious than the static page is a backend that cannot take the shop down
  when it is having a bad day. Keep it that way.
- **No card data ever touches this site.** Razorpay's hosted page handles it.
  That single decision removes PCI-DSS scope and the entire category of
  payment-form skimming.
- **No third-party JavaScript.** No analytics, no tag manager, no chat widget.
  Every supply-chain attack on a storefront in the last five years came in
  through one of those. Adding one is the most expensive security decision
  available to this site; if a marketing tag is ever needed, that is the
  conversation to have first.
- **No secrets in the git history.** Checked across every commit.

---

## Part two — what cannot be fixed from a text editor

Ordered by what it costs if skipped. **A1 to A3 matter more than everything
in part one combined.**

### A1 · Critical · Razorpay Payment Page configuration
- Amount **fixed** at the list price. A "customer decides the amount" page
  hands the inventory switch to the buyer; K-01's fix assumes a fixed amount.
- Stock limit **20**. This is the only thing that stops the 21st sale.
- The custom field is named exactly `kaal_no` and is **required**.
- Send **one ₹1 test payment and confirm it is REJECTED** with an amount
  mismatch. That is the check doing its job. Then one at full price, and watch
  the commit land. Both before any ad spends a rupee.

### A2 · Critical · The GitHub token
An internet-facing endpoint holds a credential that writes your repository.
That is an accepted trade, and it is only acceptable while the credential is
tight:
- **Fine-grained** PAT, this repository only, **Contents: Read and write**,
  nothing else.
- **Never Workflows write.** That is the difference between "can edit one line
  of one file" and "can run any code as you."
- Set an **expiry** and calendar the renewal.
- If this token has ever been pasted into a chat, an email, a screenshot or a
  second machine: **rotate it now.** Rotation is thirty seconds; the
  alternative is somebody else's `checkout:` URL on your live site (K-03).

### A3 · Critical · Accounts, in this order
GitHub, Razorpay, Cloudflare, **and the domain registrar**. 2FA everywhere,
hardware key or passkey where offered, recovery codes printed and off-machine.

**The registrar is the crown jewel and it is the one people forget.** Whoever
controls DNS for `thekaal.co` does not need to touch this repository, this
worker, or Razorpay: they point the domain at a pixel-perfect clone, get a
certificate in about a minute because domain control *is* the proof, and take
payments as you until somebody notices. Every control in this document is
downstream of that one account.

### A4 · High · Branch protection on `main`, with one eye open
Enable **Require status checks to pass** (`check`) and **Block force pushes**.

**Do not enable "Require a pull request before merging"** without changing the
architecture first: the worker commits straight to `main`, and that rule
breaks every sale. This is the real cost of the current design, stated plainly
rather than hidden. If you want full PR protection, the worker must stop
writing the repo and `sold` must live in KV only, with the page reading
`/state` as authority — a contained change, worth doing before Series 02.

### A5 · High · GitHub Pages settings
**Enforce HTTPS** on. Verify the custom domain in settings so the `CNAME`
cannot be claimed by someone else if it ever dangles.

**And assume every file in this repository is publicly readable at
`thekaal.co/…`** — `.nojekyll` means Pages serves the tree as it is. Nothing
sensitive is in here today. Keep it that way: this repo is a publishing
surface, not a working directory.

### A6 · High · Put the site behind Cloudflare
You already have the account for the worker. Proxying `thekaal.co` through it
turns three of the compromises above into real controls:
- **Real response headers**, which upgrades K-04's meta CSP to a header and
  finally gives you `frame-ancestors 'none'` (K-11), HSTS with preload,
  `X-Content-Type-Options`, and `Permissions-Policy`.
- **A rate-limiting rule** on the worker's route — ~30 requests a minute per
  IP. This is the actual answer to K-07 and K-12.
- **Bot Fight Mode** for the zone.

Also move the worker onto a route you own (`api.thekaal.co/*`) and set
`workers_dev = false`. A `*.workers.dev` URL is a second front door that no
rule of yours ever sees. The commands and settings are in `wrangler.toml`.

### A7 · High · Webhook events and the alert token
Subscribe `refund.processed` and `payment.dispute.created` alongside
`payment.captured` (K-06). Set `ALERT_TOKEN` (`openssl rand -hex 32`) and
bookmark `https://<worker>/alerts?token=…`. **Check it daily while the
edition is live.** An alert nobody reads is a log line.

### A8 · Medium · Email authentication for `thekaal.co`
Publish **SPF, DKIM and DMARC** (`p=reject` once you have watched the reports
for a fortnight). Without them, anyone can send "Your KAAL order needs
payment confirmation" *from* `connect@thekaal.co`, and it will pass most
inbox checks. You are asking people for ₹5,999 and a postal address; this is
the cheapest brand protection on the list. Add a **CAA record** while you are
in the DNS panel, so only your chosen CA can issue for the domain.

### A9 · Medium · GitHub repository settings
Turn on **secret scanning** and **push protection**. Free on public repos, and
it is the control that catches the mistake nobody plans to make.

### A10 · Medium · Operational discipline
- The Razorpay webhook secret is a password: anyone holding it can mark this
  edition sold out. Never in chat, email, or a screenshot.
- `wrangler tail` during the first real sales, and read the output.
- A written line for what happens when `/alerts` shows a `double-sale` — who
  refunds, who writes, within how long. `legal.html` already makes the
  promise; decide now who keeps it.

---

---

## Part three — what now watches these, so none of it quietly stops being true

Every control above can be undone, and most of them can be undone without
producing a commit, a diff, or anything anyone would notice. So four things
now watch, on different clocks:

| What | Watched by | When |
|---|---|---|
| The repository's own rules — CSP, frame guard, checkout allowlist, secrets, `security.txt` | `tools/check.mjs` | every push and PR |
| **The blast radius of a stolen worker token** | `tools/check-autocommit.mjs` | every push to `main` |
| The live site and the deployed worker, from outside | `tools/verify-live.mjs`, run by `.github/workflows/watch.yml` | every morning |
| Money moving in ways it should not | the worker's `/alerts` | every day, by a person |

**The second row is the one worth understanding.** The worker holds a GitHub
token that can write this repository, and GitHub's permission model has no way
to narrow that to "one line of one file". So it is narrowed by watching the
*shape* of the commit instead: any commit whose message says the worker made
it must touch exactly `index.html`, exactly one line, that line must be the
`sold:` array, and exactly one number must have appeared in it.

A stolen token therefore buys a choice of two moves: mark a number sold —
annoying, reversible — or anything else, which is red in the Actions tab
within a minute. It cannot repoint `checkout:`, inject a script, or change the
price without saying so out loud. Tested against six attacks, including a
second file smuggled into the same commit, a `checkout:` repointed alongside a
real sale, a `<script src>` injected on another line, and a commit that
*un-sells* a number — which the worker is not capable of, so it is not
something that should ever arrive wearing its name.

`tools/verify-live.mjs` checks, from outside, the things a dashboard can
silently undo: HTTPS enforcement, HSTS, the header CSP and whether it still
agrees with the meta one, `frame-ancestors`, the live page's checkout host,
CAA, SPF, DMARC, and nine properties of the worker — `/alerts` closed,
unknown routes refused, foreign origins rejected, forged signatures rejected,
oversized bodies refused, and the `workers.dev` back door shut. Run it
yourself any time:

```
node tools/verify-live.mjs --worker https://api.thekaal.co
```

**`docs/LAUNCH-RUNBOOK.md` turns all of part two into clicks** — every setting,
in dependency order, with the command that proves each one took, plus what to
do at 2am when a token is compromised or `/alerts` shows a double sale.

---

## If you do five things

1. **A1** — fix the amount and the stock limit on the Payment Page, and run
   the ₹1 rejection test.
2. **A2** — scope and rotate the GitHub token.
3. **A3** — 2FA on all four accounts, registrar first.
4. **A6** — Cloudflare in front of the site, with the rate-limit rule.
5. **A7** — subscribe the refund events and set `ALERT_TOKEN`.

Part one is already done and CI now refuses to let any of it be quietly
undone. Part two is the half that decides whether the money is safe, and
`docs/LAUNCH-RUNBOOK.md` is that half as a checklist with verification
commands. Part three is what notices when any of it stops being true.

---

## Reporting something

Found a problem with this site or this worker? Write to
`connect@thekaal.co`. No bounty, but you will get a reply from a person.
