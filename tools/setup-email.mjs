#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════
   Switch on the order emails and the payment return, in one command.

     node tools/setup-email.mjs            do everything below that is not done yet
     node tools/setup-email.mjs --check    only report where things stand
     node tools/setup-email.mjs --test     send the sample emails to the owner
     node tools/setup-email.mjs --deploy   only deploy the worker again (after a change
                                           to worker/); needs only CLOUDFLARE_API_TOKEN
     node tools/setup-email.mjs --live     the registry on the LIVE worker: its database,
                                           migrations/, AUTH_SECRET once, then a deploy
                                           (and the Meta token if given); see
                                           docs/registry-live.md
     node tools/setup-email.mjs --staging  the registry's staging worker: its database and
                                           store, migrations/, Razorpay TEST keys, deploy
                                           (needs RAZORPAY_TEST_KEY_ID, RAZORPAY_TEST_KEY_SECRET,
                                           RAZORPAY_TEST_WEBHOOK_SECRET; see docs/staging.md)

   Reads these from the environment, never from the command line, never
   prints them, never writes them to disk:

     CLOUDFLARE_API_TOKEN   "Edit Cloudflare Workers" token
     RESEND_API_KEY         Resend key with Full access (it adds the domain)
     OWNER_EMAIL            optional: where new orders and the morning report go;
                            connect@thekaal.co when not set; several allowed, comma separated
     CLOUDFLARE_ACCOUNT_ID  optional; only if the token reaches several accounts
     DESK_PASSCODE          optional: the passcode for the owner's desk (/desk),
                            at least 10 characters. Without it, and with no
                            passcode on the worker yet, one is made and emailed
                            to the owner; it is never printed
     ANTHROPIC_API_KEY      optional: lets Claude write each nearly-bought note
                            from the visitor's own visit (worker/lead-writer.js);
                            without it the standard note goes, as before
     META_CAPI_TOKEN        optional: Meta Conversions API access token, so every
                            paid order reaches the ad account from the worker
                            (docs/meta.md). Set on every run that has it,
                            --deploy included

   In order, skipping whatever is already done:
     1. the KAAL_STATE store the worker keeps holds, receipts and the
        no-duplicate-email guard in (created, and bound in wrangler.toml)
     2. deploy worker/ (the payment return, the receipt, the emails)
     3. the RESEND_API_KEY, OWNER_EMAIL and DESK_PASSCODE secrets on the worker
     4. confirm the live worker answers v2, which switches the page's
        return address and Series 02 forms on by themselves
     5. register thekaal.co with Resend and print the DNS records to add
        at GoDaddy, then check whether they have been added
     6. once the domain is verified, send the sample emails to the owner
     7. the desk: when no passcode was given and none exists, make one, set
        it, and email it to the owner (only once sending works)

   Nothing here touches index.html, Razorpay, or the existing Razorpay and
   GitHub secrets on the worker. docs/setup-email.md is the human version.
   ══════════════════════════════════════════════════════════════════ */
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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
const mode = process.argv.includes("--check") ? "check" : process.argv.includes("--test") ? "test"
  : process.argv.includes("--deploy") ? "deploy" : process.argv.includes("--staging") ? "staging"
  : process.argv.includes("--live") ? "live" : "all";

const say = (s = "") => console.log(s);
const step = (s) => console.log(`\n── ${s} ${"─".repeat(Math.max(0, 60 - s.length))}`);
const good = (s) => console.log(`  ✓ ${s}`);
const todo = (s) => console.log(`  • ${s}`);
const stop = (s) => { console.log(`\n  ✗ ${s}\n`); process.exit(1); };

const env = process.env;
const missing = (mode === "deploy" || mode === "live" ? ["CLOUDFLARE_API_TOKEN"]
  : mode === "staging" ? ["CLOUDFLARE_API_TOKEN", "RAZORPAY_TEST_KEY_ID", "RAZORPAY_TEST_KEY_SECRET", "RAZORPAY_TEST_WEBHOOK_SECRET"]
  : ["CLOUDFLARE_API_TOKEN", "RESEND_API_KEY"]).filter(k => !env[k]);
/* On GitHub (the setup-worker workflow) the keys are repository secrets,
   not a Claude environment's variables; say so where it applies. */
