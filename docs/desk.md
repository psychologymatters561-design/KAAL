# The desk: your private page

Everything the website knows, on one page only you can open:

**https://kaal-edition.kaal-edition-hq.workers.dev/desk**

It is built for a phone. Open it once, type the passcode, and let the phone
save it. You stay signed in on that phone for thirty days.

## What it shows

| Part | What it is for |
|---|---|
| **Needs you** | The jobs, most urgent first: a payment with no watch number, a number paid for twice, a sold number the site still offers, a dispatch that is late or due today, a buyer who paid six or more hours ago and has not given an address. Each one has WhatsApp, Email and Call buttons for that buyer. |
| **Today so far / Yesterday** | Visitors, add to cart, checkouts and orders, and how far people got: scrolled through the film, reached the twenty, chose a dial, chose a number, opened checkout, paid. |
| **Orders** | Every paid order from the last 120 days: number, dial, buyer, gift card text, the delivery address with a Copy button, the dispatch-by date, and **Mark dispatched**. *Download CSV* gives every order with its address, for the books. |
| **Nearly bought** | Checkouts from today and yesterday that did not end in a payment: the name, city, phone and email the person gave before paying, and the reason Razorpay gives. |
| **The twenty** | Which numbers are sold, which are held right now by someone paying, and which are open. |
| **Series 02 list** | Everyone who asked to hear about Series 02, newest first. *Download CSV* gives the whole list. |
| **Last seven days** | Visitors, add to cart, checkouts and orders per day. |
| **Health** | One line per moving part: emails, Razorpay, the payment webhook, the store, the visitor count, the sold list, the daily report. A **!** means that part needs fixing. |

The daily email at midnight starts with the same **Needs you** list and has a
button that opens the desk.

## Mark dispatched

On the order, tap **Mark dispatched**, type the courier and the tracking
number, and add the tracking link if the courier gave you one. Keep **Email
the buyer the tracking** ticked, and the buyer gets "No. 07 is on its way":
their engraved number, the courier, the tracking number, where it is going,
and the seven-day return promise. Their first email promised tracking "the
day it leaves". This button is how that promise is kept.

Two other uses:

- **An order that went out before the desk existed.** Untick the email and
  mark it dispatched. It stops showing as late.
- **A mistake.** *Undo* takes the mark back. An email that already went
  cannot be unsent, so check the number before you tap.

## Refunds

When Razorpay processes a refund (you issued it in Razorpay, or a
cancellation did), the site finds it by itself within half an hour. You get
an email, and so does the buyer (in KAAL's words, beside Razorpay's own).

A **full** refund leaves one question, and only you answer it. Until you do,
the site keeps showing the number as sold, and **Needs you** asks:

- **Put No. 07 back on sale.** It leaves the sold list on thekaal.co within
  a minute, and anyone can buy it.
- **Keep it retired.** Nothing changes on the site. You can still put it
  back on sale later from the same order.

The desk refuses to release a number someone has bought again since. A
**part** refund (say, a goodwill amount) is reported, and the order stands.

## Who can see it

- Nothing on thekaal.co links to it, and search engines are told not to
  index it.
- It opens only with the passcode. After eight wrong tries from one
  connection, that connection is locked out for fifteen minutes, even if the
  next try is right.
- Another website cannot read it, sign in to it, or press its buttons for you.
- *Sign out* ends the session on that phone. Changing the passcode ends every
  session on every device.

## The passcode

The setup (`node tools/setup-email.mjs`, see docs/setup-email.md) handles it
in one of two ways:

- **You choose it.** Add `DESK_PASSCODE=…` to the environment variables, next
  to the other two keys, before the setup runs. Ten characters or more; four
  unrelated words is easy to remember and hard to guess.
- **It is made for you.** Without `DESK_PASSCODE`, the setup makes a
  sixteen-character passcode and emails it to connect@thekaal.co with the
  subject **"Your KAAL desk"** (in Resend → Emails → Receiving). It is never
  shown in the session or written anywhere else.

**To change it:** Cloudflare → Workers & Pages → kaal-edition → Settings →
Variables and Secrets → `DESK_PASSCODE` → Edit. Every device is signed out.

## When it says something is wrong

- **"The desk is not switched on yet."** `DESK_PASSCODE` is not set on the
  worker. Run the setup, or set it in Cloudflare as described above.
- **"Too many tries."** Wait fifteen minutes.
- **Health: Razorpay !** The worker's Razorpay keys are missing or wrong, so
  orders cannot be read. Payments themselves are unaffected.
- **Health: Payment webhook !** Razorpay has not reached the worker since the
  desk was switched on. It is checked again at the next payment. If a payment
  arrives and this stays red, check Razorpay → Webhooks.
- **A paid number the site still offers.** The sale was not written to
  index.html (usually the worker's GitHub token). Add the number to `sold:` in
  index.html by hand, then fix the token.
