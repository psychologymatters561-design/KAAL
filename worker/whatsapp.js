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

/* On only when switched on and every key is in place. */
export function waOn(env) {
  return env.WHATSAPP_NEARLY === "on" && !!env.WHATSAPP_TOKEN && !!env.WHATSAPP_PHONE_ID;
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
    res = await fetch(`${GRAPH(env)}/${env.WHATSAPP_PHONE_ID}/messages`, {
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
    if (env.WHATSAPP_PHONE_ID && v.metadata && v.metadata.phone_number_id && String(v.metadata.phone_number_id) !== String(env.WHATSAPP_PHONE_ID)) continue;
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
