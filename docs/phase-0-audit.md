# Phase 0 audit: the ownership, warranty and operations system

October 2026. Read-only audit of this repository against the build brief
("KAAL: Ownership, Warranty and Operations System"). Nothing in that brief
has been built yet. Per the brief, the build waits for approval of the
architecture below and for answers to the open questions at the end.

Done alongside it, because they were asked for directly and touch only the
live shop: the Meta purchase fix (`docs/meta.md`) and the security fixes in
section 5.

---

## 1. Hosting

| Piece | Where | How it deploys |
|---|---|---|
| thekaal.co | GitHub Pages, `main`, custom domain via `CNAME`, `.nojekyll` | A push to `main` is the deploy, about a minute. `check.yml` runs `tools/check.mjs` and `tools/test-worker.mjs` on every PR |
| The edition worker | Cloudflare Workers, `kaal-edition.kaal-edition-hq.workers.dev` | `setup-worker` workflow (Actions → Run workflow → `deploy`), or `wrangler deploy` |
| Worker storage | KV `KAAL_STATE` (holds, addresses, dispatches, dedupe marks, Series 02 list) and a SQLite Durable Object `Stats` (counts, live view, 90-day visitor histories) | Bound in `wrangler.toml` |
| DNS | GoDaddy (per `tools/setup-email.mjs`); thekaal.co points at GitHub Pages | By hand |
| Email | Resend, from connect@thekaal.co | `RESEND_API_KEY` worker secret |

GitHub Pages cannot send HTTP headers. That limits section 5.

## 2. The existing admin dashboard ("the desk")

- **Where:** `GET /desk` on the worker (`worker/desk.js`, routed in `worker/kaal-sold-sync.js` section 6). Not linked from the site, `noindex`.
- **Login:** one passcode (`DESK_PASSCODE` secret, 10+ characters). The comparison is constant-time. The session is an HMAC-signed cookie, 30 days, `HttpOnly; Secure; SameSite=Strict`, `Path=/desk`. Login is limited to 8 tries per 15 minutes per IP. Every write needs `X-Desk: 1` and a same-origin `Origin`. The page runs under a nonce CSP with `frame-ancestors 'none'`. There is no MFA and no per-device revocation: changing the passcode signs every device out.
- **Backend:** no database. Orders and payments are read live from the Razorpay API (last 120 days). Addresses (`ship:<order>`) and dispatches (`sent:<order>`) live in KV. Visitor data lives in the Durable Object.
- **"Notify as dispatched":** `POST /desk/dispatch {o, courier, tracking, url, notify}` checks the order is paid, writes `sent:<order>`, and if `notify` is set sends `buyerDispatched` (in `worker/mail.js`) through Resend. `{o, undo:true}` reverses it.
- The desk also covers refunds (sell again or retire), "stop" requests, CSV exports, the daily report, alerts and Health.

## 3. Razorpay

| Question | Answer |
|---|---|
| Orders created server-side? | **Yes.** `POST /order` prices from `PRICE_PAISE` (never the browser), refuses a sold or held number, and writes `kaal_no` onto the order's notes |
| Webhook on payment captured? | **Yes.** `payment.captured` (plus `refund.processed`) to the worker root |
| Signature verification? | **Yes, all three.** Webhook: HMAC-SHA256 of the raw body, before parsing. `/verify` and `/callback`: HMAC of `order_id\|payment_id`. All constant-time |
| Paid in full? | **Yes.** A payment below `PRICE_PAISE`, or in another currency, is never a sale |
| Which number? | Read from the order the worker wrote, never from the payer's notes |
| Idempotent? | **Yes**, per number (the commit says "already recorded") and per payment for emails (`mailed:`) and Meta (`meta:`) |
| Where orders live | Razorpay is the record. `index.html` `sold:` (committed by the worker) is the durable sold list. KV is the fast copy |
| Race on one number | A 12-minute KV hold at `/order`. KV is eventually consistent, so two buyers on two continents in the same second could both pass. There is no auto-refund of a second payment on one number |
| Reconciliation | Refunds: every 30 minutes. Meta: every 30 minutes (new). Payments are not reconciled against the sold list |

