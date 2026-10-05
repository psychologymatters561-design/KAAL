# Order emails and the thank-you page: switching them on

Everything is built. What is missing is three accounts only you can open,
and four DNS records only you can add. This page is every click, in order.
About 30 minutes, most of it waiting for DNS.

## What you have at the end

The moment a buyer pays:

1. **Their screen** goes to the thank-you page: their engraved caseback,
   "✓ Payment received · ₹5,999", "No. 07 is yours.", the order, the date it
   arrives, and a short form for the delivery address. It works even if their
   phone closed the tab while they were in their UPI app.
2. **Their inbox** gets "No. 07 is yours" from `connect@thekaal.co`: their
   engraved number, the payment reference, the arrival date, what happens
   next, and a button to add the address if they have not.
3. **Your inbox** gets "New order · No. 07 Midnight · ₹5,999": their email
   and phone, a WhatsApp button, the gift card text, the date to dispatch by,
   and a to-do list. Hitting Reply writes to the buyer.
4. When they give the address, **you** get "Ship to · No. 07 · Name, City"
   with the address ready to copy, and **they** get it echoed back to check.

`tools/test-worker.mjs` proves all of this against fake payments on every
pull request.

---

## Step 1. Make a Resend account (sends the emails)

1. Go to **resend.com** and sign up (free: 3,000 emails a month).
2. Left menu, **API Keys** → **Create API Key**.
3. Name it `kaal-worker`. Permission: **Full access** (the setup adds your
   domain with it; "Sending access" cannot).
4. Copy the key (it starts `re_`). It is shown once.

Then, to save waiting later, add the domain now (the setup finds it and
carries on; if you skip this, the setup adds it and prints the same records):

5. Left menu, **Domains** → **Add Domain** → type `thekaal.co` → keep the
   suggested region → **Add**.
6. Resend shows three or four records. Leave that tab open and do step 5
   of this page (GoDaddy) now, then come back.

## Step 2. Make a Cloudflare token (deploys the worker)

1. Go to **dash.cloudflare.com/profile/api-tokens**, the account the worker
   `kaal-edition` already lives in.
2. **Create Token** → find **Edit Cloudflare Workers** → **Use template**.
3. Account Resources: your account. Zone Resources: leave **All zones**.
4. **Continue to summary** → **Create Token** → copy it. Shown once.

## Step 3. Let the Claude session use them

**Never paste a key into the chat.** In the Claude app, open the cloud
environment menu in the session's title bar → **Edit**:

1. **Network access** → **Custom**. Keep the default package managers
   ticked (they fetch the deploy tool) and add these allowed domains:
   ```
   api.cloudflare.com
   api.resend.com
   kaal-edition.kaal-edition-hq.workers.dev
   ```
2. **Environment variables** (or **API credentials**, if offered) → add:
   ```
   CLOUDFLARE_API_TOKEN = the Cloudflare token from step 2
   RESEND_API_KEY       = the Resend key from step 1
   OWNER_EMAIL          = the inbox you actually read, e.g. yourname@gmail.com
   ```
   For two inboxes, separate them with a comma. `OWNER_EMAIL` goes onto the
   worker as a secret, so it never appears in the public repository.
3. Save. The settings reach **new** sessions, not the one already open.

The full steps: https://code.claude.com/docs/en/cloud-environments#network-access

## Step 4. Run the setup

Start a new session on this repository and send:

> Run `node tools/setup-email.mjs` and finish the email setup from docs/setup-email.md.

It:
- creates the store the worker keeps holds and receipts in
- deploys the worker
- sets the two secrets, leaving your Razorpay and GitHub ones alone
- checks the live worker
- adds thekaal.co to Resend

It ends by printing the DNS records for step 5. From that moment the
thank-you page's return address and the Series 02 forms switch on by
themselves.

(On your own computer instead: set the three values in a terminal and run
the same command. It needs Node 22.)

## Step 5. Add the email records at GoDaddy

1. GoDaddy → **My Products** → **thekaal.co** → **DNS** (Manage DNS).
2. For each record the setup printed: **Add New Record**, pick the Type,
   type the **Name** exactly as printed (`send`, not `send.thekaal.co`),
   paste the Value, set Priority for the MX record, TTL default. Save.

   They look like this. Yours will have a longer DKIM value; use the
   setup's, not these:

   | Type | Name | Priority | Value |
   |---|---|---|---|
   | MX | `send` | 10 | `feedback-smtp.us-east-1.amazonses.com` |
   | TXT | `send` | | `v=spf1 include:amazonses.com ~all` |
   | TXT | `resend._domainkey` | | `p=MIGf…` (long) |
   | TXT | `_dmarc` | | `v=DMARC1; p=none;` |

   GoDaddy often creates a `_dmarc` record by itself. If the list already
   has a TXT record named `_dmarc`, keep it and do not add a second one.

3. If you added the domain in Resend's dashboard (step 1), go back to that
   tab and click **Verify DNS Records**.
4. Wait 15 to 60 minutes, then in a session: "Run
   `node tools/setup-email.mjs --check`". When it says **verified**, run it
   once more without `--check` and the four sample emails arrive in your
   inbox, marked [Sample].

These records only let Resend send **as** thekaal.co. They do not touch the
website, and they do not touch any email you receive.

## Step 6. Make connect@thekaal.co receive mail

Buyers will reply to their confirmation, and the site lists
connect@thekaal.co. Right now nothing receives that address, so replies
bounce. The fix is free forwarding to the inbox you read:

1. Go to **improvmx.com**, enter `thekaal.co` and your inbox (e.g. your Gmail).
2. It shows three records. Add them at GoDaddy the same way:

   | Type | Name | Priority | Value |
   |---|---|---|---|
   | MX | `@` | 10 | `mx1.improvmx.com` |
   | MX | `@` | 20 | `mx2.improvmx.com` |
   | TXT | `@` | | `v=spf1 include:spf.improvmx.com ~all` |

3. **Before adding:** if GoDaddy already lists MX records with Name `@`,
   delete them. You told me there is no mailbox there. If a TXT record at
   `@` already starts with `v=spf1`, do not add a second one: put
   `include:spf.improvmx.com` into the existing one.
4. ImprovMX confirms in a few minutes. Send a test to connect@thekaal.co
   from another address; it should land in your inbox.

These are separate from the step-5 records (`@` versus `send`), so the two
never conflict.

## When something does not arrive

- **Sample emails in Spam.** Open one and mark it **Not spam**. The
  `_dmarc` record from step 5 helps Gmail trust the domain within a day or
  two.
- **Domain stays "pending"** after an hour. In GoDaddy, check each record's
  Name has no `.thekaal.co` on the end and the DKIM value was pasted whole.
- **A real sale sent nothing.** In Cloudflare → Workers → kaal-edition →
  Logs, look for "Email provider refused". The setup's `--check` shows
  which secret is missing.
- **The buyer of No. 09 never got a confirmation.** That sale happened
  before any of this existed. If you want them to have one: Razorpay
  Dashboard → Webhooks → your webhook → that payment's
  `payment.captured` event → **Resend**. The worker sees No. 09 is already
  recorded, changes nothing, and sends both emails once. That emails a real
  customer, so it is your call.
