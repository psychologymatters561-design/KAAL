---
description: Pre-launch / release check for a static site on GitHub Pages plus one Cloudflare Worker.
argument-hint: [optional — "full" for the whole launch gate, default is the delta since main]
allowed-tools: Bash, Read, Grep, Glob
---

Read `.claude/house-rules.md` first.

Mode: **$ARGUMENTS** (empty = check only what changed against `main`).

There is no CI, no container, no cluster, and no staging. The deploy is: push
to `main` → GitHub Pages rebuilds → `thekaal.co` serves it. The only moving
part beyond that is the Worker, deployed separately (there is no
`wrangler.toml` in this repo — the Worker is configured wherever it was
deployed from, so never claim its live config from this checkout).

That makes the pre-push check the entire safety system. Treat it that way.

## The gate

**Correctness of the artefact**
- HTML parses; no unclosed tag, no duplicated `id`, no stray `</script>`.
- Every internal link and asset path resolves on disk, case-sensitively —
  Pages is case-sensitive, your laptop may not be.
- `.nojekyll` and `CNAME` still present and unmodified. Losing either takes
  the domain or the `assets/` directory down.
- No absolute `file://` or `localhost` reference survived into the page.

**Commercial sanity** (flag, never fix silently)
- `KAAL.checkout` — empty means the page cannot take money. Is that intended
  for this push?
- `price` consistent everywhere it renders; `sold` plausible against
  `edition`; `dials` covers 1..`edition`.

**Degradation**
- Load with JS disabled, with `?film=0`, and with the Cloudinary host blocked
  (`/etc/hosts` or Playwright route-abort). Each must serve a complete page.
  This is the one check that catches the failure that actually costs sales.

**Weight and speed** — total bytes of the first screen, font payload, whether
anything new blocks first paint. Compare to the previous commit, not to an
abstract budget.

**Metadata** — title, description, canonical, OG image and its dimensions,
favicon, `lang`, viewport. Open `docs/og-card.html` if the card changed.

**Worker** — if `worker/` changed: does the handler still verify the signature
before any side effect, and is the GitHub write still scoped to the one file?
Deployment is manual; say explicitly that the change is *not live* until
someone deploys it.

**Git hygiene** — no secret, token, webhook secret, or private URL in the
diff. Run a scan, do not eyeball it.

## Deliver

A checklist with pass / fail / not-checkable-here per line, the failures with
file:line, and one sentence at the end: **ship or do not ship**. Take the
position. "Looks fine overall" is not an answer anyone can act on.

Do not propose CI, Docker, Kubernetes, or a pipeline unless the invocation
asked for it. A twenty-watch drop does not need a control plane.
