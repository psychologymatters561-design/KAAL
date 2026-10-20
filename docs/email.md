# The one email after an unfinished checkout

**On** (`ABANDON_EMAIL = "on"` in `wrangler.toml`). One email, once per
person, ever, to someone who started a checkout, gave an email, and never
paid. The words are `buyerNearlyBought()` in `worker/mail.js`; the rules are
`abandonedCheckouts()` in `worker/kaal-sold-sync.js`.

## What it sends

The KAAL dark email, from `KAAL <connect@thekaal.co>`, with a plain-text
copy. One of three, whichever is true when it is sent:

| Their checkout | Subject | What it says |
|---|---|---|
| Number still open | **No. 07 is still here** | Their caseback photo; when they chose it; nobody has taken it; the real count left; *Claim No. 07* to `thekaal.co/#n7` |
| Number sold since | **No. 07 found its owner** | Someone else finished what they started; how many are still open; *See the twenty* |
| No number on it | **Your piece is still waiting** | How many remain; *See the twenty* |

All three: no discount, no deadline. The anti-brand paragraph, "reply to
this email", the warranty, seven-day return and free delivery, and a footer
saying this is the only email and *reply "stop"* ends it. Someone who
replies "stop" is already done: there is no second email to stop.

## When it sends, and when it does not

The worker checks every thirty minutes (the cron in `wrangler.toml`).

| Rule | Why |
|---|---|
| Checkout priced by this worker 3 hours to `ABANDON_LOOKBACK_DAYS` (default 30) ago, never paid | Too soon is pushy. The first run after switching on catches the backlog. |
| There is an email: the one typed into the site's details step, or the one Razorpay holds | Nothing is guessed. |
| That person has never paid for any piece | |
| They have never had this email, for any number | Once per person, ever. Key `nearly:<hash>`, kept two years, written before the send. |
| If their number is open and someone is paying for it this minute, wait for the next run | "Still here" has to be true when it lands. |
| Between 10:00 and 20:00 in India, at most ten per run | |

The desk's **Nearly bought** shows *Follow-up email sent* on anyone who has
had it.

## Turning it on

1. **The KV namespace.** It is the same one the holds and the Series 02 list
   use. If you have not created it yet:

   ```bash
   npx wrangler kv namespace create KAAL_STATE
   ```

   Paste the id into the `[[kv_namespaces]]` block in `wrangler.toml` and
   uncomment the block.

2. **An email provider.** Pick one.

   - **Resend** (simplest): sign up at resend.com, verify `thekaal.co` as a
     sending domain (it gives you three DNS records), create an API key, then:

     ```bash
     npx wrangler secret put RESEND_API_KEY
     ```

   - **Brevo**: sign up at brevo.com, verify the sender `connect@thekaal.co`
     (or the domain), create an API key under SMTP & API, then:

     ```bash
     npx wrangler secret put BREVO_API_KEY
     ```

   If both keys are set, Resend is used.

3. **The sender.** In `wrangler.toml`, uncomment:

   ```toml
   ABANDON_FROM = "KAAL <connect@thekaal.co>"
   ```

   The address must be one your provider has verified. Replies go to
   `connect@thekaal.co` unless you also set `ABANDON_REPLY_TO`.

4. **Switch it on.** In `wrangler.toml`, set `ABANDON_EMAIL = "on"`, then:

   ```bash
   tools/deploy-worker.sh
   ```

5. **Watch the first afternoon.**

   ```bash
   npx wrangler tail
   ```

   A send logs `Nearly-bought emails sent: N.` A missing key logs which
   one is missing.

To switch it off again, set `ABANDON_EMAIL = "off"` and redeploy. Nothing
else needs undoing.

## Before you switch it on: one consideration

India's DPDP Act 2023 lets you use personal data for the purpose it was
given. Someone who typed their email into a checkout for No. 07 gave it to
buy No. 07. One message about that same number, with no offer, no discount
and no urgency, is the narrowest reading of that purpose. That narrowness is
why the words are what they are and why it is one email, ever.

It is still your decision and your risk, not this code's. If you want to be
beyond question, add a line at checkout saying you may send one email about
an unfinished order, before turning this on. This note is not legal advice.

## Testing without a real customer

The logic is covered by a local harness, using mocked Razorpay and Resend
responses. Against a live worker, the honest test is a real unfinished
checkout on your own email:

1. Choose a number, open checkout, and enter your email at the payment step.
2. Let the payment fail, for example by cancelling at the bank page.
3. Wait three hours.
4. Make sure that falls inside 12:00–18:00 IST.
