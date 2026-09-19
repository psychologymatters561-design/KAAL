# The launch runbook

Everything in `SECURITY.md` part two, turned into clicks. Nothing here needs a
developer. Do it in this order — each step assumes the one before it.

**Total: about ninety minutes, once.** Steps 1 to 3 are the ones that matter
most and take twenty of them. Do not run an ad before step 7.

After every step there is a `verify` line. Run it. A control you have not
verified is a control you are hoping for.

```
git clone https://github.com/psychologymatters561-design/KAAL.git && cd KAAL
node tools/verify-live.mjs          # the whole checklist, from outside
```

---

## 1 · Lock the four accounts · 20 minutes · do this first

In this order, because the list is in order of what an attacker would take.

**1.1 The domain registrar.** Whoever controls DNS for `thekaal.co` needs
nothing else on this list: they point the name at a copy of your site, get a
certificate in about a minute — domain control *is* the proof a certificate
authority asks for — and take payments as you until somebody tells you.
Every other control on this page is downstream of this one account.

- 2FA on, with an authenticator app or a hardware key, **not SMS**. A SIM swap
  is a phone call to a call centre, and it is the standard way domains are
  stolen in India.
- Turn on the registrar's **domain lock** / transfer lock.
- Check the account email is one *you* control and that it also has 2FA.

**1.2 Razorpay.** 2FA on. Check the list of users with dashboard access and
remove anyone who does not need it. Anyone who can create a payment link can
create a payment that talks to your webhook.

**1.3 GitHub.** 2FA on, passkey if offered. Print the recovery codes and put
them somewhere that is not the laptop.

**1.4 Cloudflare.** 2FA on.

> **Recovery codes for all four, printed, off-machine.** The day you need them
> is the day you cannot log in to get them.

`verify` — log out of each one and log back in. If any let you in without a
second factor, it is not on.

---

## 2 · GitHub repository settings · 10 minutes

**Settings → Code security**
- **Secret scanning: on.**
- **Push protection: on.** This is the one that catches the mistake nobody
  plans to make — it refuses the push that contains a token, before it exists
  in history. A secret in git history is not deletable in any way you will
  trust afterwards.

**Settings → Branches → Add branch ruleset**, targeting `main`:
- ✅ Require status checks to pass → select **check**
- ✅ Block force pushes
- ❌ **Do NOT tick "Require a pull request before merging."**

That last line is not laziness. The worker commits straight to `main` when a
sale lands; requiring a PR breaks every sale. This is the honest cost of the
current design, and `tools/check-autocommit.mjs` is what buys the safety back:
any commit wearing the worker's name that touches more than the one `sold:`
line fails CI within a minute. If you want full PR protection later, `sold`
has to move out of `index.html` and live in KV — worth doing before Series 02,
not before launch.

**Settings → Pages**
- ✅ **Enforce HTTPS**
- Confirm the custom domain shows as **verified**. An unverified custom domain
  can be claimed by somebody else if the `CNAME` ever dangles.

**Settings → Actions → General**
- Workflow permissions: **Read repository contents**. Nothing here needs write.

`verify` — push a commit to a branch and watch `check` run. Then:
`node tools/verify-live.mjs` → *"site answers over https"* passes.

---

## 3 · Razorpay · 15 minutes · the money

**3.1 The Payment Page.**
- Amount: **fixed** at ₹5,999. Not "customer decides". A page where the buyer
  types the amount hands them the inventory switch — the worker's amount check
  is what stops that, and a fixed amount is what makes it simple.
- **Stock limit: 20.** This is the only thing that stops the 21st sale.
- One custom field, named **exactly** `kaal_no`, **required**.
- Success URL: `https://thekaal.co/claimed.html`

**3.2 The webhook.** Dashboard → Settings → Webhooks → Add:
- URL: your deployed worker's root (step 4)
- Events: **`payment.captured`**, **`refund.processed`**, **`payment.dispute.created`**

  The last two are not optional. Without them: somebody buys number 07, it is
  marked sold, they charge back, the money goes home and **07 stays dead
  forever** because nothing un-sells it and nobody is told.
- Secret: generate a long random one. **Razorpay shows it once.** Save it
  straight into your password manager. Anyone holding it can mark this whole
  edition sold out.

**3.3 Put the checkout URL on the site.** In `index.html`, `KAAL.checkout`.
It must be `https` on `razorpay.com` or `rzp.io` — the page refuses anything
else and CI refuses to deploy it.

`verify` — `node tools/check.mjs` passes, and after the deploy
`node tools/verify-live.mjs` shows *"live checkout is https on an allowed host"*.

---

