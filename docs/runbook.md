# The runbook

One page for the person who runs KAAL. Every screen, every button, and what to
do when something looks wrong. Nothing here needs a computer.

## Where things are

| | Address |
|---|---|
| The shop | thekaal.co |
| **The command centre** (you only) | kaal-edition.kaal-edition-hq.workers.dev/control |
| Owners sign in and see their piece | thekaal.co/owners |
| Anyone follows an order | thekaal.co/track (the link is in every tracking email) |
| The public registry | thekaal.co/registry |
| What AI search reads about stock | thekaal.co/edition.json and thekaal.co/llms.txt |

The old desk address (/desk) now opens the command centre: the control room
and the desk are one app.

### Getting in, the easy and safe way

1. On your phone, open the command centre address above and type your
   passcode (the DESK_PASSCODE secret; the same one the old desk used). Tap
   **Show** to check what you typed.
2. Add it to your home screen: Safari, Share, Add to Home Screen (Chrome:
   menu, Add to Home screen). It opens like an app.
3. That phone stays signed in for thirty days. Then it asks again.

What keeps it safe:
- Eight wrong tries from one connection, and that connection waits fifteen
  minutes.
- Thirty wrong tries from anywhere in an hour, and the passcode stops working
  for the rest of that hour. You are emailed once.
- Every sign-in from a device it has not seen before emails you which device,
  roughly where, and what to do if it was not you.
- **Settings, Sign out every device** ends every signed-in session, the old
  desk's included.
- Forgot the passcode, or it is paused? **Use an emailed code instead** on
  the sign-in screen: a six digit code to the admin address.

To change the passcode: GitHub, the KAAL repository, Settings, Secrets and
variables, Actions, DESK_PASSCODE, Update. It takes effect at the next deploy
(merging anything that touches the worker, or Actions, setup-worker, mode
live). Make it long: four or five unrelated words beat any short password.
Keep Google's 2-step verification on the admin mailbox, because the emailed
code is the other way in.

Your own address can also own a piece (No. 01). The two doors stay apart:
signing in at /control opens only the command centre, and signing in at
thekaal.co/owners opens only your piece's dossier.

## Each screen of the command centre

On a phone the bar along the bottom holds Today, Orders, Visitors, Activity
and More (everything else). On a computer the same screens are down the left.
Keys: 1 to 9 open screens, k (or Ctrl/Cmd K) opens the command bar, / searches,
r refreshes, u undoes, ? lists them.

**Tell it what to do** (the ⌘ button at the top, or k). Type it in your own
words: "put 9 on sale", "keep 12 back", "mark 9 unsold", "how many are
left", "show hot leads", "who is on the site", "visitor 14", "orders to ship".
Anything that changes the shop is read back to you first, and happens only
when you press **Do it**. Putting a number on sale or keeping it back changes
three things at once: the registry (what checkout obeys), the live shop page
(within seconds) and the site's own file with llms.txt and edition.json (one
commit, within a minute). A number with a paid order cannot be put back on
sale from here: refund it or mark it returned first. The same switch is at
the top of each number in **The twenty**.

**Activity, live.** Everything as it happens, newest first, on one line of
time: every visitor's arrival and step (with their first name once they gave
it, where they came from, the city, the phone), every checkout and payment,
every owner's registration or request, and every change you or the system
made. Last hour, Today, 24 hours or 7 days; filter to Money, Intent,
Arrivals, Owners, You or System. It asks again every eight seconds while it is
open and new lines glow once. Tap a visitor's line for their whole history.

**Phone alerts** (Settings, at the top). One tap on **Turn on phone alerts**
and every sale reaches your phone within seconds, even with the command
centre closed: "Sold: No. 07 · ₹5,999". You can also be told when someone
opens the checkout (once per person in twenty minutes), when an owner
registers or asks for something, and when something is wrong; switch any of
those off there. Android and computers: Chrome, Edge or Firefox, just tap.
iPhone (iOS 16.4 or later): in Safari open the command centre, tap Share,
**Add to Home Screen**, open KAAL from the Home Screen, sign in with the
passcode, then Settings, Turn on phone alerts. The messages are encrypted to
your phone; nobody in between can read them.

**Today.** A live sales dashboard. Choose **Today, 7 days, 30 days or 90
days** at the top (it remembers your choice). Six numbers for that period,
each against the same length of time before it (Today against yesterday):
**Visits** (with how many different visitors), **Add to cart** (visits that
chose a number), **Checkouts**, **Orders**, **Revenue** (after refunds and
returns) and **Conversion** (orders per visitor), each with its own small
day-by-day trend. Below them, visits and orders day by day (Today shows the
last fourteen days), **The path to a sale** (how many got to each step, and
how many were lost at it), and **Where they came from** (each source's
visitors, add to carts, checkouts and sales; tap one to see those visitors).
The numbers refresh every thirty seconds while it is open; a visit is
counted as it ends, so the last few minutes arrive with it.
Then **Needs you** (late orders, courier alerts, approvals, failed emails, a
refunded number to put back on sale or keep retired, a payment with no
number, and any number the shop shows as sold with no order in the registry,
with **Record a past sale** beside it), **Right now** (who is on the site this
minute and where, every ten seconds), this week's **hot leads**, the twenty
and the orders waiting at each stage.

