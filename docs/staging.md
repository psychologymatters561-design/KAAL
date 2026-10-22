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

## What staging does not have yet

The control room, the stage emails, `/track`, registration, the owner
dashboard, the public registry page, transfers and claims are Phases 2
to 6. Production gets its own database at go-live (Phase 7), when Nos. 01,
02, 07 and 10 are entered with their real orders and delivery dates.