## 4 · The worker · 20 minutes

```bash
npm i -g wrangler
wrangler login

# The store. Holds the sold list, the holds, replay protection and alerts.
wrangler kv namespace create KAAL_STATE
# Paste the printed id into wrangler.toml and uncomment the block.

wrangler secret put RAZORPAY_WEBHOOK_SECRET   # from step 3.2
wrangler secret put GITHUB_TOKEN              # see below
wrangler secret put ALERT_TOKEN               # openssl rand -hex 32

wrangler deploy
wrangler tail                                 # leave this open for step 7
```

**The GitHub token** — github.com/settings/tokens → **Fine-grained**:
- Repository access: **Only select repositories** → `KAAL`. Nothing else.
- Permissions: **Contents: Read and write**. Nothing else.
- **Never Workflows: write.** That is the difference between *can edit one
  line of one file* and *can run any code as you.*
- **Expiry: 90 days.** Put the renewal in your calendar now, while you are
  thinking about it.

**Then close the back door.** In `wrangler.toml`, uncomment and set:

```toml
workers_dev = false
routes = [{ pattern = "api.thekaal.co/*", zone_name = "thekaal.co" }]
```

A `*.workers.dev` URL is a second front door that no firewall rule of yours
ever sees. Redeploy after changing it.

`verify` —
`node tools/verify-live.mjs --worker https://api.thekaal.co --workers-dev https://kaal-edition.<you>.workers.dev`
Every worker line should read `ok`, including *"workers.dev URL is closed"*.

---

## 5 · Cloudflare in front of the site · 20 minutes · buys five controls at once

GitHub Pages cannot send a response header. The pages carry a `<meta>` CSP
and a script frame guard instead, which covers most of it — but `frame-ancestors`
is ignored from a meta tag, and HSTS does not exist as one. A CDN in front
fixes both and brings a firewall with it.

**5.1** Add `thekaal.co` to Cloudflare, move the nameservers at the registrar,
keep the existing DNS records. **Proxy status: proxied (orange cloud).**

**5.2 SSL/TLS → Overview: Full (strict).** Then **Edge Certificates**:
- Always Use HTTPS: **on**
- Minimum TLS Version: **1.2**
- Automatic HTTPS Rewrites: **on**

**5.3 Rules → Transform Rules → Modify Response Header → Create**, "all
incoming requests", set these static headers:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` |

And the policy the meta tag already carries, **plus** the one it cannot:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'none'; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://res.cloudinary.com; media-src 'self' https://res.cloudinary.com; font-src 'self'; connect-src 'self' https://api.thekaal.co; upgrade-insecure-requests` |

> Two traps. **One:** a browser enforces the *intersection* of the header and
> the meta tag, directive by directive. Keep them identical apart from
> `frame-ancestors`, and change both together — `verify-live` warns when they
> drift. **Two:** do **not** add `preload` to the HSTS value yet. Preloading is
> a one-way door: every subdomain of `thekaal.co` must be https forever, and
> removal takes months. Run it for a few weeks first, then decide.

**5.4 Security → WAF → Rate limiting rules.** On `api.thekaal.co/*`:
**30 requests per minute per IP**, action Block, duration 10 seconds.
`/state` and `/hold` are public and unauthenticated by design; the caps inside
the worker bound the damage, this is what stops it.

**5.5 Security → Bots → Bot Fight Mode: on.**

`verify` — `STRICT_HEADERS=1 node tools/verify-live.mjs --worker https://api.thekaal.co`
All five header lines flip from `warn` to `ok`. Then set the repository
variable `STRICT_HEADERS=1` so the daily watch holds you to it.

---

## 6 · DNS · 10 minutes

**Checked live while writing this** — as of 19 September 2026, `thekaal.co`
already publishes:

- SPF: `v=spf1 include:secureserver.net -all` ✅
- DMARC: `p=quarantine` ✅

So the expensive part is done. Two things remain:

**6.1 Add a CAA record.** It names which certificate authorities may issue for
your domain, and refuses the rest:

```
thekaal.co.  CAA  0 issue "letsencrypt.org"
thekaal.co.  CAA  0 issue "pki.goog"
thekaal.co.  CAA  0 issue "digicert.com"        # Cloudflare's CA
thekaal.co.  CAA  0 iodef "mailto:connect@thekaal.co"
```

Add every CA you actually use *before* you add the record, or certificate
renewal fails. GitHub Pages uses Let's Encrypt; Cloudflare uses Google Trust
Services and DigiCert.