const WHERE = env.GITHUB_ACTIONS ? "Add it on GitHub: Settings → Secrets and variables → Actions → New repository secret (docs/setup-email.md, \"From a phone\")." : "docs/setup-email.md, steps 1 to 3, says where each comes from and where it goes.";
if (missing.length && mode !== "test") stop(`Missing ${missing.join(", ")}. ${WHERE}`);
if (mode === "test" && !env.RESEND_API_KEY) stop(`Missing RESEND_API_KEY. ${WHERE}`);
const owners = String(env.OWNER_EMAIL || "connect@thekaal.co").split(",").map(s => s.trim()).filter(Boolean);
if (owners.some(e => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) stop("OWNER_EMAIL does not look like an email address (or a comma-separated list of them).");
if (env.DESK_PASSCODE && String(env.DESK_PASSCODE).trim().length < 10) stop("DESK_PASSCODE is shorter than 10 characters. Choose a longer one: four unrelated words work well.");

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
    have.has("RESEND_API_KEY") ? good("RESEND_API_KEY is set") : todo("RESEND_API_KEY not set yet");
    have.has("OWNER_EMAIL") ? good("OWNER_EMAIL is set") : good("OWNER_EMAIL not set: orders and the morning report go to connect@thekaal.co");
    have.has("DESK_PASSCODE") ? good(`DESK_PASSCODE is set: the desk is open at ${WORKER_URL}/desk`) : todo("DESK_PASSCODE not set: the desk stays shut");
    have.has("ANTHROPIC_API_KEY") ? good("ANTHROPIC_API_KEY is set: Claude writes each nearly-bought note from the visit") : todo("ANTHROPIC_API_KEY not set: the standard nearly-bought note goes (docs/followups.md)");
    have.has("META_CAPI_TOKEN") ? good("META_CAPI_TOKEN is set: every paid order is sent to Meta from the worker") : todo("META_CAPI_TOKEN not set: Meta hears of a sale only from the buyer's browser (docs/meta.md)");
    have.has("META_TEST_EVENT_CODE") ? todo("META_TEST_EVENT_CODE is set: sales go to Meta's Test events tab, NOT to the ad account. Remove it after testing.") : null;
    return;
  }
  deskWasSet = have.has("DESK_PASSCODE");
  for (const k of ["RESEND_API_KEY", "OWNER_EMAIL", "DESK_PASSCODE", "META_CAPI_TOKEN", "ANTHROPIC_API_KEY"].filter(k => env[k])) {
    const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name: k, text: env[k], type: "secret_text" } });
    if (!r.ok) stop(`Could not set ${k}: ${r.text.slice(0, 200)}`);
    good(`${k} ${have.has(k) ? "updated" : "set"}`);
  }
}

/* The Meta token on its own, for --deploy: a token pasted into the
   repository secret reaches the worker on the next deploy, with nothing
   else touched. It is shown to Meta first (the token never appears in the
   output), so a mistyped one is reported here rather than on a sale. */
async function ensureMeta() {
  if (!env.META_CAPI_TOKEN) return;
  step("Meta Conversions API token");
  const pixel = (/^\s*META_PIXEL\s*=\s*"(\d+)"/m.exec(readFileSync(TOML, "utf8")) || [])[1];
  if (pixel && !process.env.KAAL_SETUP_CF_API) {
    try {
      const r = await fetch(`https://graph.facebook.com/v23.0/${pixel}?fields=id,name&access_token=${encodeURIComponent(env.META_CAPI_TOKEN)}`);
      const j = await r.json().catch(() => null);
      /* A warning, not a stop: some tokens may send events without being
         allowed to read the dataset's name, and a refusal here must never
         keep a good token off the worker. The desk's Health shows whether
         Meta takes the first real sale. */
      if (!r.ok) todo(`Meta would not show dataset ${pixel} to this token (${r.status}${j && j.error ? ": " + String(j.error.message).slice(0, 160) : ""}). Setting it anyway; if the desk's Health later says Meta refused a sale, generate the token again from that dataset's Settings (docs/meta.md).`);
      else good(`Meta accepts the token for dataset ${pixel}${j && j.name ? ` (${j.name})` : ""}`);
    } catch (e) {
      todo(`could not reach graph.facebook.com to check the token (${e.cause ? e.cause.code : e.message}); setting it anyway`);
    }
  }
  const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name: "META_CAPI_TOKEN", text: env.META_CAPI_TOKEN, type: "secret_text" } });
  if (!r.ok) stop(`Could not set META_CAPI_TOKEN: ${r.text.slice(0, 200)}`);
  good("META_CAPI_TOKEN set on the worker. Paid orders of the last six days reach Meta within half an hour.");
}