**Visitors and leads.** Every visitor of the last ninety days, newest first,
opening on **Hot leads**. Each carries a score out of 100, from what they did
and nothing else: reached the twenty 10, chose a dial 10, chose a number 15,
turned to the caseback 10, watched the film through 5, read three or more of
the story 5, opened checkout 20, gave their details 15, came back another day
10, three minutes or more on the site 5. A buyer is 100. 50 and over is hot,
25 and over warm. Filter by Warm, Everyone, Bought, Opened checkout, Gave
details, Came back; search by name, phone, email, city, campaign or visitor
number. Tap a visitor for their whole story: where they came from and which
ad, roughly where (a city and state from their connection, never their
address), phone and browser, every visit, every step, and WhatsApp, Call and
Email buttons when they gave their details. **Delete this visitor** is for
when someone asks.

**Insights.** Today, 7, 30 or 90 days. Where people stop on the way to a
sale; every source with visitors, numbers chosen, checkouts, sales and hot
leads; every ad campaign and ad; states and cities; phones and browsers; the
hours (India time) and days they come; the numbers and dials that pull
interest; the story they read; how long they stay. Tap any row to see exactly
those visitors.

To see each ad by name, every Meta ad needs these URL parameters (Ads
Manager, the ad, Destination, URL parameters). Insights shows a Copy button
for it until the first tagged visit arrives:

    utm_source=meta&utm_medium={{placement}}&utm_campaign={{campaign.name}}&utm_content={{ad.name}}

