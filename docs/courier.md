# The courier: Dispatched and Delivered by themselves

Shiprocket tells the worker each time a parcel moves. The worker then marks
the order **Dispatched** (and emails the buyer) when the courier has picked it
up, sends one short **out for delivery** note, and marks it **Delivered**
(the warranty and the return window start, and the registration link goes)
when the courier says it is delivered. Without this, those two stages are one
tap each in the control room, exactly as before. Nothing else depends on it.

The link is in `worker/courier.js`; its tests are in `tools/test-ops.mjs`.
It could not be tried against Shiprocket's own servers from where it was
written, so do the **first real parcel** with the steps at the end.

## Switch it on (about ten minutes)

1. **Make a secret word.** Any text of at least 12 characters, like
   `kaal-ship-9f3k-72hq`. It is the password Shiprocket will show to the
   worker; nobody else knows it.
2. **Give it to GitHub.** Repository, Settings, Secrets and variables,
   Actions, New repository secret. Name `SHIPROCKET_TOKEN`, value the word.
3. **Put it on the worker.** Actions, setup-worker, Run workflow, mode
   **deploy** (or **live**). The log says "SHIPROCKET_TOKEN set on the worker".
4. **Tell Shiprocket where to report.** In Shiprocket's panel, find the
   webhook setting (it is under Settings, API; search the panel for
   "webhook" if it has moved). Enter:
   - URL: `https://kaal-edition.kaal-edition-hq.workers.dev/ship/shiprocket`
   - Security token: the same word as in step 1. Shiprocket sends it back to
     us in a header called `x-api-key`, and the worker refuses anything that
     does not carry it.

## The one rule that makes it work

When you create the shipment in Shiprocket, give the **Order ID** as
`KAAL-07` (for No. 07), or `KAAL-S01-07`. That is how the worker knows which
watch a tracking event is about. If the Shiprocket order ID is anything else,
the worker looks for the tracking number (AWB) it already holds, and failing
that tells you by email, once: "A courier update could not be matched to an
order". Nothing is guessed, and nothing is changed, for an event it cannot
place.

## What each Shiprocket status does

| Shiprocket says | The worker does |
|---|---|
| Picked up, Shipped, In transit | Dispatched, with the courier, AWB and a tracking link, and the buyer's email. If the order had not been tapped Inspected and Packed, those are filled in silently first: the buyer is never told "boxed" after "on its way" |
| Out for delivery | One short email to the buyer, once |
| Delivered | Delivered, today's date, the return window, the registration email |
| RTO (returned to origin), Undelivered, Lost, Damaged, Cancelled | Nothing is changed. You are emailed once and the Overview shows it |
| Anything else (AWB assigned, pickup scheduled, and so on) | Ignored |

Each event is kept once by its tracking number, status and time, so
Shiprocket repeating itself never sends an email twice. Everything the courier
does is in the Audit screen, by "system:courier".

## First real parcel

1. Create the Shiprocket order with Order ID `KAAL-NN`.
2. When it is picked up, check the control room's Orders: the order should
   read Dispatched, with Shiprocket's tracking link, and the buyer should have
   the Dispatched email.
3. When it is delivered, check it reads Delivered and the owner has the
   registration email.
4. If a step did not happen, open Audit and Overview: an unmatched event is
   listed there with the tracking number, and the courier link can always be
   overridden by hand with one tap.
