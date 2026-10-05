#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   Switch on the order emails and the payment return, in one command.

     node tools/setup-email.mjs            do everything below that is not done yet
     node tools/setup-email.mjs --check    only report where things stand
     node tools/setup-email.mjs --test     send the four sample emails to the owner

   Reads three values from the environment, never from the command line,
   never prints them, never writes them to disk:

     CLOUDFLARE_API_TOKEN   "Edit Cloudflare Workers" token
     RESEND_API_KEY         Resend key with Full access (it adds the domain)
     OWNER_EMAIL            where new orders go; several allowed, comma separated
     CLOUDFLARE_ACCOUNT_ID  optional; only if the token reaches several accounts

   In order, skipping whatever is already done:
     1. the KAAL_STATE store the worker keeps holds, receipts and the
        no-duplicate-email guard in (created, and bound in wrangler.toml)
     2. deploy worker/ (the payment return, the receipt, the emails)
     3. the RESEND_API_KEY and OWNER_EMAIL secrets on the worker
     4. confirm the live worker answers v2, which switches the page's
        return address and Series 02 forms on by themselves
     5. register thekaal.co with Resend and print the DNS records to add
        at GoDaddy, then check whether they have been added
     6. once the domain is verified, send the four emails to the owner

   Nothing here touches index.html, Razorpay, or the existing Razorpay and
   GitHub secrets on the worker. docs/setup-email.md is the human version.
   ══════════════════════════════════════════════════════════════════ */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/* Node's fetch ignores HTTPS_PROXY unless asked; behind a proxy, re-run
   with it on (Node 22.21 and later). On a laptop with no proxy, nothing. */
if ((process.env.HTTPS_PROXY || process.env.https_proxy) && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: "inherit", env: { ...process.env, NODE_USE_ENV_PROXY: "1" } });
  process.exit(r.status === null ? 1 : r.status);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOML = join(ROOT, "wrangler.toml");
const DOMAIN = "thekaal.co";
const WORKER = "kaal-edition";
/* The three addresses can be pointed at stand-ins, which is how this script
   is tested without touching a real account. */
const WORKER_URL = process.env.KAAL_SETUP_WORKER_URL || "https://kaal-edition.kaal-edition-hq.workers.dev";
const CF = process.env.KAAL_SETUP_CF_API || "https://api.cloudflare.com/client/v4";
const RS = process.env.KAAL_SETUP_RESEND_API || "https://api.resend.com";
const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--test") ? "test" : "all";

const say = (s = "") => console.log(s);
const step = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);
const good = (s) => console.log(`  ✓ ${s}`);
const todo = (s) => console.log(`  • ${s}`);
const stop = (s) => { console.log(`\n  ✗ ${s}\n`); process.exit(1); };

const env = process.env;
const missing = ["CLOUDFLARE_API_TOKEN", "RESEND_API_KEY", "OWNER_EMAIL"].filter(k => !env[k]);
if (missing.length && mode !== "test") stop(`Missing ${missing.join(", ")}. docs/setup-email.md, steps 1 to 3, says where each comes from and where it goes.`);
if (mode === "test" && (!env.RESEND_API_KEY || !env.OWNER_EMAIL)) stop("Missing RESEND_API_KEY or OWNER_EMAIL.");
const owners = String(env.OWNER_EMAIL || "").split(",").map(s => s.trim()).filter(Boolean);
if (owners.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) stop("OWNER_EMAIL does not look like an email address (or a comma-separated list of them).");

