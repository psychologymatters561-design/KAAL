/* ══════════════════════════════════════════════════════════════════
   THE NEARLY-BOUGHT NOTE, ON WHATSAPP (Meta's WhatsApp Cloud API).

   Someone chose a number, gave their name and phone on the details step
   (under the line that says KAAL may reach them about this order by email
   or WhatsApp), reached payment and stopped. Three hours later the worker
   writes the one note for WhatsApp (section 3e of kaal-sold-sync.js), from
   their visit, and it WAITS in the command centre's Follow-ups. The owner
   reads it, edits the words or the name, and presses Approve; nothing goes
   on WhatsApp without that. Before it goes the truth is checked again
   (paid since, their number sold since, the count moved). Still one note,
   once, ever: if WhatsApp refuses it, his same words go by email.

   WhatsApp lets a business write first only with words Meta approved in
   advance: a template. KAAL's template (docs/whatsapp.md has it, word for
   word) fixes everything but two blanks:
     {{1}}  their first name, or "there"
     {{2}}  one paragraph: Claude's line for this person (lead-writer.js,
            writeWaLine), or the standard line below
   and its button opens thekaal.co on their number (?n=7).

   What comes back (POST /wa/webhook, signed by Meta with the app secret):
   - "stop", or the Stop button: never written to again, by WhatsApp or
     email (the same stop:<person> key the desk sets), and told so once.
   - Anything else: a phone alert to the owner with their words, who
     answers from KAAL's own WhatsApp.
   - A message Meta could not deliver: a phone alert, so it is not a
     silent loss.

   Raw HTTP and Web Crypto, like everything else in this worker.
   ══════════════════════════════════════════════════════════════════ */
import { waNumber, inWords } from "./mail.js";
import { notifyOwner } from "./push.js";

const enc = new TextEncoder();
const GRAPH = (env) => `https://graph.facebook.com/${env.WHATSAPP_GRAPH || "v23.0"}`;
const TIMEOUT_MS = 15000;

/* On when switched on and the token is in place. The phone number ID is
   WHATSAPP_PHONE_ID if given, else the one the connection check found
   from the token alone (waPhoneId). */
export function waOn(env) {
  return env.WHATSAPP_NEARLY === "on" && !!env.WHATSAPP_TOKEN;
}
export async function waPhoneId(env) {
  if (env.WHATSAPP_PHONE_ID) return String(env.WHATSAPP_PHONE_ID);
  if (!env.KAAL_STATE) return "";
  return (await env.KAAL_STATE.get("wa:phoneid").catch(() => null)) || "";
}
/* Switched on, a token, and a phone number to send from. */
export async function waReady(env) {
  return waOn(env) ? await waPhoneId(env) : "";
}
export function waTemplate(env) { return env.WHATSAPP_TEMPLATE || "kaal_nearly"; }

const pad = (n) => { n = parseInt(n, 10) || 0; return n < 10 ? "0" + n : String(n); };
const isAre = (n) => n === 1 ? "is" : "are";
const nos = (a) => { const s = a.map(n => "No. " + pad(n)); return s.length < 2 ? s.join("") : s.slice(0, -1).join(", ") + " and " + s[s.length - 1]; };

/* The line written for every case, when Claude does not write it. The
   same truths as the standard email (mail.js buyerNearlyBought). */
export function waStandardLine(d) {
  const left = d.left, leftW = inWords(left);
  const No = d.n ? "No. " + pad(d.n) : "";
  if (d.n && d.open) {
    return `You chose ${No}${d.dial ? `, the ${d.dial} dial,` : ""} and stopped at payment. It is still unclaimed, ${leftW} of the twenty ${isAre(left)} left, and the design is never made again.`;
  }
  if (d.n) {
    const same = (d.sameDial || []).slice().sort((a, b) => a - b);
    const dialLine = !d.dial ? "" : same.length ? ` If it was the ${d.dial} dial that held you, ${nos(same)} still ${same.length === 1 ? "carries" : "carry"} it.` : "";
    return `You chose ${No} and stopped at payment. Since then someone else completed it, and it will not be made again.${dialLine} Of the twenty, ${leftW} ${isAre(left)} left.`;
  }
  return `You got as far as payment and stopped. ${leftW.charAt(0).toUpperCase() + leftW.slice(1)} of the twenty ${isAre(left)} left, and the design is never made again.`;
}

