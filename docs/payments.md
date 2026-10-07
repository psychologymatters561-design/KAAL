# After the money: how a buyer gets home, and how you hear about it

## What went wrong on 2 October

You bought No. 09 on an iPhone. Razorpay captured the payment, its webhook
reached the worker, and the worker recorded the sale. The commit
`Auto: mark number 9 sold` is on `main`. The money side worked.

What broke was the way back. The only thing that knew to send you to the
thank-you page was the tab that opened checkout. A phone that switches to a
payment app is free to throw that tab away to save memory. When you came
back, the page had reloaded and knew nothing about the payment. And nothing
emailed anyone.

## What happens now

| Moment | What happens | Where it lives |
|---|---|---|
| Checkout opens | The order is remembered on the device, and the hero's decoded frames are released, so the phone has less reason to discard the tab. | `index.html`, `openRzp` |
| Payment succeeds, page alive | Same as before: the modal hands back, the worker checks the signature, and the buyer goes to the receipt. | `/verify` |
| Payment succeeds, Razorpay redirects | Razorpay posts the result to the worker's `/callback`. The worker checks the signature, records the number, and redirects the buyer to the receipt. The tab does not need to survive. | `/callback` |
| Payment succeeds, tab was discarded | The page that loads when the buyer comes back sees the remembered order and asks the worker if it was paid. If it was, it goes straight to the receipt. | `recoverCheckout`, `/receipt` |
| Payment fails | The buyer lands back on the twenty, with "That payment did not go through. Nothing has been charged, and you can try again." | `/callback` |
| The receipt page | Asks the worker whether the order is really paid; never trusts the URL. Shows the number, dial, amount, reference, arrival date and gift. | `claimed.html`, `/receipt` |
| Where it goes | Standard Checkout never collects an address. The receipt asks once: name, phone, address, city, state, PIN. It is accepted only for a paid order. | `claimed.html`, `/shipping` |
| You hear | An email for every sale: number, dial, amount, buyer email and phone, gift note, a Razorpay link and the remaining count. A second email when the address arrives. | `notifySale`, `/shipping` |
| The buyer hears | "No. 09 is yours", with a link back to the address form in case they closed the page, and a copy of the address when they give it. | `notifySale`, `/shipping` |

`/receipt` returns only paid or unpaid, the number, the amount and the
reference. It never returns an email, a phone number or an address.

## What you need to do once (about 15 minutes)

1. **Resend** (free tier is plenty): sign up at resend.com, add `thekaal.co`
   as a domain, and add the three DNS records it shows you where your
   domain's DNS lives. Wait for it to say Verified. Then create an API key.
2. In this folder:

   ```bash
   npx wrangler secret put RESEND_API_KEY
   ```

3. Where your sale emails go is the `OWNER_EMAIL` secret, not a line in
   `wrangler.toml`. `docs/setup-email.md` sets it, with the Resend key and
   the domain, in one command (`node tools/setup-email.mjs`).
4. If you have not yet, create the KV namespace. Its id goes into
   `wrangler.toml`. It makes `/callback`, the address store and the
   no-duplicate-emails guard work:

   ```bash
   npx wrangler kv namespace create KAAL_STATE
   ```

5. Deploy the worker:

   ```bash
   tools/deploy-worker.sh
   ```

   **Nothing in the page needs changing after this.** The page asks the
   worker what it can do (`"v": 2` in `/state`). Until the new worker is
   deployed it leaves out the Razorpay return address and the Series 02
   forms, because the old worker answers those with "Signature mismatch.";
   the moment the new one is live, both switch on by themselves on the next
   visit.

6. Test with a real ₹1 order (temporarily set `PRICE_PAISE = "100"` in
   `wrangler.toml` and redeploy, then put it back). Then watch the logs:

   ```bash
   npx wrangler tail
   ```

   You should get the sale email, the buyer email, the receipt page, and
   then the address email.

Without the Resend key, everything except the emails still works. The worker
logs `Sale emails skipped`, and sales are never held up by mail.
