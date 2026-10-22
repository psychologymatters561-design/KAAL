# Meta: making every sale reach the ad account

## What went wrong in October

Two watches sold from the Meta campaign (No. 10 on 20 October, No. 07 on
22 October), and Ads Manager showed neither. Three things stacked up:

1. **Meta heard about a sale from one place only: the buyer's browser.**
   The Pixel fires Purchase on `claimed.html`, and it works there (tested
   in Chromium: one Purchase, ₹5,999, `KAAL-07`, with the Razorpay payment
   id as its event id). But a buyer who taps an Instagram ad pays inside
   Instagram's own browser. UPI sends them out to GPay or PhonePe, and the
   phone is free to close that browser while they are away. They never
   come back to `claimed.html`, so the Pixel never fires. Safari's tracking
   protection and ad blockers drop it too.
2. **The server's copy was written but switched off.** The worker has
   always been able to send the same Purchase to Meta (the Conversions
   API). It needs a token, `META_CAPI_TOKEN`, and nothing in the setup had
   ever asked for one.
3. **Even switched on, it could be skipped.** It ran only after the sale
   was committed to GitHub, so a webhook that timed out on the commit and
   came back as a retry never told Meta at all.

## What the site does now

- The worker sends the Purchase **at the moment the payment is proved**,
  beside the GitHub commit rather than after it. It sends the email, phone
  and name hashed (never in the clear, never the address), the browser's
  `_fbp` / `_fbc` click cookies, IP and user agent taken at checkout, and
  the same event id as the browser. Meta counts the pair as **one** sale.
- Every half hour the worker looks at the last six and a half days of
  payments and re-sends any full-price sale that Meta has not accepted yet.
  **Turning the token on therefore backfills No. 10 and No. 07** within
  half an hour. Meta accepts a purchase up to seven days late and still
  credits the ad that caused it, so this has to happen by 27 October for
  No. 10.
- The home page keeps the ad click (`?fbclid=`) for 28 days, so a buyer
  who clicks the ad on Monday and pays on Wednesday is still matched, even
  after Safari has deleted the Pixel's own cookie.
- The desk's **Health** list has a line for Meta: off, on, the last sale
  sent, or what Meta said when it refused one.

## Switch it on (about five minutes, from a phone)

1. **Make the token.** Meta Events Manager → **Data sources** → the dataset
   with id **1607748840888926** → **Settings** → **Conversions API** →
   **Generate access token**. Copy it. It is shown once.
   - If that button is greyed out, you are not an admin of the dataset in
     Business Settings → Data sources → Datasets → People.
2. **Give it to GitHub.** github.com → the KAAL repository → **Settings** →
   **Secrets and variables** → **Actions** → **New repository secret**.
   Name: `META_CAPI_TOKEN`. Value: the token.
3. **Put it on the worker.** The repository → **Actions** → **setup-worker**
   → **Run workflow** → mode **deploy** → Run. It deploys the worker and
   sets the token. The log says "META_CAPI_TOKEN set on the worker".
4. **Check.** Within half an hour, Events Manager → the dataset →
   **Overview** shows Purchase events with "Server" as a source, and the
   desk's Health line reads "On. Last sale sent …".

To test before a real sale, Events Manager → **Test events** gives a code.
Set it as a worker secret `META_TEST_EVENT_CODE`, and **remove it again
afterwards**: while it is set, every sale goes to the Test tab and not to
the ad account.

## Things only Ads Manager can fix

Even with every sale reaching the dataset, a campaign only shows a sale as
its result when all of these hold. Check each one.

| Check | Where | What it should be |
|---|---|---|
| The ad tracks this dataset | Ads Manager → the ad → **Tracking** → Website events | Ticked, dataset **1607748840888926** |
| The campaign optimises for a purchase | Campaign objective **Sales**; ad set conversion event **Purchase** | Otherwise "Results" counts clicks or views, not sales |
| You are looking at purchases | Columns → **Customise** → add **Purchases** and **Purchase conversion value** | Shows sales whatever the objective |
| The attribution window | Ad set → Attribution setting | 7-day click, 1-day view (the default) |
| The domain is verified | Business Settings → Brand safety → **Domains** → thekaal.co | Verified (index.html has a commented `facebook-domain-verification` tag waiting for the code) |
| The ad account can use the dataset | Business Settings → Datasets → 1607748840888926 → **Connected assets** | The ad account is listed |

A frank note on volume. Meta's "Sales" optimisation learns from about fifty
purchases a week, and Series 01 is twenty watches in total. It will never
leave the learning phase on Purchase. Optimise the ad set for
**AddToCart** or **InitiateCheckout**, which the site already sends with a
₹5,999 value, and keep Purchase as the number you judge the money by.

## What is sent, and what never is

| Sent to Meta, hashed | Sent as it is | Never sent |
|---|---|---|
| email, phone (with 91), first and last name, country "in" | IP and browser at checkout, `_fbp` and `_fbc`, ₹ amount, `KAAL-07`, order id, payment id | address, PIN, gift note, card or UPI details |

`legal.html#privacy` says exactly this, and has to change if this does.