/* The courier's shared secret, for --deploy and --live: whatever the owner
   typed into Shiprocket's webhook setting as its security token, so the
   worker can tell Shiprocket from anyone else posting to /ship/shiprocket.
   Optional; without it the endpoint answers "off" and Dispatched and
   Delivered stay one tap each. Never printed. */
async function ensureCourier() {
  if (!env.SHIPROCKET_TOKEN) { todo("SHIPROCKET_TOKEN not set: Dispatched and Delivered stay one tap each (docs/courier.md)"); return; }
  step("Shiprocket link");
  if (String(env.SHIPROCKET_TOKEN).length < 12) stop("SHIPROCKET_TOKEN is too short: use at least 12 characters, any text, the same as the token you give Shiprocket.");
  const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name: "SHIPROCKET_TOKEN", text: env.SHIPROCKET_TOKEN, type: "secret_text" } });
  if (!r.ok) stop(`Could not set SHIPROCKET_TOKEN: ${r.text.slice(0, 200)}`);
  good(`SHIPROCKET_TOKEN set on the worker. Shiprocket posts to ${WORKER_URL}/ship/shiprocket`);
}

/* ── The staging worker (wrangler.toml [env.staging]) ──
   Its own D1 database and KV store, found by name or made, their ids
   written over the placeholders in wrangler.toml, migrations/ applied,
   TEST keys only (a live key is refused before anything is touched), and
   deployed. The live worker is never touched by this mode. */
const STAGING_WORKER = "kaal-edition-staging";
async function staging() {
  if (!/^rzp_test_/.test(env.RAZORPAY_TEST_KEY_ID)) stop("RAZORPAY_TEST_KEY_ID does not start with rzp_test_. Staging only ever takes Razorpay TEST keys: Razorpay dashboard, switch to Test Mode, Account & Settings, API Keys.");
  step("Staging 1. Database and store");
  let toml = readFileSync(TOML, "utf8");
  const zeroD1 = 'database_id = "00000000-0000-0000-0000-000000000000"', zeroKV = 'id = "00000000000000000000000000000000"';
  if (toml.includes(zeroD1)) {
    const list = await cf(`/accounts/${account}/d1/database?name=kaal-registry-staging`);
    let db = ((list.json && list.json.result) || []).find(d => d.name === "kaal-registry-staging");
    if (!db) {
      const made = await cf(`/accounts/${account}/d1/database`, { method: "POST", body: { name: "kaal-registry-staging" } });
      if (!made.ok) stop(`Could not create the staging database: ${made.text.slice(0, 200)}. The token needs "D1: Edit" as well as "Workers Scripts: Edit".`);
      db = made.json.result; good("staging database created");
    } else good("staging database found; reusing it");
    toml = toml.replace(zeroD1, `database_id = "${db.uuid}"`);
  } else good("staging database already bound in wrangler.toml");
  if (toml.includes(zeroKV)) {
    const list = await cf(`/accounts/${account}/storage/kv/namespaces?per_page=100`);
    let ns = ((list.json && list.json.result) || []).find(n => n.title === "kaal-edition-staging-KAAL_STATE");
    if (!ns) {
      const made = await cf(`/accounts/${account}/storage/kv/namespaces`, { method: "POST", body: { title: "kaal-edition-staging-KAAL_STATE" } });
      if (!made.ok) stop(`Could not create the staging store: ${made.text.slice(0, 200)}`);
      ns = made.json.result; good("staging store created");
    } else good("staging store found; reusing it");
    toml = toml.replace(zeroKV, `id = "${ns.id}"`);
  } else good("staging store already bound in wrangler.toml");
  writeFileSync(TOML, toml);

  step("Staging 2. The schema (migrations/)");
  const m = wrangler(["d1", "migrations", "apply", "DB", "--env", "staging", "--remote"]);
  if (!m.ok) stop(`Migrations failed:\n${m.out.split("\n").slice(-20).join("\n")}`);
  good(/No migrations to apply/i.test(m.out) ? "already up to date" : "applied");

  step("Staging 3. Deploy");
  const d = wrangler(["deploy", "--env", "staging"]);
  if (!d.ok) stop(`Staging deploy failed:\n${d.out.split("\n").slice(-25).join("\n")}`);
  good("deployed");

  step("Staging 4. Secrets (TEST keys only)");
  const put = async (name, value) => {
    const r = await cf(`/accounts/${account}/workers/scripts/${STAGING_WORKER}/secrets`, { method: "PUT", body: { name, text: value, type: "secret_text" } });
    if (!r.ok) stop(`Could not set ${name} on staging: ${r.text.slice(0, 200)}`);
    good(`${name} set`);
  };
  await put("RAZORPAY_KEY_ID", env.RAZORPAY_TEST_KEY_ID);
  await put("RAZORPAY_KEY_SECRET", env.RAZORPAY_TEST_KEY_SECRET);
  await put("RAZORPAY_WEBHOOK_SECRET", env.RAZORPAY_TEST_WEBHOOK_SECRET);
  for (const k of ["RESEND_API_KEY", "OWNER_EMAIL", "DESK_PASSCODE", "ADMIN_EMAIL", "ANTHROPIC_API_KEY"]) if (env[k]) await put(k, env[k]);
  /* The control room's own key: signs sign-in codes and seals the
     authenticator secret. Made here once and never shown. Never replaced
     on a later run: a new one would lock the admin out of /control (the
     sealed authenticator secret could no longer be read). */
  const have = await cf(`/accounts/${account}/workers/scripts/${STAGING_WORKER}/secrets`);
  const names = new Set(((have.json && have.json.result) || []).map(x => x.name));
  if (names.has("AUTH_SECRET")) good("AUTH_SECRET already set (kept)");
  else await put("AUTH_SECRET", randomBytes(48).toString("base64url"));

  const url = `https://${STAGING_WORKER}.kaal-edition-hq.workers.dev`;
  step("Done. Two things left, both in Razorpay TEST mode");
  say(`  1. Razorpay dashboard → switch to Test Mode → Account & Settings → Webhooks → Add New Webhook`);
  say(`       URL:     ${url}/`);
  say(`       Secret:  the same value as the RAZORPAY_TEST_WEBHOOK_SECRET repository secret`);
  say(`       Events:  payment.captured and refund.processed`);
  say(`  2. Open ${url}/staging on your phone and buy a number with a test card.`);
  say(`  3. The control room: ${url}/control. Sign in with ${env.ADMIN_EMAIL || String(env.OWNER_EMAIL || "connect@thekaal.co").split(",")[0]}; the emailed six-digit code is all it asks.`);
}