/* A template blank refuses line breaks, tabs and runs of four spaces. */
export function blank(s, max) {
  return String(s || "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max);
}
/* The number the button opens: the one they chose if it is still open,
   else the lowest open number of the same dial, else none (0). */
export function buttonNumber(d) {
  if (d.n && d.open) return d.n;
  const same = (d.sameDial || []).slice().sort((a, b) => a - b);
  return same[0] || 0;
}

/* The whole message as the buyer will read it, for the command centre's
   log and its review queue. Must match the template in docs/whatsapp.md. */
export function waPreview(d, line, site) {
  return `Hello ${d.first || "there"}, this is KAAL.\n\n${blank(line, 600)}\n\n` +
    "Seven days to live with it, and every rupee back if it is not for you. Two years on the movement. Delivery across India included.\n\n" +
    "This is the only message we will send about it. If paying went wrong, reply here and a person will answer.\n\n" +
    `[See the number] ${site || "https://thekaal.co"}/?utm_source=whatsapp&utm_medium=nearly&n=${buttonNumber(d)}\n[Stop]`;
}

/* Send the nearly-bought template. { ok, id } or { ok:false, why, code },
   never throws. `to`: the phone they gave, as typed. */
export async function sendNearlyWa(env, to, d, line) {
  const wa = waNumber(to);
  if (!wa) return { ok: false, why: "no usable phone" };
  const body = {
    messaging_product: "whatsapp", recipient_type: "individual", to: wa, type: "template",
    template: {
      name: waTemplate(env), language: { code: env.WHATSAPP_LANG || "en" },
      components: [
        { type: "body", parameters: [{ type: "text", text: blank(d.first || "there", 40) }, { type: "text", text: blank(line, 600) }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: String(buttonNumber(d)) }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: "STOP" }] }
      ]
    }
  };
  return graphSend(env, body);
}

/* A free reply, allowed only inside the 24 hours after they wrote to us. */
export async function sendText(env, to, text) {
  const wa = waNumber(to);
  if (!wa) return { ok: false, why: "no usable phone" };
  return graphSend(env, { messaging_product: "whatsapp", recipient_type: "individual", to: wa, type: "text", text: { preview_url: false, body: String(text).slice(0, 1000) } });
}

async function graphSend(env, body) {
  let res, j;
  try {
    const pid = await waPhoneId(env);
    if (!pid) return { ok: false, why: "WhatsApp has no phone number yet (Command centre, Follow-ups, WhatsApp connection)" };
    res = await fetch(`${GRAPH(env)}/${pid}/messages`, {
      method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "content-type": "application/json", authorization: "Bearer " + env.WHATSAPP_TOKEN },
      body: JSON.stringify(body)
    });
    j = await res.json().catch(() => null);
  } catch (e) { return { ok: false, why: e && e.name === "TimeoutError" ? "timed out" : "unreachable" }; }
  const id = j && j.messages && j.messages[0] && j.messages[0].id;
  if (res.ok && id) return { ok: true, id };
  const err = (j && j.error) || {};
  return { ok: false, code: err.code || res.status, why: `WhatsApp refused it (${err.code || res.status}${err.message ? ": " + String(err.message).slice(0, 120) : ""})` };
}

/* ── Who a WhatsApp number belongs to: the person's hash (the one every
      key about them uses), kept when the note goes, so a "stop" sent from
      that phone stops the email too. ── */
async function sha256hex(s) {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(String(s)));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function rememberPhone(env, to, personHash, n) {
  const wa = waNumber(to);
  if (!wa || !env.KAAL_STATE) return;
  await env.KAAL_STATE.put("wap:" + (await sha256hex(wa)).slice(0, 32), JSON.stringify({ p: personHash, n: n || 0, at: new Date().toISOString() }),
    { expirationTtl: 400 * 86400 }).catch(() => null);
}
/* Someone who replied "stop" on WhatsApp, by their phone alone. */
export async function waStopped(env, to) {
  const wa = waNumber(to);
  if (!wa || !env.KAAL_STATE) return false;
  return !!(await env.KAAL_STATE.get("wastop:" + (await sha256hex(wa)).slice(0, 32)).catch(() => null));
}
/* What the email fallback needs, if Meta reports later that it failed. */
export async function rememberSent(env, id, rec) {
  if (!id || !env.KAAL_STATE) return;
  await env.KAAL_STATE.put("wamsg:" + id, JSON.stringify(rec), { expirationTtl: 3 * 86400 }).catch(() => null);
}
async function personOfPhone(env, wa) {
  return env.KAAL_STATE ? await env.KAAL_STATE.get("wap:" + (await sha256hex(wa)).slice(0, 32), "json").catch(() => null) : null;
}