async function api(base, path, { method = "GET", body, key } = {}) {
  let res;
  try {
    res = await fetch(base + path, {
      method, headers: { "Authorization": `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) {
    stop(`Could not reach ${new URL(base).host} (${e.cause ? e.cause.code || e.cause.message : e.message}). If this runs in a Claude cloud session, that host must be in the environment's allowed domains: docs/setup-email.md, step 3.`);
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { ok: res.ok, status: res.status, json, text };
}
const cf = (p, o = {}) => api(CF, p, { ...o, key: env.CLOUDFLARE_API_TOKEN });
const rs = (p, o = {}) => api(RS, p, { ...o, key: env.RESEND_API_KEY });

function wrangler(args, input) {
  if (process.env.KAAL_SETUP_DRY_DEPLOY) return { ok: true, out: "(dry run) https://kaal-edition.kaal-edition-hq.workers.dev" };
  const r = spawnSync("npx", ["--yes", "wrangler@4", ...args], {
    cwd: ROOT, input, encoding: "utf8", stdio: [input === undefined ? "inherit" : "pipe", "pipe", "pipe"],
    env: { ...env, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: "false", CI: "1" }
  });
  return { ok: r.status === 0, out: (r.stdout || "") + (r.stderr || "") };
}

/* ── 0. Who is this token for? ── */
let account = env.CLOUDFLARE_ACCOUNT_ID || "";
async function cloudflareAccount() {
  const v = await cf("/user/tokens/verify");
  if (!v.ok || !v.json || !v.json.success) stop("Cloudflare refused the token. Make a new one from the \"Edit Cloudflare Workers\" template (docs/setup-email.md, step 2).");
  good("Cloudflare token is valid");
  if (!account) {
    const a = await cf("/accounts?per_page=50");
    const list = (a.json && a.json.result) || [];
    if (!list.length) stop("The token cannot see any Cloudflare account. Give it access to the account the worker lives in.");
    if (list.length > 1) {
      /* Prefer the account that already runs the worker. */
      for (const acc of list) {
        const s = await cf(`/accounts/${acc.id}/workers/scripts/${WORKER}/settings`);
        if (s.ok) { account = acc.id; break; }
      }
      if (!account) stop(`The token sees ${list.length} accounts and none has the ${WORKER} worker. Set CLOUDFLARE_ACCOUNT_ID.`);
    } else account = list[0].id;
  }
  good(`Cloudflare account ${account.slice(0, 6)}…`);
}

/* ── 1. The store ── */
async function ensureKV() {
  step("1. The KAAL_STATE store");
  let toml = readFileSync(TOML, "utf8");
  const bound = /^\[\[kv_namespaces\]\]\s*\nbinding\s*=\s*"KAAL_STATE"\s*\nid\s*=\s*"([0-9a-f]{32})"/m.exec(toml);
  if (bound) { good(`already bound in wrangler.toml (${bound[1].slice(0, 6)}…)`); return bound[1]; }

  /* Reuse a store the live worker already has, then one by the expected
     name, before ever creating a new one: a second, empty store would
     forget every hold and every "already emailed" mark. */
  let id = "";
  const settings = await cf(`/accounts/${account}/workers/scripts/${WORKER}/settings`);
  const live = settings.json && settings.json.result && (settings.json.result.bindings || []).find(b => b.type === "kv_namespace" && b.name === "KAAL_STATE");
  if (live) { id = live.namespace_id; good("the live worker already has one; reusing it"); }
  if (!id) {
    const list = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100`);
    const found = ((list.json && list.json.result) || []).find(n => /KAAL_STATE/i.test(n.title));
    if (found) { id = found.id; good(`found "${found.title}"; reusing it`); }
  }
  if (!id) {
    if (mode === "check") { todo("not created yet"); return ""; }
    const made = await cf(`/accounts/${account}/storage/kv/namespaces`, { method: "POST", body: { title: "kaal-edition-KAAL_STATE" } });
    if (!made.ok) stop(`Could not create the store: ${made.text.slice(0, 200)}`);
    id = made.json.result.id;
    good("created");
  }
  if (mode === "check") { todo("not yet written into wrangler.toml"); return id; }
  const block = /# \[\[kv_namespaces\]\]\n# binding = "KAAL_STATE"\n# id      = "paste-the-id-here"/;
  if (!block.test(toml)) stop("wrangler.toml has no commented KAAL_STATE block to fill in; add the binding by hand.");
  toml = toml.replace(block, `[[kv_namespaces]]\nbinding = "KAAL_STATE"\nid = "${id}"`);
  writeFileSync(TOML, toml);
  good("bound in wrangler.toml (commit this change)");
  return id;
}

/* ── 3. The secrets ── */
async function ensureSecrets() {
  step("3. Secrets on the worker");
  const s = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`);
  const have = new Set(((s.json && s.json.result) || []).map(x => x.name));
  for (const k of ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET", "GITHUB_TOKEN"]) {
    if (have.has(k)) good(`${k} is set (untouched)`);
    else todo(`${k} is NOT set. Payments need it: run tools/deploy-worker.sh, which asks for it.`);
  }
  if (mode === "check") {
    for (const k of ["RESEND_API_KEY", "OWNER_EMAIL"]) have.has(k) ? good(`${k} is set`) : todo(`${k} not set yet`);
    return;
  }
  for (const k of ["RESEND_API_KEY", "OWNER_EMAIL"]) {
    const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name: k, text: env[k], type: "secret_text" } });
    if (!r.ok) stop(`Could not set ${k}: ${r.text.slice(0, 200)}`);
    good(`${k} ${have.has(k) ? "updated" : "set"}`);
  }
}

/* ── 2. Deploy, and 4. ask the live worker ── */
async function deploy() {
  step("2. Deploy the worker");
  if (mode === "check") { todo("skipped in --check"); return; }
  say("  (wrangler is fetched by npx the first time; this takes a minute)");
  const r = wrangler(["deploy"]);
  if (!r.ok) stop(`Deploy failed:\n${r.out.split("\n").slice(-25).join("\n")}`);
  const url = /https:\/\/\S+workers\.dev/.exec(r.out);
  good(`deployed${url ? " to " + url[0] : ""}`);
}
async function liveCheck() {
  step("4. The live worker");
  try {
    const r = await fetch(WORKER_URL + "/state", { headers: { Origin: "https://thekaal.co" } });
    const j = await r.json();
    if (j.v >= 2) good("answers v2: the page now uses the payment return address and the Series 02 forms");
    else todo("still the old worker (no v2). Deploy has not reached it yet; run again in a minute.");
  } catch (e) {
    todo(`could not reach ${new URL(WORKER_URL).host} from here (${e.cause ? e.cause.code : e.message}). Open ${WORKER_URL}/state in a browser: it should show "v":2.`);
  }
}

/* ── 5. The sending domain ── */
async function domain() {
  step(`5. Sending as connect@${DOMAIN}`);
  const list = await rs("/domains");
  if (list.status === 401 || list.status === 403) stop("Resend refused the key. Create one with \"Full access\" (a \"Sending access\" key cannot add a domain).");
  let d = ((list.json && list.json.data) || []).find(x => x.name === DOMAIN);
  if (!d) {
    if (mode === "check") { todo(`${DOMAIN} is not added to Resend yet`); return null; }
    const made = await rs("/domains", { method: "POST", body: { name: DOMAIN } });
    if (!made.ok) stop(`Resend would not add ${DOMAIN}: ${made.text.slice(0, 200)}`);
    good(`${DOMAIN} added to Resend`);
    d = made.json;
  }
  let full = await rs(`/domains/${d.id}`);
  d = full.json || d;
  /* Ask Resend to look at the DNS now, give it a moment, and read the
     answer again: a domain whose records are already in place verifies on
     this call, and saying otherwise would send the owner back to GoDaddy
     for nothing. */
  if (d.status !== "verified") {
    await rs(`/domains/${d.id}/verify`, { method: "POST" });
    await new Promise(r => setTimeout(r, process.env.KAAL_SETUP_CF_API ? 50 : 4000));
    full = await rs(`/domains/${d.id}`);
    d = full.json || d;
  }
  if (d.status === "verified") { good(`${DOMAIN} is verified: email can be sent from connect@${DOMAIN}`); return d; }

  todo(`${DOMAIN} is ${d.status || "not verified"}. Add these records in GoDaddy (My Products → ${DOMAIN} → DNS → Add New Record):`);
  say("");
  say("     Type   Name                 Priority  Value");
  for (const r of d.records || []) {
    say(`     ${String(r.type).padEnd(6)} ${String(r.name).padEnd(20)} ${String(r.priority || "").padEnd(9)} ${r.value}`);
  }
  say(`     TXT    _dmarc                         v=DMARC1; p=none;   (recommended; skip if one exists)`);
  say("");
  say("  GoDaddy adds the domain itself, so type the Name exactly as above (\"send\", not \"send.thekaal.co\").");
  say("  Records usually verify within an hour. Then run:  node tools/setup-email.mjs --check");
  return d;
}

/* ── 6. The four emails, to the owner ── */
async function testEmails() {
  step("6. The four emails, sent to you");
  const { buyerConfirmation, ownerSale, ownerShip, buyerShip, arriveBy, indiaTime } = await import("../worker/mail.js");
  const at = new Date();
  const base = { site: "https://thekaal.co", n: 7, dial: "Midnight", amount: "₹5,999", paymentId: "pay_SAMPLE0000001", orderId: "order_SAMPLE00000001",
    email: owners[0], contact: "+919311416678", gift: true, giftNote: "A sample card, written by hand.", when: indiaTime(at), arriveBy: arriveBy(at),
    left: 16, edition: 20, hasAddress: false, shipUrl: "https://thekaal.co/claimed.html#ship" };
  const addr = { name: "Sample Buyer", phone: "+919311416678", line1: "12 Sample Street", line2: "", city: "Delhi", state: "Delhi", pin: "110001" };
  const mails = [
    ["What the buyer gets when they pay", buyerConfirmation(base)],
    ["What you get when they pay", ownerSale(base)],
    ["What you get when they give an address", ownerShip({ ...base, address: addr, buyerEmail: owners[0] })],
    ["What the buyer gets when they give an address", buyerShip({ ...base, address: addr })]
  ];
  const from = "KAAL <connect@thekaal.co>";
  for (const [label, m] of mails) {
    const r = await rs("/emails", { method: "POST", body: { from, to: owners, subject: `[Sample] ${m.subject}`, html: m.html, text: `${label}.\n\n${m.text}`, reply_to: "connect@thekaal.co" } });
    if (!r.ok) stop(`Resend refused to send (${r.status}): ${r.text.slice(0, 200)}. If it says the domain is not verified, finish step 5 first.`);
    good(`sent: ${label}`);
  }
  say(`\n  Check ${owners.join(" and ")}. If they are in Spam, mark them "Not spam" once.`);
}

(async () => {
  say(`KAAL email setup (${mode})`);
  if (mode === "test") { await testEmails(); return; }
  await cloudflareAccount();
  await ensureKV();
  /* Deploy before the secrets: the new wrangler.toml no longer defines
     OWNER_EMAIL as a plain setting, so the secret can never collide with
     one left on an older deploy. */
  await deploy();
  await ensureSecrets();
  await liveCheck();
  const d = await domain();
  if (d && d.status === "verified" && mode === "all") await testEmails();
  step("Done");
  if (mode === "all") say("  Commit wrangler.toml if it changed (the store's id is not a secret).");
})();
