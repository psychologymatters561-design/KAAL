#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════
# One-time deploy of the KAAL edition worker (worker/kaal-sold-sync.js).
# Run this from the repo root: bash tools/deploy-worker.sh
#
# What it does, in order:
#   1. Confirms wrangler is available and you're logged into Cloudflare.
#   2. Creates the KAAL_STATE KV namespace (skips if wrangler.toml
#      already has one bound) and writes its id into wrangler.toml.
#   3. Prompts you for each secret and sets it with `wrangler secret put`
#      — nothing you type here is echoed, logged, or written to disk.
#   4. Deploys the worker and prints the live URL.
#   5. Prints the exact values to paste into the Razorpay dashboard.
#
# What it never does: touch index.html, or see/store any secret value
# beyond handing it straight to `wrangler secret put`.
# ══════════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")/.."

WRANGLER="wrangler"
if ! command -v wrangler >/dev/null 2>&1; then
  echo "wrangler not found on PATH — using npx (no global install needed)."
  WRANGLER="npx --yes wrangler"
fi

echo "── 1. Cloudflare login ──────────────────────────────────────────"
if ! $WRANGLER whoami >/dev/null 2>&1; then
  echo "Not logged in. Opening browser login…"
  $WRANGLER login
fi
$WRANGLER whoami

echo
echo "── 2. KV namespace (KAAL_STATE) ─────────────────────────────────"
if grep -q '^\[\[kv_namespaces\]\]' wrangler.toml && grep -q '^binding = "KAAL_STATE"' wrangler.toml; then
  echo "wrangler.toml already binds KAAL_STATE — skipping creation."
else
  echo "Creating the KV namespace…"
  OUT="$($WRANGLER kv namespace create KAAL_STATE)"
  echo "$OUT"
  KV_ID="$(echo "$OUT" | grep -oE 'id = "[a-f0-9]+"' | head -1 | grep -oE '[a-f0-9]{32}')"
  if [ -z "${KV_ID:-}" ]; then
    echo "Could not parse the namespace id from wrangler's output above."
    echo "Paste it into wrangler.toml yourself under [[kv_namespaces]] and re-run this script."
    exit 1
  fi
  {
    echo ""
    echo "[[kv_namespaces]]"
    echo "binding = \"KAAL_STATE\""
    echo "id      = \"$KV_ID\""
  } >> wrangler.toml
  echo "Wrote KAAL_STATE (id $KV_ID) into wrangler.toml."
fi

echo
echo "── 3. Secrets ────────────────────────────────────────────────────"
echo "Each prompt below is wrangler's own — typed values are not echoed."
echo

echo "RAZORPAY_KEY_ID (from Razorpay Dashboard → Settings → API Keys):"
$WRANGLER secret put RAZORPAY_KEY_ID

echo
echo "RAZORPAY_KEY_SECRET (same screen — shown once at generation):"
$WRANGLER secret put RAZORPAY_KEY_SECRET

echo
echo "RAZORPAY_WEBHOOK_SECRET — you set this value yourself when you create"
echo "the webhook in step 5 below. Pick any strong random string now and"
echo "reuse the SAME string in the Razorpay dashboard in a moment:"
$WRANGLER secret put RAZORPAY_WEBHOOK_SECRET

echo
echo "GITHUB_TOKEN — a fine-grained PAT scoped ONLY to this repo"
echo "(psychologymatters561-design/KAAL), permission Contents: Read and write,"
echo "nothing else. Create one at:"
echo "  https://github.com/settings/personal-access-tokens/new"
$WRANGLER secret put GITHUB_TOKEN

echo
echo "── 4. Deploy ─────────────────────────────────────────────────────"
$WRANGLER deploy

echo
echo "── 5. Finish this in the Razorpay dashboard ─────────────────────"
echo "Dashboard → Webhooks → Add New Webhook:"
echo "  Webhook URL   = the worker URL wrangler printed just above"
echo "  Active events = payment.captured"
echo "  Secret        = the exact string you gave RAZORPAY_WEBHOOK_SECRET"
echo
echo "On the Payment Page you use for checkout, add a custom field named"
echo "EXACTLY: kaal_no   — that field is the only link between a payment"
echo "and which number it sold."
echo
echo "Send Claude the worker URL and the Payment Page URL — index.html"
echo "gets 'api' and 'checkout' set to them and pushed from there."
echo
echo "Before turning on ads: run one real ₹1 test purchase and confirm"
echo "the sold count moves on its own within a minute."
