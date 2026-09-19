# Architecture

What is here, why it is shaped this way, and — because it is the more
useful half — what was deliberately **not** done.

---

## The shape

```
thekaal.co/
├── index.html                  the storefront. One file, on purpose.
├── manifesto.html              ┐
├── legal.html                  ├ satellites
├── claimed.html                ┘
│
├── worker/                     the edition state service (Cloudflare)
│   ├── index.js                composition root: routes + handlers
│   └── lib/
│       ├── edition.js          THE RULES. Pure. No I/O, no globals, no clock.
│       ├── crypto.js           is this really Razorpay
│       ├── store.js            Workers KV, behind names, optional by design
│       ├── github.js           the contents API, in two functions
│       └── http.js             CORS, security headers, bounded bodies
│
├── tools/
│   ├── check.mjs               runner: discovers and runs the checks
│   ├── checks/
│   │   ├── context.mjs         every file and every parsed value, read once
│   │   ├── 10-deploy.mjs       ┐
│   │   ├── 20-config.mjs       │
│   │   ├── 30-security.mjs     │  one concern each, discovered by being
│   │   ├── 35-shared-blocks.mjs│  here, run in filename order
│   │   ├── 40-markup.mjs       │
│   │   ├── 50-structured-data.mjs
│   │   ├── 60-crawl.mjs        │
│   │   ├── 70-secrets.mjs      │
│   │   └── 80-weight.mjs       ┘
│   ├── check-autocommit.mjs    what a stolen worker token is allowed to do
│   ├── verify-live.mjs         the live site and worker, from outside
│   ├── sync-shared.mjs         propagate the shared security blocks
│   └── test/
│       ├── harness.mjs         a Worker, run on your laptop. ~80 lines.
│       ├── edition.test.mjs    the rules, by calling them
│       └── worker.test.mjs     the whole worker, through fetch()
│
├── .github/workflows/
│   ├── check.yml               every push and PR
│   └── watch.yml               the live site, every morning
│
├── assets/                     fonts, images, brand marks
├── docs/LAUNCH-RUNBOOK.md      the dashboard half, as clicks
└── SECURITY.md                 the review, the severities, the attacks
```

---

## The layers, where they exist

Clean architecture is one idea wearing a lot of diagrams: **things that
change for different reasons should not be in the same file, and the
direction of dependency should point at the thing that changes least.**

In this repository that idea applies to exactly one component — the
worker — because it is the only one with more than one reason to change.

```
                    worker/index.js
              routes · handlers · the order of decisions
                            │
        ┌───────────┬───────┴───────┬───────────┐
        ▼           ▼               ▼           ▼
    lib/http     lib/store      lib/github   lib/crypto      ← adapters
    the edge     Workers KV     one file     HMAC
        └───────────┴───────┬───────┴───────────┘
                            ▼
                      lib/edition.js                          ← the rules
        what a valid sale is. Pure. Knows about nothing.
```

**Dependencies point inward and stop.** `lib/edition.js` imports nothing.
It cannot reach a network, a clock or a global, which is why you can ask
it *"does one rupee buy a watch"* in a single line with no mocking
library, no fake KV and no fake GitHub:

```js
verifyAmount({ amount: 100, currency: "INR" }, pageSource, {}).ok   // false
```

That line is the whole argument for the layer. The equivalent question
asked through the worker needs a fake KV, a fake contents API and a
signed body — worth having, and `worker.test.mjs` has it, but it is not
where you want to be iterating on a pricing rule.

**`index.js` is allowed to know everything, and allowed to do nothing.**
It decides; it does not implement. The rule that keeps it honest: the
moment a handler builds a header by hand, decodes base64, or writes a KV
key with a prefix in it, the layer below has a gap and the fix belongs
down there.

---

## What each boundary actually bought

| Boundary | The problem it removes |
|---|---|
| `lib/edition.js` | Pricing and edition rules were interleaved with GitHub retry logic inside one 80-line function. Now 19 tests call them directly. |
| `lib/store.js` | `if (env.KAAL_STATE)` appeared in **six** places, because KV is optional by design. The seventh was going to be forgotten. An absent store now returns a null object answering "no opinion" to everything, and no caller asks again. |
| `lib/store.js` | Every KV **write** is a cost against a 1,000/day free tier on a public endpoint. Counting them requires one place that does them. |
| `lib/http.js` | Every response leaves through `json()` or `text()`, so no response can be the one that forgot `nosniff` or answered `Access-Control-Allow-Origin: *`. |
| `lib/github.js` | base64, shas and *"409 means somebody committed first"* now exist in one file that has never heard of a watch. |
| `lib/crypto.js` | The constant-time compare is the single easiest thing here to "simplify" into a vulnerability. It is alone, in a file, with the reason written above it. |
| `tools/checks/*` | A 300-line script where every section could see — and quietly depend on — the variables the sections above it left lying around. Adding a check is now writing a file. |

