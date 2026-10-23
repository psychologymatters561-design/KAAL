# Staging: the registry, in Razorpay test mode

Phase 1 of the ownership system (`docs/phase-0-audit.md`) runs on a second
worker, `kaal-edition-staging`, with its own database. No real money moves
there, it never writes the live site's sold list, it never tells Meta about
a sale, and every email it sends goes to you only, with
`[Staging, for <who it was meant for>]` in the subject.

The live worker is unchanged. The registry code is already in it, but every
line of it waits for a database that production does not have yet.

## What Phase 1 built

| Piece | Where | What it guarantees |
|---|---|---|
| The data model | `migrations/0001_registry.sql` | Every table in the brief, with `series` on every record that belongs to a watch. Plus sign-in by emailed code (no passwords stored). One public view, `public_registry`: number, colourway, state, Owner I since when, and a city only if that owner ticked the box |
| Series 01 | `migrations/0002_seed_series_01.sql` | Twenty pieces in the site's colourways. No. 09 is `withheld`: not sold, not offered, and the public view says "unavailable", never "sold" |
| The hold | `worker/registry.js`, `holdPiece` | Ten minutes, taken in one SQL statement. 25 buyers reaching for one number at the same instant: exactly one gets it (tested in Cloudflare's own runtime). The checkout window closes 30 seconds before the hold does |
| A payment | `recordPayment` | Keyed on the Razorpay payment id. The same webhook delivered five times at once places the watch once, writes one order, sends one pair of emails |
| A second payment for one watch | `duplicatePayment` in the worker | Refunded in full through Razorpay, asked for exactly once, then an apology to that buyer and a note to you. Never "No. 07 is yours", never a Purchase to Meta. If Razorpay refuses, the worker answers 502 so Razorpay retries, and you are told at once to refund by hand |
| Blocked buyers | `isBlocked` | Checked at checkout by email or phone, in any format, refused with a neutral message |
| Audit log | `audit_log` | Every placement, duplicate and refund the system makes on its own |

## Switch staging on (about ten minutes)

1. **Razorpay test keys.** Razorpay dashboard → toggle **Test Mode** →
   Account & Settings → **API Keys** → Generate. You get a Key Id
   (`rzp_test_…`) and a Key Secret.
2. **A webhook secret.** Make up a long random string (30+ characters).
   You will paste it in two places.
3. **GitHub secrets.** The KAAL repository → Settings → Secrets and
   variables → Actions → New repository secret, three times:
   - `RAZORPAY_TEST_KEY_ID`: the `rzp_test_…` id
   - `RAZORPAY_TEST_KEY_SECRET`: its secret
   - `RAZORPAY_TEST_WEBHOOK_SECRET`: the string from step 2
4. **Cloudflare token.** The `CLOUDFLARE_API_TOKEN` secret must also be
   allowed to edit D1. Cloudflare → My Profile → API Tokens → edit the
   token → add **Account · D1 · Edit** → save. (The value does not change.)
5. **Run it.** Actions → **setup-worker** → Run workflow → mode
   **staging**. It creates the database and store, applies `migrations/`,
   deploys `kaal-edition-staging`, sets the test keys (a live key is
   refused), and commits the new ids into `wrangler.toml`.
6. **Razorpay test webhook.** Still in Test Mode → Webhooks → Add New
   Webhook. URL `https://kaal-edition-staging.kaal-edition-hq.workers.dev/`,
   secret from step 2, events **payment.captured** and **refund.processed**.

## Try it

Open **https://kaal-edition-staging.kaal-edition-hq.workers.dev/staging**
on your phone. Tap a number, pay with card `4111 1111 1111 1111` (any
future date, any CVV) or UPI `success@razorpay`. The page reloads and the
number reads `sold`, with the order beneath it.

To see the duplicate handling, open the page on two phones, tap the same
number on both within a second, and pay on both. One will be refused before
paying ("held"). That refusal is the protection working.

To see a webhook delivered twice: Razorpay test dashboard → Webhooks → the
staging webhook → a delivered `payment.captured` → **Resend**. The order
list on `/staging` does not change.

## Phase 2: the control room

**https://kaal-edition-staging.kaal-edition-hq.workers.dev/control**, on
your phone. It lives on the worker rather than on thekaal.co so that its
sign-in cookie is first party and locked (HttpOnly, SameSite=Strict); a
page on thekaal.co cannot keep a cookie for a workers.dev address. (Moving
the domain's DNS to Cloudflare later would let it live at
`control.thekaal.co`.)

**Signing in.** Your email (`ADMIN_EMAIL`, else the first `OWNER_EMAIL`)
gets a six-digit code, valid once for ten minutes, and that code alone
signs you in (no app). A session lasts twelve hours. Setting
`ADMIN_2FA = "on"` in `wrangler.toml` adds an authenticator app on top: the
first sign-in then shows a link and a key to add KAAL, and every sign-in
after asks for the app's six digits as well; five wrong app codes end the
session.

| Screen | What it does |
|---|---|
| Overview | The twenty as a strip, sold of twenty, revenue, orders waiting at each stage, deliveries still inside their return window with days left, open approvals, failed emails, health, and any order breaking a promise (48 hours without inspection, not dispatched by day 4, dispatched 7 days without delivery) |
| Orders | Each order with its stage. **One tap** marks the next stage; a **ten second Undo** holds it back; then it saves and the buyer's email goes (the brief's words, exactly). Dispatched asks for courier, tracking number and link. Delivered asks for the date (today by default) and sets the return window to 23:59:59 India time seven days later. **Change without email** corrects a status with a reason. **Mark returned** works only inside the window and blocks that buyer from buying again. **Refund** refunds in full through Razorpay after you type the number |
| Pieces | The twenty: a photograph of each exact watch (JPEG, PNG or WebP, up to 3 MB), status override with a reason, colourway, private notes. Back to "available" also takes it off the live site's sold list |
| Owners | Search, the ownership chain, contact changes on the owner's request (a new email signs them out everywhere), sign out every device |
| Approvals | The queue. Decisions arrive with the claim, transfer, stolen and recovery flows (Phase 6) |
| Emails | Every template, previewed; a test sent to you; the outbox with each email's state and a Retry |
| Settings | Stage emails on or off, transfers need approval (on), sender name, warranty terms (held until rain is decided), return days and warranty months, blocked buyers |
| Audit | Every action with who, when, before and after; CSV of orders, owners and pieces; **Backup now** (everything except sign-in codes, sessions and the authenticator secret) |

Keyboard: 1 to 8 switch screens, u undoes, r refreshes, Esc closes.

The Delivered email carries the registration link, which arrives in
Phase 4; until then Delivered sets the dates and the email is shown in
Preview but not sent. The order confirmation at payment stays the current
"No. 07 is yours" until Phase 3 replaces it with the brief's "No. 07 is
spoken for".

## What staging does not have yet

The brief's other emails, `/track`, Shiprocket, the SLA emails to you
(Phase 3); registration and the owner dashboard (Phase 4); the public
registry page and the shop reading it (Phase 5); transfers, claims, stolen
and recovery (Phase 6). Production gets its own database at go-live (Phase 7), when Nos. 01,
02, 07 and 10 are entered with their real orders and delivery dates.
