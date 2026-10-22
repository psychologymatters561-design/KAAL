# The registry on the live shop

One button puts the registry on the real shop: every order in a database,
the control room on your phone, checkout holds that cannot collide. One
setting takes it off again.

## What changes when it is on

| | Before | With the registry |
|---|---|---|
| A number held at checkout | 12 minutes, in KV, could collide in a rare race | 10 minutes, one database statement, cannot collide; the payment window closes 30 seconds before the hold ends |
| Two payments for one watch | Both buyers told "No. 07 is yours" | The second is refunded in full automatically, told why, and you are told |
| Someone you blocked | Could buy again | Refused at checkout, in neutral words |
| Your orders | The desk reads them from Razorpay | Each is a record you move through Inspected, Packed, Dispatched, Delivered at `/control`, and the buyer gets each stage's email (the brief's words) |
| Buyer emails at payment | "No. 07 is yours" | Unchanged for now (Phase 3 replaces it with "No. 07 is spoken for") |
| The desk (`/desk`) | | Still works, beside it |

What is not live yet: the registration email at delivery, the owner
dashboard and the public registry (Phases 4 and 5), `/track` and Shiprocket
(Phase 3), transfers and claims (Phase 6).

## Switch it on (about ten minutes, from a phone)

1. **Let the Cloudflare token edit D1.** dash.cloudflare.com → My Profile →
   API Tokens → the token in your `CLOUDFLARE_API_TOKEN` secret → Edit →
   add **Account · D1 · Edit** → Continue → Update. The token's value does
   not change.
2. **Optional GitHub secrets** (repository → Settings → Secrets and
   variables → Actions):
   - `ADMIN_EMAIL`: the one address that may open the control room.
     Without it, the first `OWNER_EMAIL`, else connect@thekaal.co.
   - `META_CAPI_TOKEN`: if you have it (docs/meta.md). This run sets it too.
3. **Run it.** Actions → **setup-worker** → Run workflow → mode **live**.
   It creates the database, applies the schema, makes the control room's
   key, deploys the worker (with the Meta token if set) and commits the
   database's id into `wrangler.toml`. It stops before changing anything
   if the token cannot edit D1.
4. **Sign in, now.** Open
   **https://kaal-edition.kaal-edition-hq.workers.dev/control** on your
   phone. Enter your email, then the code it sends. The first time, it asks
   you to add KAAL to an authenticator app (Google Authenticator,
   1Password, Authy): tap the link, then type the six digits. Do this
   straight away. Whoever first signs in with that address sets up the
   authenticator.
5. **Your orders come in.** Within half an hour of switching on, the
   worker brings in every paid order Razorpay holds, and emails nobody.
   Or tap **Bring in paid orders from Razorpay** on Overview. It carries
   over the dispatches you marked on the desk, with their tracking, and
   leaves No. 09 withheld. A second payment for one number is listed for
   you to check in Razorpay and is never refunded by the import.
6. **Nos. 01 and 02.** Overview lists the numbers sold before the
   registry. For each: Orders → **Record a past sale** → the buyer's name,
   email (it becomes their sign-in later), phone, city, the day paid and the
   day delivered. The delivery day starts its warranty and return window.
   Nobody is emailed.
7. **Carry on.** Move No. 07 and No. 10 on from where they are. Each tap
   gives ten seconds to Undo before the buyer's email goes.

## The off switch

`REGISTRY = "off"` in `wrangler.toml` (GitHub: open the file → pencil →
change the line → Commit), then **setup-worker → mode deploy**. The shop
runs exactly as it did before: KV holds, the desk, the same emails. Nothing
in the database is deleted, and `"on"` brings it all back.

For an instant switch without a deploy: Cloudflare dashboard → Workers &
Pages → kaal-edition → Settings → Variables → `REGISTRY` → `off` → Save.
Change `wrangler.toml` too, or the next deploy turns it back on.

## If something looks wrong

- **The control room says "off"**: step 3 has not run, or `REGISTRY` is off.
- **No sign-in email**: check spam; the sender is connect@thekaal.co. Three
  codes per address per quarter hour.
- **"Too many wrong codes"**: sign in again from the email step.
- **A lost phone (no authenticator)**: ask Claude to reset the admin's
  authenticator in the database; there is no reset button by design.
- **Everything else**: the Audit screen shows every change, by whom and when.