---

## Proving behaviour did not move

A refactor you cannot prove is a rewrite you are hoping about.

**33 characterisation tests were written against the single-file worker
first**, then the file was taken apart, and the same 33 passed against
the six modules that replaced it. Not adapted — the same file, unedited.
19 more were added afterwards against the pure rules, which had not been
directly reachable before.

```
node --test "tools/test/*.test.mjs"      52 pass
node tools/check.mjs                     9 checks, all pass
node tools/sync-shared.mjs --check       every page matches
```

The eleven CI gates were each re-run by deliberately breaking the thing
they guard — an evil checkout host, a stripped CSP, a removed frame
guard, a drifted block, a secret in `wrangler.toml` — and each still
fires with the same message it did before the split.

**No product behaviour changed.** No commercial value was touched:
`checkout`, `price`, `edition`, `sold`, `dials` and every line of body
copy are byte-identical.

---

## What was deliberately not done

A senior review is mostly this list. Every item below is a standard move
that would have made this codebase worse.

### 1 · `index.html` was not split

It is 2,262 lines: markup, inline CSS, one inline IIFE. Every instinct
says break it up. The instinct is wrong here, for a reason that is
specific rather than stylistic:

**There is no build step to reassemble it.** Splitting means either a
bundler — which this repo has refused, and which turns a `git push`
deploy into a pipeline with a cache and a lockfile and a way to be
broken at 2am — or real extra requests on the critical path of the one
page whose job is to sell a ₹5,999 watch to cold traffic. The CSS is
render-blocking by definition; the JS drives the hero.

The honest trade: **one file costs you navigability, and buys you one
request, no hydration, nothing to version-skew, and no failure mode
where the page arrives without its behaviour.** For a page this size,
maintained by this many people, that trade is correct. It would stop
being correct at two pages sharing components, or at a second engineer.

What was done instead: the *logic that could be wrong about money*
already left this file — the page validates its own checkout URL
(`checkoutOk`), and everything else it believes about the edition comes
from `/state`, which is tested.

### 2 · The satellites' CSS was not merged into a shared stylesheet

Same reason, and one more: their `:root` blocks are genuinely different
— each page carries the tokens it actually uses. Forcing them to match
would be enforcing sameness, not correctness.

The **security** blocks are a different matter: the CSP, the referrer
policy and the frame guard must be identical, and drift there is a real
vulnerability rather than a style inconsistency. So where you cannot be
DRY by reference, **be DRY by assertion**: `tools/sync-shared.mjs`
propagates from `index.html`, `35-shared-blocks.mjs` fails the build
when they diverge. One source of truth, enforced by a test rather than
by an import.

### 3 · No framework, no TypeScript, no npm

`npm i` was never on the table. The dependency count is zero and the
supply-chain surface of this repository is therefore also zero — which,
for a site that takes money, is worth more than every ergonomic gain on
offer. Types would catch real bugs in `worker/lib/`; they would also
introduce a build step, and the tests already catch the class of bug
that matters here.

### 4 · The worker was not rebuilt around Durable Objects

KV is eventually consistent, which is a real limitation and the right
one to accept at twenty units. The migration is written down in
`worker/index.js` and it is a change to `lib/store.js` **and nothing
else** — which is most of the reason `lib/store.js` exists. Do it when
the cadence arrives, not before.

### 5 · `sold` was not moved out of `index.html`

This is the one real architectural debt, and it is named rather than
quietly fixed, because fixing it changes product behaviour.

Today the page ships with a `sold` array, the worker rewrites that line
on a sale, and GitHub Pages redeploys. The cost: an internet-facing
service holds a token that writes the repository, which is why
`main` cannot require pull requests without breaking every sale.

The fix is to make KV authoritative and have the page read `/state` as
the source rather than as a correction. That costs a network round trip
before the grid is honest — a real regression for a page that currently
tells the truth with zero requests — so it is a decision for Series 02,
with a plan, not a refactor to slip into a security PR.

**In the meantime the blast radius is bounded rather than trusted:**
`tools/check-autocommit.mjs` fails CI within a minute if a commit
wearing the worker's name touches anything but that one line.

---

## Adding to this

- **A new page check** — drop a file in `tools/checks/`, named `NN-thing.mjs`,
  exporting a default function that takes the context and calls `bad()` or
  `soft()`. Nothing to register.
- **A new worker route** — a handler in `worker/index.js`. If it needs to
  store something, add a named method to `lib/store.js`; do not reach for
  `env.KAAL_STATE`.
- **A new rule about what a valid sale is** — `lib/edition.js`, with a test
  in `tools/test/edition.test.mjs` next to it. If the rule needs a network
  or a clock, it is not a rule, it is a handler.
- **Anything touching money** — write the failing test first. Every test in
  `worker.test.mjs` exists because the behaviour it describes is something
  you only get to be wrong about once.
