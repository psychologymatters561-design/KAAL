# The desk: your private page

Everything the website knows, on one page only you can open:

**https://kaal-edition.kaal-edition-hq.workers.dev/desk**

It is built for a phone. Open it once, type the passcode, and let the phone
save it. You stay signed in on that phone for thirty days.

## What it shows

| Part | What it is for |
|---|---|
| **Needs you** | The jobs, most urgent first: a payment with no watch number, a number paid for twice, a sold number the site still offers, a dispatch that is late or due today, a buyer who paid six or more hours ago and has not given an address. Each one has WhatsApp, Email and Call buttons for that buyer. |
| **Right now** | Live, every ten seconds: how many people are on the site this minute and where they are (watching the film, reading, at the twenty, giving their details, paying), the last thirty minutes as a bar per minute, each visitor with where they came from (Instagram, Google…), their device, the number and dial they chose, and their steps so far; then the last hour as a list, sales included the moment Razorpay confirms them. Tap a visitor to see their whole history. |
| **Visitors** | Everyone who came in the last ninety days, newest first: where they came from, their device, how many visits, the dials and numbers they chose, whether they opened checkout or paid, and their name and phone once they gave them. Search by name, phone, email, number or visitor number; tap one for every step they ever took. Two spreadsheets: one row per visitor, or one row per step. |
| **Today so far / Yesterday** | Visitors, add to cart, checkouts and orders, and how far people got: scrolled through the film, reached the twenty, chose a dial, chose a number, opened checkout, paid. Today's numbers now move within seconds of each step, not when the visitor leaves. |
| **Orders** | Every paid order from the last 120 days: number, dial, buyer, gift card text, the delivery address with a Copy button, the dispatch-by date, and **Mark dispatched**. *Download CSV* gives every order with its address, for the books. |
| **Nearly bought** | Checkouts from today and yesterday that did not end in a payment: the name, city, phone and email the person gave before paying, and the reason Razorpay gives. |
| **The twenty** | Which numbers are sold, which are held right now by someone paying, and which are open. |
| **Series 02 list** | Everyone who asked to hear about Series 02, newest first. *Download CSV* gives the whole list. |
| **Last seven days** | Visitors, add to cart, checkouts and orders per day. |
| **Health** | One line per moving part: emails, Razorpay, the payment webhook, the store, the visitor count, the sold list, the daily report. A **!** means that part needs fixing. |

The daily email at midnight starts with the same **Needs you** list and has a
button that opens the desk.

## Right now: the live view

You no longer have to wait for the midnight report to see what is
happening. **Right now**, at the top of the desk, refreshes itself every
ten seconds while the desk is open on your screen:

- **The big number** is how many people have the site open this minute.
  Under it, where they are: *watching the film*, *reading the story*, *at
  the twenty*, *giving their details*, *paying now*.
- **The bars** are the last thirty minutes, one per minute, so you can see
  an ad start to land.
- **On the site** lists each person who is there: *Visitor 4 · Instagram ·
  iPhone · At the twenty · No. 07 · Midnight*, how long they have been
  there, and their last few steps.
- **The last hour** is every step, newest first, and every sale the moment
  Razorpay confirms it. When a sale appears, the orders below refresh by
  themselves, address and all.

Where a visit came from is the ad's own `utm_source` when the link has one
(so tag your ad links `?utm_source=instagram`, `?utm_source=facebook`),
otherwise the site that sent it. People who open an ad inside the Instagram
or Facebook app are shown as *Instagram* or *Facebook* even though those
apps hide where they came from.

**What it costs.** Nothing extra for the visitor: the page already checks
the edition with the worker once a minute, and that same request now also
says "still here, at the twenty". Steps travel with the count the page was
already sending. Each visitor is kept in **Visitors** for ninety days (below).

## Visitors: everyone's whole story

Under *Today so far*. Every person who came, newest first, kept for ninety
days after the last time they were seen:

- **The row**: *Visitor 12 · Rahul Sharma · Instagram · iPhone · 3 visits ·
  6m on the site*, then pills for the dials they looked at, the numbers they
  chose, *Opened checkout*, and *Paid · No. 07*.
- **Tap it** for the whole story, visit by visit, every step with its time:
  *Arrived from Instagram on iPhone → Read Emerald → Chose the Midnight dial →
  Chose No. 07 (Midnight) → Turned No. 07 to its engraved back → Pressed buy
  → Gave their name, phone and address → Payment failed: Bank declined →
  Paid ₹5,999 for No. 07*. Pages other than the shop are there too: *Opened
  the movement page*.
- **Today / 7 days / 90 days**, and **Everyone / Bought / Opened checkout /
  Gave details / Chose a number**. Search finds a name, phone, email, city,
  a number, a source ("instagram") or a visitor number ("visitor 12").
- **On every order and every Nearly bought**, a *Their journey* button opens
  the history of the person who placed it.
- **Spreadsheets**: *one row per visitor* (who, from where, how many visits,
  what they chose, did they pay) or *every step*. They follow the period
  you have chosen.
- **The midnight email** now ends with *Who visited*: each of the day's
  visitors and what they did that day (the sixty most recent on a busy day;
  all of them are on the desk).

**How the same person is recognised.** The site already keeps a random ID
on each phone or computer (for number holds). A return visit from the same
browser joins the same history; a visit counts as new after thirty minutes
of nothing. A different phone, a cleared browser or a private window is a
new visitor until they reach checkout and give the same name or phone.

**When they give their details at checkout**, their name, phone, email and
city are put on their history, and a payment on that order is too. The
details form says so at that moment, and `legal.html` says so in full.

**Delete this visitor** (at the foot of any history) removes everything kept
about them, for when someone asks; their orders stay in Razorpay. Everyone
else is deleted by itself ninety days after they were last seen.

**It needs the worker redeployed once.** GitHub → Actions → *setup-worker*
→ *Run workflow* → mode **deploy**. Until then the site behaves exactly as
before and the desk says the live view is waiting for the counter. Turning
off `count` in `KAAL.features` turns the live view off with it.

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