**6.2 Confirm DKIM** is set up for whatever sends `connect@thekaal.co`.
DMARC at `p=quarantine` is only doing its job if SPF *or* DKIM aligns. Send a
mail to a Gmail address, open **Show original**, and read the three lines:
SPF, DKIM, DMARC. All three should say `PASS`.

**6.3 Once you have watched DMARC reports for a fortnight, move to `p=reject`.**

`verify` — `node tools/verify-live.mjs` → the CAA, SPF and DMARC lines all read `ok`.

---

## 7 · The two test payments · 10 minutes · before any ad spend

With `wrangler tail` open.

**7.1 The rejection test.** Make a **₹1** payment — any payment route on the
account — with `kaal_no` set to a number that is *not* sold.

**It must be refused.** You should see in the tail:

```
ALERT amount-mismatch pay_XXXX got 100 INR want 599900
```

and **no commit** in the repository. If a commit appears, stop: `AMOUNT_CHECK`
is off, or the price on the page does not match the Payment Page, and the whole
edition is buyable for twenty rupees.

**7.2 The real one.** A full **₹5,999** payment naming a number you are willing
to sell. Watch, in order:

1. `Number N marked sold. GitHub Pages will rebuild shortly.` in the tail
2. a commit on `main`: *Auto: mark number N sold (payment pay_…)*
3. the `check` workflow going green — including **"A worker commit may only
   ever sell one number"**
4. the live site striking that number through, within a minute or two
5. `claimed.html` greeting the buyer by number and showing the reference

Then **refund it** and confirm that `ALERT refund.processed` appears in
`/alerts` and that the number **stays sold**. That is correct behaviour: a
machine that can mark a number available again can be made to resell a watch
that has already shipped. Un-sell it by hand, in a commit, having decided to.

---

## 8 · Every day the edition is live · 2 minutes

1. **Read `/alerts`.** Bookmark `https://api.thekaal.co/alerts?token=…`.
   Anything in it is a person waiting on you:

   | Alert | What happened | What you do |
   |---|---|---|
   | `double-sale` | Two people paid for one watch | Refund the later one **today**, and write to them yourself. `legal.html` promises this. |
   | `amount-mismatch` | A captured payment named a number but did not pay the price | Check whether it is a customer who used a discount, or somebody probing. Nothing was marked sold. |
   | `refund.processed` | Money went back | Decide by hand whether the number returns to stock. |
   | `payment.dispute.created` | A chargeback | Respond inside Razorpay's window or you lose it by default. |

2. **The daily `watch` workflow** emails you if a live control regressed. If it
   is silent, the internet still agrees with `SECURITY.md`.

**Weekly:** `node tools/verify-live.mjs` yourself. **Every 90 days:** rotate
`GITHUB_TOKEN`.

---

## 9 · When it goes wrong

**The GitHub token is compromised** — or CI says *"A commit is wearing the
worker's name and is not shaped like its work."*

1. github.com/settings/tokens → **delete the token.** First. Before reading
   anything. It takes four seconds and it ends the incident.
2. Read the commit. `git log -p main` — assume anything since the last commit
   you recognise is theirs.
3. Revert what you did not write: `git revert <sha>`, push.
4. Check `KAAL.checkout` on the live site with your own eyes.
5. Issue a new fine-grained token, `wrangler secret put GITHUB_TOKEN`, redeploy.
6. `node tools/verify-live.mjs`.

**The Razorpay webhook secret leaked.** Rotate it in the dashboard, then
`wrangler secret put RAZORPAY_WEBHOOK_SECRET`, then redeploy. Between rotation
and redeploy, real sales are not recorded — watch `/alerts` and reconcile
against the Razorpay dashboard afterwards.

**The site is showing something you did not write.** GitHub Pages serves `main`.
`git log` tells you who and when. Revert, push, then find the credential that
allowed it — a push to `main` means GitHub account access or a repository token,
and one of those needs revoking before anything else.

**Somebody reports a vulnerability.** `connect@thekaal.co`, per
`.well-known/security.txt`. Reply the same day even if the answer is "looking
at it". Researchers publish when ignored.

---

## What "indestructible" actually means here

It is not a state you reach. It is a small number of things that keep being
true, and something that notices when one of them stops:

| | Watched by | How often |
|---|---|---|
| The repository's own rules | `tools/check.mjs` | every push |
| A stolen token's blast radius | `tools/check-autocommit.mjs` | every push |
| The live site and worker | `tools/verify-live.mjs` via `watch.yml` | every day |
| Money moving in ways it should not | the worker's `/alerts` | every day, by you |
| The four accounts | nothing automatic — **only you** | 2FA, and the 90-day rotation |

The last row is the one that has no machine behind it, and it is the row that
decides the other four.
