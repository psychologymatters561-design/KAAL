# The runbook

One page for the person who runs KAAL. Every screen, every button, and what to
do when something looks wrong. Nothing here needs a computer.

## Where things are

| | Address |
|---|---|
| The shop | thekaal.co |
| **The control room** (you only) | kaal-edition.kaal-edition-hq.workers.dev/control |
| Owners sign in and see their piece | thekaal.co/owners |
| Anyone follows an order | thekaal.co/track (the link is in every tracking email) |
| The public registry | thekaal.co/registry |
| The old desk, still there | kaal-edition.kaal-edition-hq.workers.dev/desk |

You sign in with an emailed six digit code. There is no password and no app.
Because the code is the only lock, keep Google's own 2-step verification on
that mailbox.

Your own address can also own a piece (No. 01). The two doors stay apart:
signing in at /control opens only the control room, and signing in at
thekaal.co/owners opens only your piece's dossier. A sign-in at one never
opens the other, so sign in at each separately.

## Each screen of the control room

**Overview.** Pieces sold out of twenty as a strip, revenue, how many orders
wait at each stage, the unregistered deliveries with the days left in their
return window, what is waiting for you, failed emails, and Health. A red
"late" card means an order is breaking the five day promise (placed 48 hours
without Inspected, not Dispatched by day 4, Dispatched 7 days without
Delivered); you are also emailed once for each.

**Orders.** One card per order with its stage. One tap per stage:
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

**Pieces.** The twenty, with the photograph of each exact watch (upload),
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