**AI search.** What ChatGPT, Perplexity, Google and Bing are told right now
(available, gone, each dial), links to check it (edition.json, llms.txt,
Google's rich results test, the schema validator), buttons that ask each
engine "How many KAAL Series 01 watches are left?", and the visitors those
engines sent. Nothing to press: every sale rewrites the shop page's counts,
its grid and structured data, llms.txt's Live status and edition.json in the
same commit, and Bing (which ChatGPT search reads) is told at once.

**Orders.** Tabs: To ship, Delivered (not registered yet), Finished, All, and
**Nearly bought** (checkouts opened today or yesterday that did not end in a
payment, with a WhatsApp note already written for you to send). **Bring in
from Razorpay** pulls in any paid order the registry has not seen. One card
per order with its stage, the buyer's WhatsApp, Call and Email, and **Their
journey** (the visitor history behind the order). One tap per stage:
Inspected, Packed, Dispatched (courier, tracking number, tracking link),
Delivered (a date, today by default: this starts the warranty and the return
window and emails the registration link). Each tap gives you **ten seconds to
Undo** before the buyer's email goes. If Shiprocket is connected
(docs/courier.md) Dispatched and Delivered happen by themselves.
Extra buttons: **Change without email** (a correction, with a reason in the
log), **Send registration link** (emails a fresh one; earlier ones keep
working), **New link, cancel old** (for a link that went astray), **Mark
returned** (only inside the seven days and before registering; the buyer is
never sold to again), **Refund** (full amount, through Razorpay, after you
type the number). **Record a past sale** is for Nos. 01 and 02.

**The twenty.** Each number, with the photograph of that exact watch (upload),
colourway, private notes, and a manual status change that needs a reason.

**Owners.** Search by name, email or phone, see an owner's chain, change
contact details when they ask, sign them out everywhere.

**Approvals.** What waits for you; a warranty claim is promised an answer in
48 hours and you are emailed at 36.
- *Warranty claim:* **Approve** (type the pickup details; they are emailed),
  **Ask for more** (your question is emailed), **Decline** (your reason is
  emailed, with the paid service offered), then after the movement is swapped
  **Mark serviced** (writes the service history, emails that it is on its way
  back; a public line is optional).
- *Stolen report:* **Confirm** shows the piece as stolen in the public registry
  and blocks transfers; **Clear** undoes it; **Dismiss** ignores a mistake.
- *Recovery* (an owner who lost their email): check the order, a photograph of
  the caseback and the letter by email, then **Verify** (their sign-in moves to
  the address they gave, every old sign-in closes) or **Decline**.
- *Contact change:* make it in Owners, then **Done**.
- *Transfer:* **Approve** closes the old ownership and opens the next Owner,
  the warranty unchanged; **Reject** leaves it. Turn the approval off in
  Settings and transfers complete by themselves.

**Series 02 list.** Everyone who asked to hear about Series 02, with where
they came from, a CSV, and Stop emails for anyone who asks.

**Health.** Every connection in one list (emails, Razorpay, the webhook, the
store, the visitor count, Meta, the sold list, the daily report); anything
not ok says what to do.

**Emails.** Every email, with its state (queued, sent, failed). A failed one is
retried five times over about eight hours, then marked failed; **Retry** tries
again. Preview any letter, or send a test to yourself. A failed email never
blocks a change.

**Settings.** Whether stage emails go, whether transfers wait for you, the
sender name, the setting guide video link owners see, return days and warranty
months, blocked buyers.

**Audit.** Every action, who and when, before and after; CSV of orders,
owners and pieces; **Backup now**.

## When something looks wrong

- **Health says the database does not answer.** Cloudflare may be having a
  moment; try again in ten minutes. The shop itself keeps taking payments.
- **The six-hourly "health" run went red** (GitHub emails you). The worker or
  site did not answer. Open Actions, health, the red run, to see which line
  failed.
- **A buyer says they got no email.** Emails screen: sent, or failed with a
  reason. Resend only needs its sending domain verified at Resend.
- **A sale is not showing as paid.** Since 28 Oct 2026 the sale is recorded
  (registry, live shop, Activity, the buyer's history, your phone) before the
  site file is written, so a slow GitHub can no longer drop it; a file that
  failed is written by the half-hourly repair run. Activity, Money shows every
  payment as it lands.
- **A buyer paid and the watch is not in Orders.** The daily check against
  Razorpay brings it in within a day and emails you; or Overview, "Bring in
  paid orders from Razorpay".
- **An owner cannot sign in.** First: has the piece been registered? Sign-in
  codes go only to registered owners. A buyer whose piece is delivered but not
  registered who asks for a code is emailed the registration link instead
  (once an hour at most). Before delivery, nothing is sent: mark the order
  Delivered first. If it is registered and still fails, the sign-in page's
  "Cannot sign in?" lands in Approvals as a recovery request.

## Backups

1. **Cloudflare's own:** D1 keeps a point-in-time copy for 30 days.
2. **Yours, nightly:** create a **private** GitHub repository (say
   `kaal-backups`), make a fine-grained token with Contents write on that one
   repository, and add two repository secrets: `BACKUP_REPO` (`you/kaal-backups`)
   and `BACKUP_REPO_TOKEN`. The "backup" workflow then files a dated export
   every night at 02:10 India time. The file holds buyers' details; never make
   that repository public.
3. **By hand, any time:** Audit, Backup now (a download).

**To restore:** ask Claude to restore from a given dated file (it runs
`wrangler d1 execute kaal-registry --remote --file=...` against a fresh
database and rebinds it). Do not restore over a working database without
asking: a restore replaces what is there.

Piece photographs and claim uploads live in Cloudflare KV, not the database;
the photographs are yours to keep a copy of.

## Rotating keys

Each is: change the value at its provider, change the GitHub secret of the
same name, run **setup-worker, mode deploy**, then revoke the old one.

| Secret | Where it comes from |
|---|---|
| CLOUDFLARE_API_TOKEN | dash.cloudflare.com, My Profile, API Tokens (Workers Scripts Edit, D1 Edit, KV Edit) |
| RESEND_API_KEY | resend.com, API Keys (Full access) |
| META_CAPI_TOKEN | Meta Events Manager, the dataset's Settings, Conversions API |
| SHIPROCKET_TOKEN | any 12+ character word; change it in Shiprocket's webhook too |
| ADMIN_EMAIL, OWNER_EMAIL | your inboxes |
| DESK_PASSCODE | the old desk's passcode |
| BACKUP_REPO, BACKUP_REPO_TOKEN | GitHub, as above |
| (on the worker only) RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, GITHUB_TOKEN, AUTH_SECRET | Razorpay dashboard; GitHub fine-grained token for this repository; AUTH_SECRET is made once by setup and never shown. Do not change AUTH_SECRET unless it leaked: it signs everyone out and makes every old tracking link stop opening |

## What each free tier allows, and when to upgrade

Written from the providers' pages at the time; check them yearly.

| Where | Free allows | Series 01's use | Upgrade when |
|---|---|---|---|
| Cloudflare Workers | 100,000 requests a day | a few thousand at the busiest | sustained traffic near the limit |
| Cloudflare D1 | 5 GB, 5 million rows read and 100,000 written a day | a few hundred rows in total | you pass many thousand orders |
| Cloudflare KV | 1,000 writes and 100,000 reads a day, 1 GB | holds, addresses, photographs, claim files | claim uploads or traffic pass the daily writes; the worker already keeps writes low |
| Resend | about 100 emails a day, 3,000 a month | about 7 per order, plus codes | a launch day with dozens of orders and sign-ins |
| GitHub Pages and Actions | free for a public repository | the site, the checks, the health ping | never, at this size |
| Razorpay | pay per transaction | | n/a |
