# The one email after an unfinished checkout

Built, tested, and **off**. Nothing is sent until you turn it on.

## What it sends

Exactly this, as plain text, to someone whose checkout for a number did not
finish:

> **Subject:** No. 07
>
> No. 07 went back to the twenty this afternoon. If you still want it, it is
> here: thekaal.co/#n7. If someone else chooses it first, it is theirs.

`thekaal.co/#n7` opens the twenty on No. 07 with the caseback turned to it.

## When it sends, and when it does not

The worker checks every thirty minutes (the cron in `wrangler.toml`). One
email goes out only when **all** of these are true:

| Rule | Why |
|---|---|
| `ABANDON_EMAIL = "on"` in `wrangler.toml` | It is off by default. `"on"` is the only value that sends. |
| The checkout was priced by this worker 3 to 27 hours ago and never paid | Too soon is pushy; much later is stale. |
| Razorpay holds an email for it | Razorpay only has one if the buyer reached the payment step and it failed or was abandoned there. A modal opened and closed with nothing typed leaves no address, so no email. Nothing is collected for this. |
| The number is still open and nobody else is holding it | The email says "it is here". That has to be true when it lands. |
| That person has not since paid for any piece | |
| They have never had this email for this number | Exactly once per person per number. The record is kept for a year. |
| It is between 12:00 and 18:00 in India | The words say "this afternoon". |

At most ten go out per run. If the provider refuses a send, it is logged and
never retried. Once means once.

The worker code is `abandonedCheckouts()` in `worker/kaal-sold-sync.js`.

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

   A send logs `Abandoned-checkout emails sent: N.` A missing key logs which
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