/* ── POST /wa/webhook and its GET handshake ── */
async function signedByMeta(env, raw, header) {
  if (!env.WHATSAPP_APP_SECRET) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(String(header || ""));
  if (!m) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(env.WHATSAPP_APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)))].map(b => b.toString(16).padStart(2, "0")).join("");
  const want = m[1].toLowerCase();
  let diff = mac.length ^ want.length;
  for (let i = 0; i < mac.length && i < want.length; i++) diff |= mac.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

const STOP_WORDS = /^\s*(stop|unsubscribe|band karo|bandh karo|mat bhejo|no more|don'?t message|do not message)\s*[.!]?\s*$/i;

/* deps.onFailed(record): the worker's own fallback, the email, for a note
   Meta took and then could not deliver (record is what rememberSent kept). */
export async function waWebhook(request, env, ctx, deps) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env.WHATSAPP_VERIFY_TOKEN &&
      url.searchParams.get("hub.verify_token") === env.WHATSAPP_VERIFY_TOKEN;
    return new Response(ok ? String(url.searchParams.get("hub.challenge") || "") : "no", { status: ok ? 200 : 403 });
  }
  if (request.method !== "POST") return new Response("no", { status: 405 });
  const raw = await request.text();
  if (!(await signedByMeta(env, raw, request.headers.get("x-hub-signature-256")))) return new Response("bad signature", { status: 401 });
  let b; try { b = JSON.parse(raw); } catch (e) { return new Response("ok"); }
  /* Meta wants a 200 at once and retries otherwise; the work runs after. */
  const work = handle(env, b, deps || {}).catch(e => console.log("WhatsApp webhook:", String(e).slice(0, 160)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(work); else await work;
  return new Response("ok");
}

async function handle(env, b, deps) {
  for (const entry of (b && b.entry) || []) for (const ch of entry.changes || []) {
    const v = ch.value || {};
    const pid = await waPhoneId(env);
    if (pid && v.metadata && v.metadata.phone_number_id && String(v.metadata.phone_number_id) !== pid) continue;
    const names = {};
    for (const c of v.contacts || []) names[c.wa_id] = c.profile && c.profile.name;
    for (const m of v.messages || []) await inbound(env, m, names[m.from] || "");
    for (const s of v.statuses || []) if (s.status === "failed") {
      const e = (s.errors || [])[0] || {};
      const rec = env.KAAL_STATE ? await env.KAAL_STATE.get("wamsg:" + s.id, "json").catch(() => null) : null;
      if (rec) await env.KAAL_STATE.delete("wamsg:" + s.id).catch(() => null);
      const mailed = rec && deps.onFailed ? await deps.onFailed(rec, `${e.title || e.message || "not delivered"} (${e.code || "?"})`).catch(() => false) : false;
      await notifyOwner(env, { kind: "system", title: "A WhatsApp note did not arrive",
        body: `To +${s.recipient_id}: ${e.title || e.message || "Meta could not deliver it"} (${e.code || "?"}). ${mailed ? "The email went instead." : "Nothing else was sent."}`, tag: "wa-fail-" + s.id });
    }
  }
}

async function inbound(env, m, name) {
  if (!env.KAAL_STATE || !m || !m.from) return;
  const seen = "wain:" + m.id;
  if (await env.KAAL_STATE.get(seen).catch(() => null)) return;          // Meta retries; once is once
  await env.KAAL_STATE.put(seen, "1", { expirationTtl: 7 * 86400 }).catch(() => null);
  const text = m.type === "text" ? String((m.text && m.text.body) || "")
    : m.type === "button" ? String((m.button && (m.button.payload || m.button.text)) || "")
    : m.type === "interactive" ? String((m.interactive && ((m.interactive.button_reply || {}).id || (m.interactive.button_reply || {}).title)) || "")
    : "";
  const who = await personOfPhone(env, m.from);
  if (STOP_WORDS.test(text) || /^STOP$/.test(text)) {
    if (who && who.p) await env.KAAL_STATE.put("stop:" + who.p, JSON.stringify({ at: new Date().toISOString(), via: "whatsapp" })).catch(() => null);
    await env.KAAL_STATE.put("wastop:" + (await sha256hex(m.from)).slice(0, 32), "1").catch(() => null);
    await sendText(env, m.from, "Understood. KAAL will not write to you again.");
    await notifyOwner(env, { kind: "checkout", title: "WhatsApp: asked not to be written to", body: `${name || "+" + m.from} replied stop. Nothing more goes to them.`, tag: "wa-stop-" + m.from });
    return;
  }
  await notifyOwner(env, { kind: "checkout", title: `WhatsApp reply${who && who.n ? ", No. " + pad(who.n) : ""}`,
    body: `${name || "+" + m.from}: ${text ? text.slice(0, 180) : "(" + m.type + ")"}. Answer them from KAAL's WhatsApp within 24 hours.`, tag: "wa-in-" + m.from, urgency: "high" });
}


/* ══════════════════════════════════════════════════════════════════
   THE CONNECTION CHECK (Command centre, Follow-ups, WhatsApp connection)

   Meta's setup is a dozen screens; most of it the worker can do itself
   once it has the one token. From the token alone it finds the WhatsApp
   account and KAAL's number (WHATSAPP_NUMBER, 919311416678), then says,
   step by step in plain words, what is done and what is not, and does
   each step that is not, with one button:
     verify    a code by SMS to the number, then typed in
     register  the number on WhatsApp's Cloud API, with a 6-digit PIN
     replies   the app subscribed to the account, and the webhook set to
               this worker (Meta then calls GET /wa/webhook to check)
     template  kaal_nearly sent to Meta for approval, word for word
   A number that also runs the WhatsApp Business app (coexistence) is
   already registered and is never registered again from here.
   ══════════════════════════════════════════════════════════════════ */
const digits = (s) => String(s || "").replace(/\D/g, "");
const wantNumber = (env) => digits(env.WHATSAPP_NUMBER || "919311416678");
export const TEMPLATE_BODY = "Hello {{1}}, this is KAAL.\n\n{{2}}\n\nSeven days to live with it, and every rupee back if it is not for you. Two years on the movement. Delivery across India included.\n\nThis is the only message we will send about it. If paying went wrong, reply here and a person will answer.";

async function graph(env, method, path, opts = {}) {
  const url = new URL(`${GRAPH(env)}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(opts.query || {})) url.searchParams.set(k, v);
  const token = opts.token || env.WHATSAPP_TOKEN;
  if (!opts.noAuth) url.searchParams.set("access_token", token);
  let res, j;
  try {
    res = await fetch(url.toString(), {
      method, signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: opts.body ? { "content-type": "application/json" } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    j = await res.json().catch(() => null);
  } catch (e) { return { ok: false, why: e && e.name === "TimeoutError" ? "Meta did not answer in time" : "Meta could not be reached" }; }
  if (res.ok && j && !j.error) return { ok: true, j };
  const err = (j && j.error) || {};
  return { ok: false, code: err.code, why: String(err.error_user_msg || err.message || ("HTTP " + res.status)).slice(0, 240) };
}

/* Everything Meta knows about the connection, found from the token. */
async function discover(env) {
  const out = { keys: {
    token: !!env.WHATSAPP_TOKEN, secret: !!env.WHATSAPP_APP_SECRET, verify: !!env.WHATSAPP_VERIFY_TOKEN,
    on: env.WHATSAPP_NEARLY === "on", claude: !!env.ANTHROPIC_API_KEY } };
  if (!env.WHATSAPP_TOKEN) return out;
  const dt = await graph(env, "GET", "debug_token", { query: { input_token: env.WHATSAPP_TOKEN } });
  if (!dt.ok) { out.tokenWhy = dt.why; return out; }
  const t = dt.j.data || {};
  const scopes = t.scopes || [];
  out.token = { valid: !!t.is_valid, app: t.app_id ? String(t.app_id) : "", never: !t.expires_at || t.expires_at === 0,
    expires: t.expires_at ? new Date(t.expires_at * 1000).toISOString().slice(0, 10) : "",
    messaging: scopes.includes("whatsapp_business_messaging"), management: scopes.includes("whatsapp_business_management") };
  const wabas = new Set();
  for (const g of t.granular_scopes || []) if (/^whatsapp_business_(management|messaging)$/.test(g.scope)) for (const id of g.target_ids || []) wabas.add(String(id));
  if (!wabas.size && env.WHATSAPP_WABA_ID) wabas.add(String(env.WHATSAPP_WABA_ID));
  out.accounts = [...wabas];
  const want = wantNumber(env);
  for (const waba of out.accounts) {
    const pn = await graph(env, "GET", `${waba}/phone_numbers`, { query: { fields: "id,display_phone_number,verified_name,status,code_verification_status,platform_type,name_status,quality_rating,messaging_limit_tier" } });
    if (!pn.ok) continue;
    for (const p of pn.j.data || []) {
      out.numbers = (out.numbers || []).concat(digits(p.display_phone_number));
      if (digits(p.display_phone_number).endsWith(want.slice(-10))) { out.waba = waba; out.phone = p; }
    }
    if (out.phone) break;
  }
  if (!out.phone) return out;
  if (env.KAAL_STATE) {
    if (!env.WHATSAPP_PHONE_ID || env.WHATSAPP_PHONE_ID !== out.phone.id) await env.KAAL_STATE.put("wa:phoneid", String(out.phone.id)).catch(() => null);
    await env.KAAL_STATE.put("wa:waba", out.waba).catch(() => null);
  }
  const subs = await graph(env, "GET", `${out.waba}/subscribed_apps`);
  out.subscribed = subs.ok && (subs.j.data || []).some(a => String((a.whatsapp_business_api_data || {}).id || a.id || "") === out.token.app);
  if (env.WHATSAPP_APP_SECRET && out.token.app) {
    const hooks = await graph(env, "GET", `${out.token.app}/subscriptions`, { token: `${out.token.app}|${env.WHATSAPP_APP_SECRET}` });
    out.hookWhy = hooks.ok ? "" : hooks.why;
    const h = hooks.ok ? (hooks.j.data || []).find(x => x.object === "whatsapp_business_account") : null;
    out.webhook = h ? { active: !!h.active, url: h.callback_url || "", messages: (h.fields || []).some(f => (f.name || f) === "messages") } : null;
  }
  const tp = await graph(env, "GET", `${out.waba}/message_templates`, { query: { name: waTemplate(env), fields: "name,status,language,category,rejected_reason" } });
  out.template = tp.ok ? ((tp.j.data || []).find(x => x.name === waTemplate(env)) || null) : null;
  out.templateWhy = tp.ok ? "" : tp.why;
  return out;
}

/* Plain-words steps for the owner, each done or not, with the button that
   does it where the worker can. */
export async function waConnection(env, site, workerUrl) {
  const D = await discover(env);
  const k = D.keys, steps = [];
  const add = (id, done, title, detail, action) => steps.push({ id, done: !!done, title, detail, action: done ? "" : (action || "") });
  add("keys", k.token && k.secret && k.verify, "The three WhatsApp keys are in GitHub",
    k.token && k.secret && k.verify ? "WHATSAPP_TOKEN, WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN are in the worker."
      : "Missing: " + [!k.token && "WHATSAPP_TOKEN", !k.secret && "WHATSAPP_APP_SECRET", !k.verify && "WHATSAPP_VERIFY_TOKEN"].filter(Boolean).join(", ") + ". Add them in GitHub (Settings, Secrets and variables, Actions), then run setup-worker in mode live.");
  if (!k.token) return { ok: true, ready: false, steps, number: "+" + wantNumber(env) };
  const t = D.token;
  add("token", t && t.valid && t.messaging && t.management && t.never, "The token works, has both permissions, and never expires",
    !t ? "Meta did not accept the token: " + (D.tokenWhy || "unknown") + ". Make a new one (System users, kaal-worker, Generate token) and replace WHATSAPP_TOKEN."
      : !t.valid ? "Meta says this token is not valid any more. Make a new one and replace WHATSAPP_TOKEN."
      : !(t.messaging && t.management) ? "The token is missing " + [!t.messaging && "whatsapp_business_messaging", !t.management && "whatsapp_business_management"].filter(Boolean).join(" and ") + ". Generate it again with both ticked."
      : !t.never ? `This token expires on ${t.expires}. Make one from System users with expiry Never, and replace WHATSAPP_TOKEN.`
      : "Good.");
  if (!t || !t.valid) return { ok: true, ready: false, steps, number: "+" + wantNumber(env) };
  const p = D.phone;
  add("number", p, `+${wantNumber(env)} is in your WhatsApp account`,
    p ? `Found as ${p.display_phone_number}${p.verified_name ? `, name "${p.verified_name}"` : ""}${p.name_status ? ` (name ${String(p.name_status).toLowerCase().replace(/_/g, " ")})` : ""}.`
      : !(D.accounts || []).length ? "The token can see no WhatsApp account. In System users, kaal-worker, Assign assets, give it your WhatsApp account with full control, then press Check again."
      : `The token sees ${(D.accounts || []).length} WhatsApp account(s) but not this number${(D.numbers || []).length ? " (it sees " + D.numbers.map(n => "+" + n).join(", ") + ")" : ""}. Add the number in WhatsApp Manager, Phone numbers, Add phone number, then press Check again.`);
  if (!p) return { ok: true, ready: false, steps, number: "+" + wantNumber(env) };
  const onApp = p.platform_type === "CLOUD_API" && p.status === "CONNECTED";
  const verified = onApp || p.code_verification_status === "VERIFIED";
  add("verify", verified, "Meta has checked the number is yours",
    verified ? "Verified." : "Meta has not verified this number yet. Press Send code: a 6-digit code comes by SMS to the number. Type it in and press Verify.", "verify");
  add("register", onApp, "The number is switched on for sending",
    onApp ? `Connected${p.quality_rating ? `, quality ${String(p.quality_rating).toLowerCase()}` : ""}${p.messaging_limit_tier ? `, limit ${String(p.messaging_limit_tier).replace("TIER_", "").toLowerCase()} people a day` : ""}.`
      : `Status: ${String(p.status || "unknown").toLowerCase()}. Choose any 6 digits as the number's PIN (write it down: Meta asks for it if the number moves) and press Register.`, verified ? "register" : "");
  const hookOk = D.webhook && D.webhook.active && D.webhook.messages && D.webhook.url === `${workerUrl}/wa/webhook`;
  add("replies", D.subscribed && hookOk, "Replies and Stop come back to the worker",
    D.subscribed && hookOk ? "Connected: replies reach your phone as alerts, and Stop stops everything."
      : !k.secret ? "Needs WHATSAPP_APP_SECRET first."
      : D.hookWhy ? "Meta refused to show the webhook: " + D.hookWhy + ". Check WHATSAPP_APP_SECRET is the App secret of the same app the token was made in."
      : "Not yet. Press Connect replies.", k.secret && k.verify && !D.hookWhy ? "replies" : "");
  const tpl = D.template, st = tpl ? String(tpl.status || "").toUpperCase() : "";
  add("template", st === "APPROVED", `The message template "${waTemplate(env)}" is approved`,
    st === "APPROVED" ? "Approved by Meta."
      : st === "PENDING" || st === "IN_APPEAL" ? "Sent to Meta, waiting for approval: usually minutes, sometimes a day. Press Check again later."
      : st === "REJECTED" ? `Meta rejected it${tpl.rejected_reason && tpl.rejected_reason !== "NONE" ? ": " + tpl.rejected_reason : ""}. Tell Claude the reason; the words can be changed.`
      : st ? `Status: ${st.toLowerCase()}.` : D.templateWhy ? "Could not read the templates: " + D.templateWhy : "Not made yet. Press Create template: it goes to Meta word for word.", !tpl && !D.templateWhy ? "template" : "");
  add("on", k.on, "Switched on in the worker", k.on ? "WHATSAPP_NEARLY is on." : "WHATSAPP_NEARLY is off in wrangler.toml.");
  const ready = steps.every(x => x.done);
  return { ok: true, ready, steps, number: "+" + wantNumber(env), claude: k.claude, onApp: p.platform_type, hookUrl: `${workerUrl}/wa/webhook` };
}

/* The buttons. Each returns { ok, why } in plain words. */
export async function waFix(env, action, b, workerUrl) {
  if (!env.WHATSAPP_TOKEN) return { ok: false, why: "WHATSAPP_TOKEN is not in the worker yet." };
  const D = await discover(env);
  const p = D.phone;
  if (action === "verify-send") {
    if (!p) return { ok: false, why: "The number was not found in your WhatsApp account." };
    const r = await graph(env, "POST", `${p.id}/request_code`, { body: { code_method: "SMS", language: "en_US" } });
    return r.ok ? { ok: true, why: `A code is on its way by SMS to ${p.display_phone_number}. Type it in and press Verify.` } : { ok: false, why: "Meta refused to send a code: " + r.why };
  }
  if (action === "verify-code") {
    const code = digits(b.code);
    if (!p || code.length !== 6) return { ok: false, why: "Type the 6-digit code from the SMS." };
    const r = await graph(env, "POST", `${p.id}/verify_code`, { body: { code } });
    return r.ok ? { ok: true, why: "Verified." } : { ok: false, why: "Meta did not accept the code: " + r.why };
  }
  if (action === "register") {
    const pin = digits(b.pin);
    if (!p || pin.length !== 6) return { ok: false, why: "Choose 6 digits for the PIN." };
    if (p.platform_type === "CLOUD_API" && p.status === "CONNECTED") return { ok: true, why: "Already switched on; nothing changed." };
    const r = await graph(env, "POST", `${p.id}/register`, { body: { messaging_product: "whatsapp", pin } });
    return r.ok ? { ok: true, why: "Registered. Keep the PIN somewhere safe." } : { ok: false, why: "Meta refused to register it: " + r.why };
  }
  if (action === "replies") {
    if (!D.waba || !D.token || !D.token.app) return { ok: false, why: "The WhatsApp account was not found from the token." };
    if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_VERIFY_TOKEN) return { ok: false, why: "WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN must be in the worker first." };
    const s1 = await graph(env, "POST", `${D.waba}/subscribed_apps`);
    if (!s1.ok) return { ok: false, why: "Meta refused to connect the app to the account: " + s1.why };
    const url = new URL(`${GRAPH(env)}/${D.token.app}/subscriptions`);
    const form = new URLSearchParams({ object: "whatsapp_business_account", callback_url: `${workerUrl}/wa/webhook`, verify_token: env.WHATSAPP_VERIFY_TOKEN,
      fields: "messages", include_values: "true", access_token: `${D.token.app}|${env.WHATSAPP_APP_SECRET}` });
    let res, j;
    try { res = await fetch(url.toString(), { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS), body: form }); j = await res.json().catch(() => null); }
    catch (e) { return { ok: false, why: "Meta could not be reached." }; }
    if (!res.ok || !j || j.error) return { ok: false, why: "Meta refused the webhook: " + String((j && j.error && (j.error.error_user_msg || j.error.message)) || res.status).slice(0, 200) };
    return { ok: true, why: "Replies and Stop now come back to the worker." };
  }
  if (action === "template") {
    if (!D.waba) return { ok: false, why: "The WhatsApp account was not found from the token." };
    const r = await graph(env, "POST", `${D.waba}/message_templates`, { body: {
      name: waTemplate(env), language: env.WHATSAPP_LANG || "en", category: "MARKETING",
      components: [
        { type: "BODY", text: TEMPLATE_BODY, example: { body_text: [["Rohan", "You chose No. 13, the Champagne dial, and stopped at payment. It is still unclaimed, eight of the twenty are left, and the design is never made again."]] } },
        { type: "BUTTONS", buttons: [
          { type: "URL", text: "See the number", url: "https://thekaal.co/?utm_source=whatsapp&utm_medium=nearly&n={{1}}", example: ["https://thekaal.co/?utm_source=whatsapp&utm_medium=nearly&n=13"] },
          { type: "QUICK_REPLY", text: "Stop" }
        ] }
      ] } });
    return r.ok ? { ok: true, why: "Sent to Meta for approval. Usually minutes; press Check again later." } : { ok: false, why: "Meta refused the template: " + r.why };
  }
  return { ok: false, why: "Unknown step." };
}