## 4. Design tokens (for the new pages)

- **Canvas:** `--void #080908`, `--void-2 #0E0F0D`, lines `--line #221F1C`
- **Ink:** `--bone #EDE8DF`, `--mute #B3AC9F`, `--faint #9D968A`, `--ghost #4A463F`
- **Accent, sparingly:** `--gold #C6A15B`, `--gold-lit #E0BE7C`
- **Dial worlds:** emerald `#08120C` / `#4E8A65`, midnight `#050505` / `#C6A15B`, stone `#12100E` / `#D8D0C2`, ember `#140C04` / `#D19B3F`
- **Type:** display Instrument Serif (self-hosted, with italic) with Fraunces (opsz) as a fallback; body Inter variable 300 to 600 with a separate ₹ subset. **There is no mono face yet.** The brief wants one for numerals; the cheapest choice that matches is Inter's tabular figures (`font-variant-numeric: tabular-nums`), with no new font file
- **Motion:** `--ease cubic-bezier(.16,1,.3,1)`, `--ease-soft cubic-bezier(.22,.61,.36,1)`, reveal on intersection, `prefers-reduced-motion` respected throughout, GSAP and three.js vendored locally
- **Layout:** `--gut clamp(1.25rem,5vw,4.5rem)`, `--hold min(72rem, 100% - 2 gutters)`, vertical rhythm `--air`, `--beat`
- **Components to reuse:** the twenty-cell number grid, dial discs, the engraved caseback plate (`assets/email/caseback-NN.png`), the receipt rows on `claimed.html`, the email layout in `worker/mail.js`

## 5. Risks

**Fixed in this change:**

| Risk | What could happen | Fix |
|---|---|---|
| Meta never heard of most sales | Ads optimised blind; the two campaign sales invisible | Conversions API path made robust, backfilled by cron, settable from a phone (`docs/meta.md`). **Needs `META_CAPI_TOKEN`** |
| Delivery address could be replaced by anyone holding the order id | The order id is in the thank-you URL, the buyer's email link and what the Pixel sees. A second address went to the owner as "use this address, not the earlier one" | The first address stands; a second gets `409 exists`; changes go by email |
| `/order` and `/hold` had no ceiling | One script could hold all twenty numbers indefinitely, shutting the shop during ads, and spam Razorpay orders | 12 per IP per 10 minutes (and `/shipping` 10, `/receipt` 60), in memory so no KV writes are spent |

**Still open (owner decisions or account access needed):**

| Risk | Severity | Suggested fix |
|---|---|---|
| No backups. Addresses live only in KV and the emails; KV is not exported | High once the registry exists | Nightly export to a private repo (part of the build) |
| The seller's legal name, GSTIN (if registered) and address are not displayed, as the Consumer Protection (E-Commerce) Rules 2020 require (README section 3) | Legal | Add to `legal.html`; needs the details |
| No security headers on thekaal.co (no HSTS, CSP or frame-ancestors), because GitHub Pages cannot send them | Medium | Put Cloudflare (free) in front of thekaal.co, moving DNS from GoDaddy, and set the headers there. A `<meta>` CSP with `unsafe-inline` would add little on pages with no user content, and a wrong one breaks Razorpay's 3-D Secure redirects and the Pixel; not shipped untested |
| The desk has one passcode and no MFA | Medium | TOTP in the new `/control` (the brief asks for it) |
| The worker's GitHub token can write to this repository | Medium | Confirm it is fine-grained, this repo only, Contents only; turn on branch protection for `main` except for the worker |
| KV free plan: 1,000 writes a day | Low now, real with traffic | The new system moves state to SQLite (D1 or Durable Objects) |
| "Enforce HTTPS" on GitHub Pages | Unverified from here | Settings → Pages → tick it |
| Actions pinned by tag (`@v5`), not by commit | Low | Pin `setup-worker.yml` (it holds secrets) to SHAs |

