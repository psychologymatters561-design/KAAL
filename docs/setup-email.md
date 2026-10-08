# Emails from the website: switching them on

Everything the website emails goes to **connect@thekaal.co**. No personal
inbox is involved anywhere.

## What the website sends, once this is on

| When | To | What |
|---|---|---|
| A payment lands | the buyer | "No. 07 is yours": their engraved caseback, the order, payment reference, arrival date, what happens next, a button to add the address |
| A payment lands | connect@thekaal.co | "New order · No. 07 Midnight · ₹5,999": buyer's email and phone, WhatsApp button, gift card, dispatch-by date. Reply writes to the buyer. (`ORDER_ALERT = "off"` in `wrangler.toml` turns this one off.) |
| The buyer gives an address | both | the address, to copy (you) and to check (them) |
| Razorpay processes a refund | the buyer | "Your refund for No. 07 has been processed": amount, both references, when banks show it (`REFUND_EMAIL = "off"` in `wrangler.toml` leaves them with Razorpay's own notice) |
| Razorpay processes a refund | connect@thekaal.co | "Refund processed · No. 07 · ₹5,999", and, for a full refund, the question the desk asks: back on sale, or keep it retired? |
| You tap **Mark dispatched** on the desk | the buyer | "No. 07 is on its way": courier, tracking number, where it is going (the confirmation promised this "the day it leaves") |
| Just after midnight, every day | connect@thekaal.co | **The daily report**: visitors, page visits, how many scrolled through the film, reached the twenty, chose a dial, chose a number (add to cart), opened checkout, paid; each order with contact; unfinished checkouts with why and how to reach them; new Series 02 leads; numbers left; the last seven days |

Beside the emails there is **the desk**, your private page at
`kaal-edition.kaal-edition-hq.workers.dev/desk`: orders and addresses, the
dispatch button, who nearly bought, the Series 02 list, the twenty, the day's
numbers, and anything that needs you. Passcode only, never linked from the
site. docs/desk.md explains it.

The report's counts come from the site's own counter: daily totals only, no
cookie, no identifier (`legal.html` says so in the privacy section).
`DIGEST_HOUR_IST` in `wrangler.toml` moves the report (`"9"` would be the
next morning); `DIGEST = "off"` stops it.

**Who does what.** Cloudflare runs the worker, the counter and the schedule
(free plan). Resend only delivers the emails (free plan: 3,000 a month;
this shop needs a few dozen). Cloudflare's own email sending needs the
domain's DNS moved to Cloudflare and its paid plan, so it is not used.

---

## Step 1. Resend ✓ (done)

Your Resend account exists, and thekaal.co shows **Verified** under
Domains. Resend's records today are a TXT `resend._domainkey` and two CNAMEs,
`send` and `rsend`. If one ever shows Pending, check its Name in GoDaddy
(`rsend`, not `resend` or `rsend.thekaal.co`) and that `apne1` ends in the
digit one.

The API key must have **Full access** (Resend → API Keys → Permission).

## Step 2. A Cloudflare token (deploys the worker)

1. **dash.cloudflare.com/profile/api-tokens**, signed in to the account
   where Workers & Pages lists `kaal-edition`.
2. **Create Token** → **Edit Cloudflare Workers** → **Use template**.
3. Account Resources: your account. Zone Resources: **All zones**.
4. **Continue to summary** → **Create Token** → copy it (shown once).

## Step 3. Let the Claude session use them

**Never paste a key into the chat.** In the Claude app, the cloud environment
menu in the session's title bar → **Edit**:

1. **Network access** → **Custom**. Keep the default package managers and add:
   ```
   api.cloudflare.com
   api.resend.com
   kaal-edition.kaal-edition-hq.workers.dev
   ```
2. **Environment variables**, one per line:
   ```
   CLOUDFLARE_API_TOKEN=…the token from step 2…
   RESEND_API_KEY=…the re_ key from Resend…
   DESK_PASSCODE=…a passcode you choose for the desk (optional)…
   ```
   Leave `DESK_PASSCODE` out and one is made for you and emailed to
   connect@thekaal.co instead (docs/desk.md).
3. Save. New sessions pick it up.

https://code.claude.com/docs/en/cloud-environments#network-access

## From a phone: GitHub runs it for you

No computer is needed. Instead of steps 3 and 4, GitHub's own machine runs
the setup (the `setup-worker` workflow).

1. In your phone's browser (not the GitHub app), signed in to GitHub, open
   each link below. Each one opens GitHub's **New secret** form for this
   repository. Type the **Name** exactly as shown, paste the value into
   **Secret**, and tap **Add secret**:
   - https://github.com/psychologymatters561-design/KAAL/settings/secrets/actions/new
     → Name `CLOUDFLARE_API_TOKEN`, Secret: the token from step 2
   - the same link again → Name `RESEND_API_KEY`, Secret: your Resend key
   - the same link again (optional) → Name `DESK_PASSCODE`, Secret: a
     passcode of ten or more characters for the desk. Leave it out and
     one is made and emailed to connect@thekaal.co.
2. Run it: **Actions** tab → **setup-worker** → **Run workflow** → mode
   `all` → **Run workflow**. Or ask Claude to run it.
3. Open the run to read what it did, the same lines the command prints.
   It never prints a key or the passcode, and GitHub blanks out secrets
   in logs anyway (these logs are public, like the repository).

Run it again whenever you like: it skips what is already done.

- `deploy` (the default): puts the latest worker live after a change to
  it is merged. It touches no keys and sends no emails.
- `all`: the first-time setup, everything not yet done, with the samples.
- `check`: only reports where things stand.
- `test`: sends the samples again.

**Refunds, instantly (optional).** The worker finds every refund within half
an hour on its own. To hear at once instead: Razorpay Dashboard → Settings →
Webhooks → the existing webhook (the worker's address) → Edit → also tick
`refund.processed` → Save.

## Step 4. Run the setup

Merge the pull request first, then start a **new** session and send:

> Run `node tools/setup-email.mjs` and finish the email setup from docs/setup-email.md.

It creates the store and the counter, deploys the worker, sets the Resend key
(your Razorpay and GitHub secrets are left alone), checks the live worker,
confirms thekaal.co with Resend, and sends six **[Sample]** emails to
connect@thekaal.co: the five order emails and a daily report with made-up
numbers. Then it opens the desk: with the passcode you chose, or with one it
makes and emails to connect@thekaal.co as "Your KAAL desk". From that moment
the site's return address, the Series 02 forms and the counter switch on by
themselves.

## Step 5. Where you read connect@thekaal.co

Your domain's receiving is switched on in Resend (the `MX @` record pointing
at `inbound-smtp…amazonaws.com`). So everything sent to connect@thekaal.co,
including the daily report, the order alerts and customers' replies, lands
in **Resend → Emails → Receiving**. Nothing is forwarded anywhere and
nothing is lost. Resend's dashboard is not a mail app, though: there is no
notification, and you open it to read.

If you later want connect@thekaal.co in a phone app that rings for each email:
Zoho Mail's free plan gives the address its own inbox and app. That means
switching Resend's receiving off and replacing the `MX @` record with
Zoho's. Sending is unaffected. Ask for it when you want it.

## When something does not arrive

- **No [Sample] emails in Resend → Receiving.** Run
  `node tools/setup-email.mjs --check` in a session: it names whatever is
  missing.
- **A real sale sent nothing.** Cloudflare → Workers → kaal-edition → Logs,
  look for "Email provider refused".
- **The report shows zero visitors.** The counter starts the day the worker
  is deployed; the first full report is the night after.
- **The buyer of No. 09 never got a confirmation.** That sale predates all of
  this. Razorpay Dashboard → Webhooks → that payment's `payment.captured`
  event → **Resend** sends both emails once. It emails a real customer, so
  it is your call.