/* ── The registry on the live worker ──
   Its D1 database, found by name or made, bound in wrangler.toml above the
   staging section; migrations/ applied before the code that needs them;
   AUTH_SECRET made once and never replaced (a new one would lock the admin
   out); then the same deploy as --deploy, with the Meta token if given.
   REGISTRY = "off" in wrangler.toml switches it all off again. */
async function live() {
  step("Live 1. The registry's database");
  let toml = readFileSync(TOML, "utf8");
  const bound = /^\[\[d1_databases\]\]\s*\nbinding\s*=\s*"DB"\s*\ndatabase_name\s*=\s*"kaal-registry"\s*\ndatabase_id\s*=\s*"([0-9a-f-]{36})"/m.exec(toml);
  if (bound) good(`already bound in wrangler.toml (${bound[1].slice(0, 8)}…)`);
  else {
    const list = await cf(`/accounts/${account}/d1/database?name=kaal-registry`);
    if (!list.ok) stop(`Cloudflare would not list D1 databases (${list.status}). The token needs "D1: Edit" as well as "Workers Scripts: Edit" (docs/registry-live.md, step 1).`);
    let db = ((list.json && list.json.result) || []).find(d => d.name === "kaal-registry");
    if (!db) {
      const made = await cf(`/accounts/${account}/d1/database`, { method: "POST", body: { name: "kaal-registry" } });
      if (!made.ok) stop(`Could not create the database: ${made.text.slice(0, 200)}. The token needs "D1: Edit".`);
      db = made.json.result; good("created");
    } else good("found; reusing it");
    const block = `# The registry's database (docs/registry-live.md), bound by setup-worker\n# in mode live. REGISTRY in [vars] above is its off switch.\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "kaal-registry"\ndatabase_id = "${db.uuid}"\nmigrations_dir = "migrations"\n\n`;
    const at = toml.indexOf("# ══════════════════════════════════════════════════════════════════════\n# STAGING");
    toml = at > -1 ? toml.slice(0, at) + block + toml.slice(at) : toml + "\n" + block;
    writeFileSync(TOML, toml);
    good("bound in wrangler.toml (committed back by the workflow)");
  }

  step("Live 2. The schema (migrations/)");
  const m = wrangler(["d1", "migrations", "apply", "DB", "--remote"]);
  if (!m.ok) stop(`Migrations failed; nothing else was changed:\n${m.out.split("\n").slice(-20).join("\n")}`);
  good(/No migrations to apply/i.test(m.out) ? "already up to date" : "applied");

  step("Live 3. The control room's key");
  const have = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`);
  const names = new Set(((have.json && have.json.result) || []).map(x => x.name));
  const put = async (name, value) => {
    const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name, text: value, type: "secret_text" } });
    if (!r.ok) stop(`Could not set ${name}: ${r.text.slice(0, 200)}`);
    good(`${name} set`);
  };
  if (names.has("AUTH_SECRET")) good("AUTH_SECRET already set (kept)");
  else await put("AUTH_SECRET", randomBytes(48).toString("base64url"));
  for (const k of ["ADMIN_EMAIL", "OWNER_EMAIL", "RESEND_API_KEY", "DESK_PASSCODE", "ANTHROPIC_API_KEY"]) if (env[k]) await put(k, env[k]);
  /* A new key each deploy, never printed, for step 5 alone. */
  const opsKey = randomBytes(32).toString("base64url");
  await put("OPS_KEY", opsKey);

  await deploy();
  await ensureMeta();
  await ensureCourier();
  await liveCheck();
  await ownerRequests(opsKey);
  const who = env.ADMIN_EMAIL || String(env.OWNER_EMAIL || "connect@thekaal.co").split(",")[0];
  step("Done. The registry is live");
  say(`  1. Open ${WORKER_URL}/control on your phone and sign in with ${who}.`);
  say("     The six-digit code it emails you is the whole lock, so keep that mailbox safe.");
  say("  2. Overview: the paid orders come in on their own within half an hour, or tap");
  say("     \"Bring in paid orders from Razorpay\".");
  say("  3. Orders, \"Record a past sale\", for each number it lists as sold before the registry.");
  say('  Off switch: REGISTRY = "off" in wrangler.toml, then this workflow in mode deploy.');
}

/* ── 2. Deploy, and 4. ask the live worker ── */
async function deploy() {
  step("2. Deploy the worker");
  if (mode === "check") { todo("skipped in --check"); return; }
  say("  (wrangler is fetched by npx the first time; this takes a minute)");
  /* New code may read a column only a newer migration adds, so a code-only
     deploy brings the schema up first whenever the registry is bound. Mode
     live has just done this; here it would only say "No migrations". */
  if (mode === "deploy" && /^\[\[d1_databases\]\]\s*\nbinding\s*=\s*"DB"\s*\ndatabase_name\s*=\s*"kaal-registry"/m.test(readFileSync(TOML, "utf8"))) {
    const m = wrangler(["d1", "migrations", "apply", "DB", "--remote"]);
    if (!m.ok) stop(`Migrations failed; the worker was not deployed:\n${m.out.split("\n").slice(-20).join("\n")}`);
    good(/No migrations to apply/i.test(m.out) ? "schema already up to date" : "schema brought up to date (migrations/)");
  }
  const r = wrangler(["deploy"]);
  if (!r.ok) stop(`Deploy failed:\n${r.out.split("\n").slice(-25).join("\n")}`);
  const url = /https:\/\/\S+workers\.dev/.exec(r.out);
  good(`deployed${url ? " to " + url[0] : ""}`);
}
/* 5. The owner's own requests (worker OWNER_OPS and the house's pieces),
   run at once on the worker just deployed, and what happened, in words.
   The answer names no person, so this public log can show it. */
async function ownerRequests(key) {
  step("5. Your requests, run now");
  /* A new version takes a few seconds to reach every Cloudflare location, and
     the one just before it would answer with what it knew. It is the new one
     when it holds as many sealed addresses as worker/house.js does. */
  const want = (readFileSync(new URL("../worker/house.js", import.meta.url), "utf8").split("const HOUSE = [")[1] || "").split("];")[0].split('box: "').length - 1;
  let j = null;
  for (let i = 0; i < 8 && !(j && (j.sealed === undefined ? want === 0 : j.sealed >= want)); i++) {
    if (i) await new Promise(r => setTimeout(r, i < 2 ? 6000 : 10000));
    try {
      const r = await fetch(WORKER_URL + "/ops/run", { method: "POST", headers: { Authorization: "Bearer " + key }, signal: AbortSignal.timeout(30000) });
      const got = r.ok ? await r.json().catch(() => null) : null;
      if (got) j = got;
      if (!got) say(`  • not yet (HTTP ${r.status}${r.status === 503 || r.status >= 520 ? ": the worker ran out of time or failed" : ""}); trying again`);
      else if (want && !(got.sealed >= want)) say("  • the new version has not reached every location yet; asking again");
    } catch (e) { say(`  • could not reach the worker (${e.cause ? e.cause.code : e.name}); trying again`); }
  }
  if (!j) { todo("no answer: the light run (:07 and :37) does the same within half an hour; Health in the command centre says how it went."); return; }
  for (const o of j.ops || []) (o.ok ? good : todo)(`${o.label}: ${o.detail}`);
  for (const h of j.house || []) {
    const n = "No. " + String(h.n).padStart(2, "0");
    if (h.owner === "your address") good(`${n} is registered to its owner's address; they sign in at thekaal.co/owners with it.`);
    else if (h.owner === "none yet" && h.piece === "available") todo(`${n} is still on sale in the registry; its owner signing in at thekaal.co/owners takes it off sale and sends the letter to register it.`);
    else if (h.owner === "none yet") good(`${n} (${h.piece}) is kept for its owner's address; the letter to register it goes to that inbox.`);
    else if (h.owner === "the shop's address") good(`${n} is held by the shop's address; signing in at thekaal.co/owners with its owner's own moves it there.`);
    else todo(`${n}: ${h.owner === "another owner" ? "held by another owner, so it was left alone" : h.state || h.owner}.`);
  }
  for (const d of j.delivered || []) (/letter (queued|already sent)|registered/.test(d.did) ? good : todo)(`No. ${String(d.n).padStart(2, "0")}: ${d.did === "letter queued" ? "the registration letter has gone to its owner's address" : d.did === "letter already sent" ? "its registration letter went earlier" : d.did === "registered" ? "registered by its owner" : d.did}`);
  /* The public half of the worker's own key: kept in the repository so an
     owner's address can be sealed to it (tools/seal-email.mjs). */
  if (j.opsKey && j.opsKey.x) {
    const file = new URL("ops-key.json", import.meta.url), next = JSON.stringify(j.opsKey, null, 2) + "\n";
    const was = existsSync(file) ? readFileSync(file, "utf8") : "";
    if (was !== next) { writeFileSync(file, next); good("the worker's public key is written to tools/ops-key.json (committed by the workflow)"); }
  }
  if (j.mail) {
    const m = j.mail, q = m.outbox || {};
    if (m.last) (m.last.ok ? good : todo)(`Email: the last send ${m.last.ok ? "was accepted" : "was REFUSED (" + (m.last.status || "no answer") + (m.last.msg ? ": " + m.last.msg : "") + ")"} (${m.last.at})`);
    else say("  · Email: no send recorded yet");
    if (m.fail && (!m.last || !m.last.ok || m.fail.at > m.last.at)) todo(`Email: last refusal ${m.fail.at}: ${m.fail.status || "no answer"} ${m.fail.msg || ""}`);
    say(`  · Letters queue, last 48 hours: sent ${q.sent || 0}, failed ${q.failed || 0}, waiting ${q.queued || 0}`);
    if (m.lastFailed) todo(`Last letter that failed: ${m.lastFailed.template} (${m.lastFailed.at}): ${m.lastFailed.why}`);
  }
  if (j.github) say(`  · The worker's GitHub key: ${j.github}`);
  if (Array.isArray(j.shopSold)) say(`  · The shop's stored list of gone numbers: ${j.shopSold.join(", ") || "none"}`);
  say("  · The twenty (registry state; orders; on the shop's gone list; last change):");
  for (const f of j.facts || []) say(`      No. ${String(f.n).padStart(2, "0")}  ${f.piece.padEnd(10)} ${(f.orders && f.orders.length ? f.orders.join(", ") : "no order").padEnd(28)} ${f.shopGone ? "gone on shop" : "open on shop"}${f.last ? "  · " + f.last : ""}`);
}

