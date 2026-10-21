# The emails nobody presses send on

The worker sends five emails by itself, on the thirty-minute cron. The
words are in `worker/mail.js`; who gets which, and when, is section 3e of
`worker/kaal-sold-sync.js`. Each has its own switch in `wrangler.toml`:
`"on"` is the only value that sends. To stop one, set it to `"off"` and
deploy (`tools/deploy-worker.sh`, or the **Set up the worker** workflow in
`deploy` mode).

| Email | Trigger | Subject | Once-key | Flag |
|---|---|---|---|---|
| Nearly bought, number still open (A) | A checkout 3 hours to `ABANDON_LOOKBACK_DAYS` (45, since launch) old, never paid, with an email (typed in our details step, or held by Razorpay). Their number is unsold and nobody is paying for it this minute. | `No. 07` | `nearly:<hash>` (per person, ever) | `ABANDON_EMAIL` |
| Nearly bought, number sold since (B) | As above, but their number has sold. Lists the same dial's open numbers and links to the lowest; if the dial is fully claimed, says so and links to `#twenty`. | `No. 09` | `nearly:<hash>` | `ABANDON_EMAIL` |
| Nearly bought, no number (C) | As above, with no number on the checkout. | `Seventeen of twenty` | `nearly:<hash>` | `ABANDON_EMAIL` |
| Series 02 note | On the Series 02 list for 24 hours, while Series 01 has a piece left. Never to a buyer, to anyone who had the nearly-bought email, or whose own checkout is still in that email's window. Existing sign-ups go in daily-cap-sized batches. | `Series 02` | `s02note:<hash>` | `SERIES02_EMAIL` |
| Has it arrived? | A dispatched order, the day after its "Arrives by" date and at least two days after dispatch; not later than a week after that date. | `Has No. 07 arrived?` | `after1:<order>` | `ARRIVAL_EMAIL` |
| Yours for good | Ten days after dispatch, never before seven days past "Arrives by", no refund of any amount, not a gift; not later than thirty days after dispatch. | `No. 07 is yours for good` | `after2:<order>` | `SETTLED_EMAIL` |
| One year | A year after dispatch (within a month of it), not a gift. | `One year with No. 07` | `after3:<order>` | `YEAR_EMAIL` |

`<hash>` is the first 32 characters of the SHA-256 of the lowercased email:
the same for every key kept about one person. `<order>` is the Razorpay
order id.

## Rules every one of them keeps

- **When.** Only between 10:00 and 20:00 in India.
- **How many.** At most ten per cron run, spaced 600 ms apart (Resend takes two a second), and ninety a day across all five
  (the count is the KV key `sent:<India day>`, by kind), so with the order
  emails the shop stays inside Resend's free tier of a hundred a day. Every
  attempt counts.
- **Stop.** Never to anyone with a `stop:<hash>` key. Inbound mail is not
  wired to the worker, so a reply saying "stop" reaches a person, who
  presses **Stop emails to this person** on the desk (Nearly bought, or the
  Series 02 list). It can be undone there.
- **Never paid.** The two before a purchase never go to anyone who has paid
  for any piece: a payment captured, authorized or refunded under that
  email in the last 400 days, or the email typed into our details step for
  a paid order.
- **True when it lands.** No count is guessed: if the sold list cannot be
  read, nothing that states a count is sent. "Still unclaimed" waits a run
  while someone else is paying for that number.
- **Once.** The once-key is written before the send, so a failed send is
  never repeated.
- **A gift's buyer is not its wearer.** The welcome email says so, and the
  two notes that speak of wearing it are not sent for a gift.

## What every email before a purchase looks like

A note, not a newsletter: the existing frame, 16px system sans, left
aligned, no heading, button, picture or card, the link one underlined line,
and a plain-text part with a blank line between paragraphs. Each carries
`List-Unsubscribe: <mailto:connect@thekaal.co?subject=stop>` and the faint
footer line *Reply "stop" and we won't write again.* No discount, no
deadline, no countdown, no exclamation mark; the count is the real count.
`tools/test-worker.mjs` fails if any customer email says *discount*, *% off*,
*hurry*, *last chance*, *exclusive*, *luxury*, *limited time*, *hold*,
*reserve*, or carries an exclamation mark.

The three after a purchase carry their caseback and are signed KAAL. They
are about the owner's own watch, so they carry no unsubscribe header; a
stop still stops them.

## Someone with a phone and no email

Nothing goes on its own (automated WhatsApp needs Meta's paid Business
API). On the desk's **Nearly bought**, their row has **WhatsApp, words
typed**: it opens WhatsApp with the same note, in the same three shapes,
and the owner presses send.

## The welcome email and page

`buyerConfirmation` (the moment Razorpay confirms the payment) and
`claimed.html` (where every successful payment lands: the modal's handler
after `/verify`, the worker's `/callback` for in-app browsers and
redirects, and a tab recovered after the phone discarded it) say the same
thing in the same words: their dial and caseback, "It is yours.", the three
steps of what happens now. It is an order email: no unsubscribe header, and
not counted in the ninety.

## On the desk and in the daily report

The desk shows *Follow-up email sent* on anyone in Nearly bought who has had
it, and *Arrival note sent*, *Seven-day note sent*, *One-year note sent* on
each order. The daily report has **Emails sent on their own**: the day's
count of each.

## Before switching one on: consent

India's DPDP Act 2023 lets you use personal data for the purpose it was
given. Someone who typed their email into a checkout for No. 07 gave it to
buy No. 07: one message about that same number, with no offer and no
urgency, is the narrowest reading of that purpose. The Series 02 form now
says what it will send: *One note while Series 01 is still open, and one
email when Series 02 is drawn. Nothing else.* People who joined before that
line changed were promised only the second; whether to send them the first
is your decision. This note is not legal advice.

## Watching it

```bash
npx wrangler tail
```

A run that sends logs `Follow-up emails sent: N; M today.` A missing key logs
which one is missing.
