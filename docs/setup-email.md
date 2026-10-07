# Emails from the website: switching them on

Everything the website emails goes to **connect@thekaal.co**. No personal
inbox is involved anywhere.

## What the website sends, once this is on

| When | To | What |
|---|---|---|
| A payment lands | the buyer | "No. 07 is yours": their engraved caseback, the order, payment reference, arrival date, what happens next, a button to add the address |
| A payment lands | connect@thekaal.co | "New order · No. 07 Midnight · ₹5,999": buyer's email and phone, WhatsApp button, gift card, dispatch-by date. Reply writes to the buyer. (`ORDER_ALERT = "off"` in `wrangler.toml` turns this one off.) |
| The buyer gives an address | both | the address, to copy (you) and to check (them) |
| Just after midnight, every day | connect@thekaal.co | **The daily report**: visitors, page visits, how many scrolled through the film, reached the twenty, chose a dial, chose a number (add to cart), opened checkout, paid; each order with contact; unfinished checkouts with why and how to reach them; new Series 02 leads; numbers left; the last seven days |

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
   ```
3. Save. New sessions pick it up.

https://code.claude.com/docs/en/cloud-environments#network-access

## Step 4. Run the setup

Merge the pull request first, then start a **new** session and send:

> Run `node tools/setup-email.mjs` and finish the email setup from docs/setup-email.md.

It creates the store and the counter, deploys the worker, sets the Resend key
(your Razorpay and GitHub secrets are left alone), checks the live worker,
confirms thekaal.co with Resend, and sends five **[Sample]** emails to
connect@thekaal.co: the four order emails and a daily report with made-up
numbers. From that moment the site's return address, the Series 02 forms and
the counter switch on by themselves.

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