**Checked and clean:** webhook, `/verify` and `/callback` signatures; price and number never taken from the browser; no secrets anywhere in git history (scanned for Razorpay, GitHub, Resend and Meta key shapes); the storefront writes no HTML from data (`textContent` throughout); desk output escaped and under a nonce CSP; CSV formula injection escaped; workflow inputs passed through `env`, never interpolated into scripts; secrets never printed by the setup tool.

## 6. Recommendation: build it on the Cloudflare stack already running, not Supabase

The brief's default is Supabase. The repo already runs a tested Cloudflare
Worker that owns the money path, the emails, the desk and the cron. I
recommend extending that rather than adding a second backend.

| | Supabase (brief default) | Cloudflare D1 + R2 + Durable Objects (recommended) |
|---|---|---|
| Vendors and deploy paths | Adds a second platform beside the Worker that already takes the money | One. Same `setup-worker` button |
| Free tier pausing | Pauses after a week idle; the brief needs a keep-alive Action for this | Never pauses |
| Database | Postgres with RLS | D1 (SQLite), 5M reads and 100k writes a day free. No RLS: every read goes through the Worker, which is the only thing holding the key. The browser never queries the database |
| The one-number race | A row lock | A Durable Object per series serialises holds by construction; no window at all |
| Auth | Built in: passcode hashing, reset emails, TOTP | Built by us: PBKDF2 passcode hashes (WebCrypto), signed sessions like the desk's, reset emails through the existing Resend path, TOTP (RFC 6238). About 300 lines, all tested, and the riskiest part of the build |
| Storage | Supabase Storage | R2 (10 GB free), private bucket for claims |
| Backups | `pg_dump` Action | D1 Time Travel plus a nightly `wrangler d1 export` Action to a private repo |
| Migration risk | The live checkout either moves or splits across two systems | None: the checkout stays exactly as tested |

The honest cost of the recommendation is auth: Supabase hands it over
ready-made, and here it has to be written. If you would rather not own
that code, the middle path is Cloudflare for everything plus **email
one-time codes instead of passcodes** (no passwords stored, no reset
flow), which also suits a phone-first owner. That changes the brief's
"email + passcode" wording, so it needs your yes.

## Decided (22 October)

- **Backend:** Cloudflare (D1, R2, Durable Objects), extending the existing worker.
- **Owner sign-in:** a code emailed each time; no passwords stored. Admin adds TOTP.
- **No. 09:** the owner's own test order. Kept off sale (`withheld`) until the owner releases it; never shown as sold in the registry.
- **Courier:** Shiprocket (webhooks make Dispatched and Delivered automatic in Phase 3).

Phase 1 is built: `docs/staging.md`.

## 7. Where the brief and the repo disagree (decisions needed)

1. **What has sold.** The brief says No. 01 and 02. The site says 01, 02, 07, 09 and 10. No. 09 was bought on 2 October and `docs/payments.md` reads like a test by you. Is 09 a real sale, or should it be refunded and released?
2. **Colour names.** The brief says green, black, golden, white. The site says Emerald, Midnight, Champagne, Ivory (same blocks). The recommendation is to keep the site's names everywhere.
3. **"Kaal means time, and only time."** `about.html` and `manifesto.html` say it means "time, and the end of it". That breaks the brief's rule. The copy is yours to change.
4. **Em dashes.** 56 remain in visible copy: about 11, manifesto 20, movement 17, provenance 8 (legal's one is fixed). The brief bans them. Rewriting existing pages is a copy decision; say the word and they go.
5. **Contact.** The brief gives connect@thekaal.co only. `claimed.html` also offers "call or WhatsApp +91 93114 16678". Keep it or remove it?
6. **Courier.** Which courier or aggregator ships the watches? Shiprocket and Delhivery both have webhooks, which make Dispatched and Delivered automatic.
7. **Delivery dates** for Nos. 01 and 02 (and 07, 09, 10) to backfill the registry.
8. **Rain** in the warranty terms: covered or not?

Nothing in sections 6 and 7 will be built until these are answered.