async function liveCheck() {
  step("4. The live worker");
  try {
    const r = await fetch(WORKER_URL + "/state", { headers: { Origin: "https://thekaal.co" } });
    const j = await r.json();
    if (j.v >= 3) good("answers v3: the page asks for the buyer's details before payment, and refunds are traced");
    else if (j.v >= 2) todo("answers v2: the store is not bound, so details before payment stay off. Run again in mode all.");
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

/* Made-up numbers, only so the morning report can be seen before a real one. */
function sampleDigest() {
  const day = new Date(Date.now() - 86400000 + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const trend = [];
  for (let i = 6; i >= 0; i--) {
    const dd = new Date(Date.parse(day + "T12:00:00Z") - i * 86400000).toISOString().slice(0, 10);
    trend.push({ day: dd, visitors: 180 + i * 7, visits: 230 + i * 9, numbers: 6 + (i % 3), checkouts: 2 + (i % 2), orders: i === 3 ? 1 : 0 });
  }
  return { site: "https://thekaal.co", day, edition: 20, left: 16, sold: [1, 2, 3, 9], revenue: 599900, counting: true, razorpay: true,
    c: { visit: 241, visitor: 187, hero_complete: 120, view: 66, dial: 21, early_dial: 9, number: 8, checkout: 3, caseback_view: 8, gift: 1, provenance_click: 4 },
    orders: [{ n: 7, dial: "Midnight", amount: "₹5,999", paise: 599900, email: owners[0], contact: "+919311416678", id: "pay_SAMPLE0000001", at: "6 Oct 2026, 7:15 pm" }],
    unfinished: [{ n: 11, dial: "Champagne", stage: "Payment failed: Bank declined", at: "6 Oct 2026, 3:20 pm", email: "sample@example.com", contact: "+919311416678" }],
    leads: [{ email: "sample.lead@example.com", source: "footer", at: "6 Oct 2026, 11:02 am" }], trend,
    alerts: [{ level: "act", kind: "address", title: "No. 07: no delivery address yet", detail: "Paid 6 Oct 2026, 7:15 pm. Send them the address link, or mark it dispatched if it has already gone." }],
    deskUrl: `${WORKER_URL}/desk` };
}

/* ── 6. The emails, to the owner ── */
async function testEmails() {
  step("6. The emails, sent to you as samples");
  const { buyerConfirmation, ownerSale, ownerShip, buyerShip, buyerDispatched, buyerRefund, ownerRefund, ownerDigest, arriveBy, indiaTime } = await import("../worker/mail.js");
  const at = new Date();
  const base = { site: "https://thekaal.co", n: 7, dial: "Midnight", amount: "₹5,999", paymentId: "pay_SAMPLE0000001", orderId: "order_SAMPLE00000001",
    email: owners[0], contact: "+919311416678", gift: true, giftNote: "A sample card, written by hand.", when: indiaTime(at), arriveBy: arriveBy(at),
    left: 16, edition: 20, hasAddress: false, shipUrl: "https://thekaal.co/claimed.html#ship" };
  const refund = { site: "https://thekaal.co", n: 7, dial: "Midnight", amount: "₹5,999", paid: "₹5,999", full: true, paymentId: "pay_SAMPLE0000001",
    refundId: "rfnd_SAMPLE000001", when: indiaTime(at), email: owners[0], contact: "+919311416678", stillSold: true,
    deskUrl: `${WORKER_URL}/desk`, buyerTold: true };
  const addr = { name: "Sample Buyer", phone: "+919311416678", line1: "12 Sample Street", line2: "", city: "Delhi", state: "Delhi", pin: "110001" };
  const mails = [
    ["What the buyer gets when they pay", buyerConfirmation(base)],
    ["What you get when they pay", ownerSale(base)],
    ["What you get when they give an address", ownerShip({ ...base, address: addr, buyerEmail: owners[0] })],
    ["What the buyer gets when they give an address", buyerShip({ ...base, address: addr })],
    ["What the buyer gets when you mark it dispatched on the desk", buyerDispatched({ ...base, address: addr, courier: "Delhivery", tracking: "SAMPLE123456", url: "" })],
    ["What the buyer gets when a refund is processed", buyerRefund({ ...refund })],
    ["What you get when a refund is processed", ownerRefund({ ...refund })],
    ["What you get at the end of every day (sample numbers)", ownerDigest(sampleDigest())]
  ];
  const from = "KAAL <connect@thekaal.co>";
  for (const [label, m] of mails) {
    const r = await rs("/emails", { method: "POST", body: { from, to: owners, subject: `[Sample] ${m.subject}`, html: m.html, text: `${label}.\n\n${m.text}`, reply_to: "connect@thekaal.co" } });
    if (!r.ok) stop(`Resend refused to send (${r.status}): ${r.text.slice(0, 200)}. If it says the domain is not verified, finish step 5 first.`);
    good(`sent: ${label}`);
  }
  say(`\n  Check ${owners.join(" and ")}. If they are in Spam, mark them "Not spam" once.`);
}

/* ── 7. The desk ── */
let deskWasSet = false;
async function ensureDesk(verified) {
  step("7. The desk");
  if (env.DESK_PASSCODE) { good(`open at ${WORKER_URL}/desk with the passcode you chose`); return; }
  if (deskWasSet) { good(`open at ${WORKER_URL}/desk (its passcode was set before; untouched)`); return; }
  if (!verified) { todo("shut for now: a passcode is made and emailed to you once sending works. Run this again after the domain verifies."); return; }
  /* Sixteen characters from an alphabet with no look-alikes (no 0/o, 1/l/i):
     about 79 bits, read aloud or typed on a phone without a mistake. */
  const abc = "abcdefghjkmnpqrstuvwxyz23456789", bytes = randomBytes(16);
  const code = Array.from(bytes, b => abc[b % abc.length]).join("").replace(/(.{4})(?!$)/g, "$1-");
  const desk = `${WORKER_URL}/desk`;
  const text = [`The desk: ${desk}`, "", `Passcode: ${code}`, "", "Open it on your phone and let the phone save the passcode when it offers.",
    "Everything the website knows is there: orders and addresses, the dispatch button that emails the buyer their tracking,",
    "who nearly bought, the Series 02 list, the twenty, and the day's numbers.", "",
    "Nothing on thekaal.co links to it. Keep this email private; to change the passcode, see docs/desk.md."].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#111">
<p>The desk: <a href="${desk}">${desk}</a></p><p>Passcode: <b style="font-family:Menlo,Consolas,monospace;font-size:18px;letter-spacing:1px">${code}</b></p>
<p>Open it on your phone and let the phone save the passcode when it offers. Orders and addresses, the dispatch button that emails the buyer their tracking, who nearly bought, the Series 02 list, the twenty, and the day's numbers.</p>
<p style="color:#666">Nothing on thekaal.co links to it. Keep this email private; to change the passcode, see docs/desk.md.</p></div>`;
  /* Emailed first: a passcode set but never delivered would lock the owner out. */
  const m = await rs("/emails", { method: "POST", body: { from: "KAAL <connect@thekaal.co>", to: owners, subject: "Your KAAL desk", text, html, reply_to: "connect@thekaal.co" } });
  if (!m.ok) { todo(`could not email a passcode (${m.status}); the desk stays shut. Set DESK_PASSCODE yourself (docs/desk.md).`); return; }
  const r = await cf(`/accounts/${account}/workers/scripts/${WORKER}/secrets`, { method: "PUT", body: { name: "DESK_PASSCODE", text: code, type: "secret_text" } });
  if (!r.ok) stop(`Could not set DESK_PASSCODE: ${r.text.slice(0, 200)}. The emailed passcode does not work; run this again.`);
  good(`made a passcode and emailed it to ${owners.join(" and ")} ("Your KAAL desk"). It is not shown here.`);
  good(`open at ${desk}`);
}

(async () => {
  say(`KAAL email setup (${mode})`);
  if (mode === "test") { await testEmails(); return; }
  await cloudflareAccount();
  if (mode === "staging") { await staging(); return; }
  await ensureKV();
  if (mode === "live") { await live(); return; }
  if (mode === "deploy") { await deploy(); await ensureMeta(); await ensureCourier(); await liveCheck(); step("Done"); return; }
  /* Deploy before the secrets: the new wrangler.toml no longer defines
     OWNER_EMAIL as a plain setting, so the secret can never collide with
     one left on an older deploy. */
  await deploy();
  await ensureSecrets();
  await liveCheck();
  const d = await domain();
  if (d && d.status === "verified" && mode === "all") await testEmails();
  if (mode === "all") await ensureDesk(!!(d && d.status === "verified"));
  step("Done");
  if (mode === "all") say("  Commit wrangler.toml if it changed (the store's id is not a secret).");
})();
