/* ══════════════════════════════════════════════════════════════════
   KAAL · THE CONTROL ROOM (the page)

   Served by the worker at /control (worker/control.js decides who may
   see what). One document, styles and script inline, nothing fetched
   from any other site; the script carries the nonce the worker's CSP
   names. ES5-shaped like the storefront. Every value that came from a
   buyer is escaped before it is placed.

   Built for one person running the business from a phone: calm, dense,
   fast. One tap marks a stage; a ten second Undo holds it back before it
   is sent; nothing moves on this page except that countdown.
   Keyboard: 1 to 8 switch screens, u undoes, r refreshes, / searches.
   ══════════════════════════════════════════════════════════════════ */

export function controlPage(nonce, opts) {
  const staging = !!(opts && opts.staging);
  return String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0c0a">
<title>KAAL · Control</title>
<link rel="icon" href="data:,">
<style>
:root{
  --bg:#0b0c0a; --card:#121310; --card2:#171813; --line:#26231f; --line2:#3a352d;
  --bone:#EDE8DF; --mute:#B3AC9F; --faint:#8f897e; --gold:#C6A15B; --goldLit:#E0BE7C;
  --ok:#86B592; --warn:#E0BE7C; --bad:#E08A70;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --ease:cubic-bezier(.16,1,.3,1);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--bone);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
a{color:var(--goldLit)}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--goldLit);outline-offset:2px}
.wrap{max-width:820px;margin:0 auto;padding:max(14px,env(safe-area-inset-top)) 16px calc(90px + env(safe-area-inset-bottom))}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}
.mark{font-weight:300;letter-spacing:.55em;font-size:13px}
.mark span{letter-spacing:.2em;color:var(--gold);margin-left:.4em;font-size:11px;text-transform:uppercase}
.stg{background:#3a2a12;color:var(--goldLit);font-size:12px;padding:6px 10px;border-radius:6px;margin-bottom:12px}
h1{font-weight:400;font-size:20px;margin:6px 0 12px}
h2{font-weight:500;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:var(--mute);margin:22px 0 8px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:10px}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.sp{flex:1}
.muted{color:var(--mute)}.faint{color:var(--faint)}.small{font-size:13px}
.num{font-variant-numeric:tabular-nums;font-family:var(--mono)}
.btn{min-height:44px;padding:10px 16px;border-radius:8px;border:1px solid var(--line2);background:var(--card2);cursor:pointer}
.btn.go{background:var(--bone);color:#111;border-color:var(--bone);font-weight:600}
.btn.warn{border-color:#6b3a2c;color:var(--bad)}
.btn.ghost{background:transparent}
.btn[disabled]{opacity:.45;cursor:default}
input,select,textarea{min-height:44px;width:100%;background:#0e0f0d;border:1px solid var(--line2);border-radius:8px;padding:10px 12px}
textarea{min-height:88px}
label{display:block;font-size:13px;color:var(--mute);margin:10px 0 4px}
.check{display:flex;gap:10px;align-items:center;min-height:44px}.check input{width:22px;min-height:22px}
.strip{display:grid;grid-template-columns:repeat(10,1fr);gap:4px}
.cell{aspect-ratio:1;border-radius:4px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:11px;font-family:var(--mono)}
.cell.sold{background:var(--bone);color:#111;border-color:var(--bone)}
.cell.held{border-color:var(--gold);color:var(--goldLit)}
.cell.unavailable,.cell.retired{opacity:.4;border-style:dashed}
.cell.stolen{background:#5a2418;border-color:var(--bad)}
.stats{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.stat b{display:block;font-size:22px;font-weight:400;font-variant-numeric:tabular-nums}
.stages{display:flex;gap:4px;margin:8px 0}
.stages i{flex:1;height:4px;border-radius:2px;background:var(--line2)}
.stages i.on{background:var(--gold)}
.pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);color:var(--mute);text-transform:uppercase;letter-spacing:.06em}
.pill.ok{color:var(--ok);border-color:#2e4a35}.pill.bad{color:var(--bad);border-color:#5a2e24}.pill.warn{color:var(--warn);border-color:#5a4724}
.tabs{position:fixed;left:0;right:0;bottom:0;background:rgba(11,12,10,.97);border-top:1px solid var(--line);display:flex;overflow-x:auto;padding:4px 6px calc(4px + env(safe-area-inset-bottom));z-index:5}
.tabs button{flex:1 0 auto;min-height:48px;min-width:72px;background:none;border:0;color:var(--mute);font-size:12px;letter-spacing:.04em;cursor:pointer}
.tabs button[aria-current="page"]{color:var(--bone);box-shadow:inset 0 2px 0 var(--gold)}
.toast{position:fixed;left:12px;right:12px;bottom:calc(70px + env(safe-area-inset-bottom));max-width:560px;margin:0 auto;background:var(--bone);color:#111;border-radius:10px;padding:12px 14px;display:flex;gap:12px;align-items:center;z-index:9;box-shadow:0 8px 30px rgba(0,0,0,.5)}
.toast .btn{background:#111;color:var(--bone);border-color:#111;min-height:40px}
.bar{height:3px;background:#111;opacity:.25;border-radius:2px;margin-top:6px;transform-origin:left;transition:transform 10s linear}
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:8;display:flex;align-items:flex-end;justify-content:center}
.sheet .in{background:var(--card);width:100%;max-width:820px;max-height:92vh;overflow:auto;border-radius:14px 14px 0 0;padding:16px}
iframe{width:100%;height:70vh;border:1px solid var(--line2);border-radius:8px;background:#F4F1EA}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);vertical-align:top}
.err{color:var(--bad);min-height:1.4em;font-size:14px}
.key{font-family:var(--mono);font-size:18px;letter-spacing:.08em;word-break:break-all}
.gate{max-width:420px;margin:12vh auto 0}
@media (min-width:700px){.stats{grid-template-columns:repeat(4,1fr)}.strip{grid-template-columns:repeat(20,1fr)}}
@media (prefers-reduced-motion:reduce){.bar{transition:none}}
</style>
</head>
<body>
<div class="wrap">
  <div class="top"><div class="mark">KAAL<span>Control</span></div><button class="btn ghost small" id="out" hidden>Sign out</button></div>
  ${staging ? '<div class="stg">Staging: Razorpay test mode. Every email goes to the owner only.</div>' : ""}

  <section class="gate" id="gate" hidden>
    <h1 id="gateT">Sign in</h1>
    <form id="fEmail"><label for="email">Email</label><input id="email" type="email" autocomplete="email" required>
      <p class="muted small">A six-digit code comes to this address. It works once, for ten minutes.</p>
      <button class="btn go" type="submit">Send the code</button></form>
    <form id="fCode" hidden><label for="code">The code from the email</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
      <button class="btn go" type="submit">Continue</button> <button class="btn ghost" type="button" id="again">Send another</button></form>
    <div id="enroll" hidden><p>Add KAAL to your authenticator app (Google Authenticator, 1Password, Authy). Tap the link on this phone, or type the key.</p>
      <p><a id="otp" class="btn" href="#">Open in authenticator app</a></p><p class="key" id="key"></p></div>
    <form id="fTotp" hidden><label for="totp">The six digits your authenticator app shows for KAAL</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
      <button class="btn go" type="submit">Open the control room</button></form>
    <p class="err" id="gateErr" role="alert"></p>
  </section>

  <main id="app" hidden>
    <section data-v="overview"></section>
    <section data-v="orders" hidden></section>
    <section data-v="pieces" hidden></section>
    <section data-v="owners" hidden></section>
    <section data-v="approvals" hidden></section>
    <section data-v="emails" hidden></section>
    <section data-v="settings" hidden></section>
    <section data-v="audit" hidden></section>
  </main>
</div>
<nav class="tabs" id="tabs" hidden aria-label="Screens">
  <button data-go="overview">Overview</button><button data-go="orders">Orders</button><button data-go="pieces">Pieces</button><button data-go="owners">Owners</button>
  <button data-go="approvals">Approvals</button><button data-go="emails">Emails</button><button data-go="settings">Settings</button><button data-go="audit">Audit</button>
</nav>
<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<div class="sheet" id="sheet" hidden><div class="in" role="dialog" aria-modal="true" aria-labelledby="sheetT"><div class="row"><h1 id="sheetT" class="sp"></h1><button class="btn ghost" data-act="close">Close</button></div><div id="sheetB"></div></div></div>

<script nonce="${nonce}">
(function(){
"use strict";
var $ = function(id){ return document.getElementById(id); };
function esc(v){ return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function pad(n){ n = +n; return n < 10 ? "0" + n : "" + n; }
function rupees(p){ return "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN"); }
function when(iso){ if(!iso) return ""; var d = new Date(iso); return d.toLocaleString("en-IN", { timeZone:"Asia/Kolkata", day:"numeric", month:"short", hour:"numeric", minute:"2-digit" }); }
var VIEW = "overview", DATA = {}, PENDING = null, EMAIL = "";
var NAMES = { inspected:"Inspected", packed:"Packed", dispatched:"Dispatched", delivered:"Delivered" };
var COURIERS = ["Shiprocket","Delhivery","Blue Dart","DTDC","India Post","Ekart","Xpressbees","Shadowfax"];

function api(method, path, body, raw){
  var o = { method: method, credentials: "same-origin", headers: { "X-KAAL": "1" } };
  if(raw){ o.body = raw; o.headers["Content-Type"] = raw.type; }
  else if(body !== undefined){ o.body = JSON.stringify(body); o.headers["Content-Type"] = "application/json"; }
  return fetch(path, o).then(function(r){ return r.json().catch(function(){ return { ok:false }; }).then(function(j){ j._status = r.status; return j; }); });
}
function say(msg, bad){ var t = $("toast"); t.innerHTML = '<span class="sp">' + esc(msg) + '</span>'; t.hidden = false; t.style.background = bad ? "#E08A70" : ""; clearTimeout(say.t); say.t = setTimeout(function(){ if(!PENDING) t.hidden = true; }, 3500); }

/* ── Signing in ── */
function gate(step, err){
  $("gate").hidden = false; $("app").hidden = true; $("tabs").hidden = true; $("out").hidden = step === "email";
  ["fEmail","fCode","fTotp","enroll"].forEach(function(id){ $(id).hidden = true; });
  $("gateErr").textContent = err || "";
  if(step === "email"){ $("fEmail").hidden = false; $("gateT").textContent = "Sign in"; $("email").focus(); }
  if(step === "code"){ $("fCode").hidden = false; $("gateT").textContent = "Check your email"; $("code").value = ""; $("code").focus(); }
  if(step === "enroll"){ $("enroll").hidden = false; $("fTotp").hidden = false; $("gateT").textContent = "One more lock";
    api("POST", "/auth/totp/enroll", {}).then(function(j){ if(j.ok){ $("key").textContent = j.key; $("otp").href = j.uri; } else $("gateErr").textContent = "Could not start the authenticator. Sign in again."; }); }
  if(step === "totp"){ $("fTotp").hidden = false; $("gateT").textContent = "Your authenticator"; $("totp").value = ""; $("totp").focus(); }
}
var WHY = { wrong:"That code is not right. Check it and try again.", expired:"That code has expired or was used. Ask for another.", tries:"Too many wrong tries for that code. Ask for another.",
  invalid:"That does not look like an email address.", rate:"Too many tries from here. Wait ten minutes.", used:"That code was already used. Wait for the next one.",
  locked:"Too many wrong codes. Sign in again from the start.", "not-admin":"This page is the admin's only." };
$("fEmail").addEventListener("submit", function(e){ e.preventDefault(); EMAIL = $("email").value.trim();
  api("POST", "/auth/start", { email: EMAIL }).then(function(j){ if(j.ok) gate("code"); else gate("email", WHY[j.reason] || "That did not work. Try again."); }); });
$("again").addEventListener("click", function(){ api("POST", "/auth/start", { email: EMAIL }).then(function(){ gate("code", "Another code is on its way."); }); });
$("fCode").addEventListener("submit", function(e){ e.preventDefault();
  api("POST", "/auth/verify", { email: EMAIL, code: $("code").value }).then(function(j){
    if(!j.ok){ gate(j.reason === "expired" || j.reason === "tries" ? "email" : "code", WHY[j.reason] || "That did not work."); return; }
    if(j.role !== "admin"){ gate("email", WHY["not-admin"]); return; }
    if(j.mfa === "none"){ start(); return; }
    gate(j.mfa === "enroll" ? "enroll" : "totp");
  }); });
$("fTotp").addEventListener("submit", function(e){ e.preventDefault();
  api("POST", "/auth/totp", { code: $("totp").value }).then(function(j){
    if(j.ok){ start(); return; }
    if(j.reason === "locked" || j._status === 401 && j.reason === "signed-out"){ gate("email", WHY.locked); return; }
    $("gateErr").textContent = WHY[j.reason] || "That code is not right."; $("totp").value = ""; });
});
$("out").addEventListener("click", function(){ api("POST", "/auth/logout", {}).then(function(){ gate("email"); }); });

function start(){
  $("gate").hidden = true; $("app").hidden = false; $("tabs").hidden = false; $("out").hidden = false;
  show(VIEW);
}
api("POST", "/auth/me", {}).then(function(j){
  if(j.ok && j.role === "admin" && j.mfa) start();
  else if(j.ok && j.role === "admin") gate(j.enrolled ? "totp" : "enroll");
  else gate("email");
});

/* ── Screens ── */
function show(v){
  VIEW = v;
  Array.prototype.forEach.call(document.querySelectorAll("[data-v]"), function(s){ s.hidden = s.getAttribute("data-v") !== v; });
  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function(b){ if(b.getAttribute("data-go") === v) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current"); });
  load(v);
}
function sec(v){ return document.querySelector('[data-v="' + v + '"]'); }
function load(v){
  var path = { overview:"/control/api/overview", orders:"/control/api/orders", pieces:"/control/api/pieces", owners:"/control/api/owners?q=" + encodeURIComponent(DATA.q || ""),
    approvals:"/control/api/approvals", emails:"/control/api/emails", settings:"/control/api/settings", audit:"/control/api/audit" }[v];
  api("GET", path).then(function(j){
    if(j._status === 401){ gate(j.reason === "mfa" ? "totp" : "email"); return; }
    if(!j.ok){ sec(v).innerHTML = '<p class="err">' + esc(j.why || "Could not load this. Pull down or press r to try again.") + "</p>"; return; }
    DATA[v] = j; RENDER[v](j);
  });
}
var RENDER = {};

RENDER.overview = function(j){
  var cells = j.pieces.map(function(p){ return '<div class="cell ' + esc(p.state) + '" title="No. ' + pad(p.number) + " · " + esc(p.colorway) + " · " + esc(p.status) + '">' + pad(p.number) + "</div>"; }).join("");
  var st = j.stages || {};
  var waiting = ["placed","inspected","packed","dispatched"].map(function(s){ return '<div class="card stat"><b>' + (st[s] || 0) + '</b><span class="muted small">' + s + "</span></div>"; }).join("");
  var wins = j.returnWindows.length ? j.returnWindows.map(function(w){ return "<tr><td>" + esc(w.piece) + '</td><td class="num">' + esc(w.delivered) + '</td><td class="num">' + w.daysLeft + " days left</td></tr>"; }).join("") : '<tr><td class="muted">None open.</td></tr>';
  var late = j.late.length ? j.late.map(function(o){ return '<div class="card"><span class="pill bad">late</span> ' + esc(o.piece) + " · " + esc(o.why) + "</div>"; }).join("") : "";
  late += (j.courier || []).map(function(c){ return '<div class="card"><span class="pill bad">courier</span> ' + esc(c.status) + " · tracking " + esc(c.awb) + (c.outcome === "unmatched" ? " · matched to no order" : "") + "</div>"; }).join("");
  var im = j.imported, imp = im && im.r ? im.r : null;
  var importCard = '<div class="card">' + (imp ? '<p class="small">Paid orders brought in from Razorpay ' + esc(when(im.at)) + ": " + (imp.imported || []).length + " new" +
      ((imp.needsRecord || []).length ? '. <b>To record by hand</b> (Orders, Record a past sale): No. ' + imp.needsRecord.map(pad).join(", No. ") : "") +
      ((imp.duplicates || []).length ? '. <b class="err">Two payments for one number</b>: ' + imp.duplicates.map(function(d){ return "No. " + pad(d.n) + " (" + esc(d.payment) + ")"; }).join(", ") + ". Check them in Razorpay." : "") + ".</p>"
    : '<p class="small">Bring the paid orders Razorpay already holds into the registry. Nothing is emailed to anyone.</p>') +
    '<button class="btn" data-act="import">' + (imp ? "Bring them in again" : "Bring in paid orders from Razorpay") + "</button></div>";
  sec("overview").innerHTML = "<h1>Overview</h1>" + late + importCard +
    '<div class="card"><div class="row"><span class="sp">' + j.sold + " of " + j.size + ' sold</span><span class="num muted">' + rupees(j.revenue) + "</span></div><div style=\"margin-top:10px\" class=\"strip\">" + cells + "</div></div>" +
    "<h2>Waiting at each stage</h2><div class=\"stats\">" + waiting + "</div>" +
    "<h2>Delivered, return window open</h2><div class=\"card\"><table>" + wins + "</table></div>" +
    '<h2>Needs a decision</h2><div class="card row"><span class="sp">Open approvals</span><b class="num">' + j.approvals + '</b></div><div class="card row"><span class="sp">Failed emails</span><b class="num">' + (j.emails.failed || 0) + "</b></div>" +
    "<h2>Health</h2>" + j.health.map(function(h){ return '<div class="card row"><span class="pill ' + (h.ok ? "ok" : "bad") + '">' + (h.ok ? "ok" : "check") + '</span><span class="sp">' + esc(h.label) + '</span><span class="muted small">' + esc(h.detail) + "</span></div>"; }).join("");
};

RENDER.orders = function(j){
  var head = '<div class="row"><h1 class="sp">Orders</h1><button class="btn" data-act="pastSale">Record a past sale</button></div>';
  if(!j.orders.length){ sec("orders").innerHTML = head + '<div class="card muted">No orders yet. A paid order appears here the moment Razorpay confirms it.</div>'; return; }
  sec("orders").innerHTML = head + j.orders.map(function(o){
    var idx = ["placed","inspected","packed","dispatched","delivered"].indexOf(o.status);
    var bars = [0,1,2,3,4].map(function(i){ return "<i" + (i <= idx ? ' class="on"' : "") + "></i>"; }).join("");
    var next = o.next ? '<button class="btn go" data-act="next" data-id="' + o.id + '" data-to="' + o.next + '">Mark ' + NAMES[o.next] + "</button>" : "";
    var prev = o.next ? '<button class="btn ghost" data-act="preview" data-id="' + o.id + '" data-to="' + o.next + '">Preview email</button>' : "";
    var ret = o.returnOpen ? '<button class="btn warn" data-act="returned" data-id="' + o.id + '">Mark returned</button>' : "";
    var refund = !o.refund_id && o.status !== "registered" && !/^manual:/.test(o.razorpay_payment_id || "") ? '<button class="btn warn ghost" data-act="refund" data-id="' + o.id + '" data-n="' + pad(o.number) + '">Refund</button>' : "";
    var addr = [o.address_line1, o.address_line2, o.city, o.state, o.pincode].filter(Boolean).join(", ");
    return '<div class="card"><div class="row"><b class="num">No. ' + pad(o.number) + '</b><span class="muted">' + esc(o.colorway) + '</span><span class="sp"></span><span class="pill' + (o.status === "cancelled" || o.status === "returned" ? " bad" : "") + '">' + esc(o.status) + (o.cancel_reason ? " · " + esc(o.cancel_reason) : "") + "</span></div>" +
      '<div class="stages">' + bars + "</div>" +
      '<div class="small">' + esc(o.buyer_name || "") + ' <span class="muted">' + esc(o.email || "") + " " + esc(o.phone || "") + "</span></div>" +
      (addr ? '<div class="small muted">' + esc(addr) + "</div>" : "") +
      (o.gift ? '<div class="small"><span class="pill warn">gift</span> ' + esc(o.gift_note || "") + "</div>" : "") +
      '<div class="small faint">Paid ' + esc(when(o.paid_at)) + " · " + rupees(o.amount_paise) + (o.tracking_number ? " · " + esc(o.courier) + " " + esc(o.tracking_number) : "") + (o.delivered_on ? " · delivered " + esc(o.delivered_on) : "") + (o.refund_id ? " · refunded " + esc(o.refund_id) : "") + "</div>" +
      '<div class="row" style="margin-top:10px">' + next + prev + '<button class="btn ghost" data-act="correct" data-id="' + o.id + '">Change without email</button>' + ret + refund + "</div></div>";
  }).join("");
};

/* The one-tap stage, with the ten second Undo. Dispatched and Delivered
   ask their one or three questions first. */
function order(id){ return (DATA.orders.orders || []).filter(function(o){ return o.id === id; })[0]; }
function nextStage(id, to){
  var o = order(id);
  if(to === "dispatched"){
    sheet("No. " + pad(o.number) + " dispatched", '<label for="cr">Courier</label><select id="cr">' + COURIERS.map(function(c){ return "<option>" + c + "</option>"; }).join("") + "</select>" +
      '<label for="tn">Tracking number</label><input id="tn" autocomplete="off"><label for="tu">Tracking link</label><input id="tu" type="url" placeholder="https://" autocomplete="off">' +
      '<p class="err" id="sheetErr"></p><div class="row"><button class="btn go" data-act="dispatchGo" data-id="' + id + '">Mark dispatched</button><button class="btn ghost" data-act="previewD" data-id="' + id + '">Preview email</button></div>');
    return;
  }
  if(to === "delivered"){
    sheet("No. " + pad(o.number) + " delivered", '<label for="dd">Delivered on</label><input id="dd" type="date" value="' + esc(DATA.orders.today) + '" max="' + esc(DATA.orders.today) + '">' +
      '<p class="muted small">This starts the warranty and the seven day return window. The owner is emailed the registration link at once.</p>' +
      '<p class="err" id="sheetErr"></p><button class="btn go" data-act="deliverGo" data-id="' + id + '">Mark delivered</button>');
    return;
  }
  hold(id, { to: to }, "No. " + pad(o.number) + " marked " + NAMES[to] + ". The email goes in");
}
function hold(id, payload, label){
  if(PENDING) commit();
  var t = $("toast"), left = 10;
  t.style.background = ""; t.hidden = false;
  t.innerHTML = '<div class="sp"><span id="tl">' + esc(label) + ' <span class="num" id="tc">10</span>s.</span><div class="bar" id="tb"></div></div><button class="btn" data-act="undo">Undo</button>';
  requestAnimationFrame(function(){ var b = $("tb"); if(b) b.style.transform = "scaleX(0)"; });
  PENDING = { id: id, payload: payload, timer: setInterval(function(){ left--; var c = $("tc"); if(c) c.textContent = left; if(left <= 0) commit(); }, 1000) };
}
function undo(){ if(!PENDING) return; clearInterval(PENDING.timer); PENDING = null; say("Undone. Nothing was changed or sent."); }
function commit(keepalive){
  if(!PENDING) return; var p = PENDING; PENDING = null; clearInterval(p.timer); $("toast").hidden = true;
  var o = { method:"POST", credentials:"same-origin", keepalive: !!keepalive, headers:{ "X-KAAL":"1", "Content-Type":"application/json" }, body: JSON.stringify(p.payload) };
  fetch("/control/api/orders/" + p.id + "/stage", o).then(function(r){ return r.json(); }).then(function(j){
    if(!j.ok){ say(j.why || "That did not save. Nothing was sent.", true); load("orders"); return; }
    say(j.letter === "queued" ? "Saved. The email is on its way." : "Saved.");
    load(VIEW);
  }).catch(function(){ say("That did not reach the server. Nothing was sent; try again.", true); });
}
/* Leaving the page with an action counting down: it was not undone, so it goes. */
addEventListener("pagehide", function(){ if(PENDING) commit(true); });

RENDER.pieces = function(j){
  sec("pieces").innerHTML = "<h1>Pieces</h1>" + j.pieces.map(function(p){
    return '<div class="card row" data-act="piece" data-id="' + esc(p.id) + '" style="cursor:pointer"><b class="num">No. ' + pad(p.number) + '</b><span class="muted">' + esc(p.colorway) + '</span><span class="sp"></span>' +
      (p.photo_url ? '<span class="pill ok">photo</span>' : '<span class="pill">no photo</span>') + '<span class="pill">' + esc(p.status) + "</span></div>";
  }).join("");
};
function pieceSheet(id){
  var p = DATA.pieces.pieces.filter(function(x){ return x.id === id; })[0];
  sheet("No. " + pad(p.number) + " · " + p.colorway,
    (p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="No. ' + pad(p.number) + '" style="width:100%;max-width:360px;border-radius:8px">' : '<p class="muted">No photograph of this piece yet.</p>') +
    '<label for="ph">Photograph of this exact watch (JPEG, PNG or WebP, up to 3 MB)</label><input id="ph" type="file" accept="image/jpeg,image/png,image/webp">' +
    '<div class="row" style="margin-top:8px"><button class="btn" data-act="photo" data-id="' + esc(id) + '">Upload</button></div>' +
    '<label for="ps">Status</label><select id="ps">' + DATA.pieces.statuses.filter(function(s){ return s !== "held"; }).map(function(s){ return "<option" + (s === p.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
    '<label for="pr">Reason (needed to change the status; it is logged)</label><input id="pr">' +
    '<label for="pc">Colourway</label><input id="pc" value="' + esc(p.colorway) + '">' +
    '<label for="pn">Private notes</label><textarea id="pn">' + esc(p.notes || "") + "</textarea>" +
    '<p class="err" id="sheetErr"></p><button class="btn go" data-act="pieceSave" data-id="' + esc(id) + '">Save</button>');
}

RENDER.owners = function(j){
  sec("owners").innerHTML = '<h1>Owners</h1><input id="oq" type="search" placeholder="Search by name, email or phone" value="' + esc(DATA.q || "") + '" aria-label="Search owners">' +
    (j.owners.length ? j.owners.map(function(w){ return '<div class="card row" data-act="owner" data-id="' + w.id + '" style="cursor:pointer;margin-top:10px"><span class="sp">' + esc(w.name || w.email) + ' <span class="muted small">' + esc(w.email) + "</span></span>" +
      (w.role === "admin" ? '<span class="pill warn">admin</span>' : "") + '<span class="muted small">' + esc(w.pieces || "") + "</span></div>"; }).join("") : '<div class="card muted" style="margin-top:10px">No owners yet. They appear when they register (Phase 4).</div>');
  var q = $("oq"); q.addEventListener("change", function(){ DATA.q = q.value; load("owners"); });
};
function ownerSheet(id){
  api("GET", "/control/api/owners/" + id).then(function(j){
    if(!j.ok){ say("Could not load that owner.", true); return; }
    var w = j.owner;
    sheet(w.name || w.email,
      '<p class="muted small">' + j.sessions + " signed-in device(s). Joined " + esc(when(w.created_at)) + ". City public: " + (w.show_city_publicly ? "yes" : "no") + ".</p>" +
      "<h2>Ownership chain</h2>" + (j.chain.length ? "<table>" + j.chain.map(function(c){ return "<tr><td>" + esc(c.piece_id) + "</td><td>Owner " + c.owner_no + "</td><td>" + esc(c.email) + '</td><td class="num">' + esc((c.from_at || "").slice(0, 10)) + " to " + esc(c.to_at ? c.to_at.slice(0, 10) : "now") + "</td></tr>"; }).join("") + "</table>" : '<p class="muted">No pieces yet.</p>') +
      "<h2>Contact details, on the owner's request</h2>" +
      '<label for="on">Name</label><input id="on" value="' + esc(w.name || "") + '"><label for="oe">Email (signs them out everywhere)</label><input id="oe" type="email" value="' + esc(w.email) + '">' +
      '<label for="op">Phone</label><input id="op" value="' + esc(w.phone || "") + '"><label for="oc">City</label><input id="oc" value="' + esc(w.city || "") + '"><label for="os">State</label><input id="os" value="' + esc(w.state || "") + '">' +
      '<p class="err" id="sheetErr"></p><div class="row"><button class="btn go" data-act="ownerSave" data-id="' + w.id + '">Save</button><button class="btn warn" data-act="revoke" data-id="' + w.id + '">Sign out every device</button></div>');
  });
}

RENDER.approvals = function(j){
  var r = j.requests.map(function(x){ return '<div class="card"><span class="pill warn">' + esc(x.type) + "</span> " + esc(x.piece_id) + ' <span class="muted small">' + esc(when(x.created_at)) + '</span><p class="small">' + esc(x.description) + "</p></div>"; }).join("");
  var t = j.transfers.map(function(x){ return '<div class="card"><span class="pill">transfer</span> ' + esc(x.piece_id) + " · " + esc(x.status) + "</div>"; }).join("");
  sec("approvals").innerHTML = "<h1>Approvals</h1>" + (r + t || '<div class="card muted">Nothing waiting.</div>') + '<p class="muted small">Warranty claims, transfers, stolen reports and recovery requests are decided here once those flows are live (Phase 6).</p>';
};

RENDER.emails = function(j){
  sec("emails").innerHTML = "<h1>Emails</h1><h2>Templates</h2>" + j.templates.map(function(t){
    return '<div class="card row"><span class="sp">' + esc(t) + '</span><button class="btn ghost" data-act="tpl" data-t="' + esc(t) + '">Preview</button><button class="btn" data-act="test" data-t="' + esc(t) + '">Send a test to me</button></div>'; }).join("") +
    "<h2>Outbox</h2>" + (j.emails.length ? '<div class="card"><table>' + j.emails.map(function(e){
      return "<tr><td>" + esc(when(e.created_at)) + "</td><td>" + esc(e.subject) + '<div class="muted small">' + esc(e.to_email) + (e.last_error ? " · " + esc(e.last_error) : "") + '</div></td><td><span class="pill ' + (e.status === "sent" ? "ok" : e.status === "failed" ? "bad" : "warn") + '">' + esc(e.status) + "</span>" +
        (e.status !== "sent" ? ' <button class="btn ghost small" data-act="retry" data-id="' + e.id + '">Retry</button>' : "") + "</td></tr>"; }).join("") + "</table></div>" : '<div class="card muted">Nothing sent yet.</div>');
};

RENDER.settings = function(j){
  var s = j.settings, se = j.series[0] || {};
  sec("settings").innerHTML = "<h1>Settings</h1>" +
    '<div class="card"><div class="check"><input type="checkbox" id="s1"' + (s.stage_emails === "1" ? " checked" : "") + '><label for="s1" style="margin:0">Every stage change emails the buyer</label></div>' +
    '<div class="check"><input type="checkbox" id="s2"' + (s.transfers_need_approval === "1" ? " checked" : "") + '><label for="s2" style="margin:0">Transfers wait for my approval</label></div>' +
    '<label for="s3">Sender name</label><input id="s3" value="' + esc(s.sender_name) + '"><p class="muted small">Sends from ' + esc(j.sender) + ". Admin: " + esc(j.admin) + ".</p>" +
    '<label for="s4">Warranty terms (published once rain coverage is decided)</label><textarea id="s4">' + esc(s.warranty_terms) + "</textarea>" +
    "<h2>" + esc(se.name || "Series") + '</h2><div class="row"><div class="sp"><label for="s5">Return days</label><input id="s5" type="number" min="7" max="30" value="' + esc(se.return_days) + '"></div><div class="sp"><label for="s6">Warranty months</label><input id="s6" type="number" min="12" max="60" value="' + esc(se.warranty_months) + '"></div></div>' +
    '<p class="err" id="setErr"></p><button class="btn go" data-act="saveSettings" data-code="' + esc(se.code) + '">Save settings</button></div>' +
    "<h2>Blocked buyers</h2>" + (j.blocked.length ? '<div class="card"><table>' + j.blocked.map(function(b){ return "<tr><td>" + esc(b.email || "") + "<br>" + esc(b.phone || "") + '</td><td class="muted small">' + esc(b.reason) + '</td><td><button class="btn ghost small" data-act="unblock" data-id="' + b.id + '">Remove</button></td></tr>'; }).join("") + "</table></div>" : "") +
    '<div class="card"><label for="b1">Email</label><input id="b1" type="email"><label for="b2">Phone</label><input id="b2" inputmode="tel"><label for="b3">Reason</label><input id="b3"><p class="err" id="blkErr"></p><button class="btn" data-act="block">Block</button></div>';
};

RENDER.audit = function(j){
  sec("audit").innerHTML = '<h1>Audit and export</h1><div class="card row"><a class="btn" href="/control/api/export/orders.csv">Orders CSV</a><a class="btn" href="/control/api/export/owners.csv">Owners CSV</a><a class="btn" href="/control/api/export/pieces.csv">Pieces CSV</a><a class="btn go" href="/control/api/backup">Backup now</a></div>' +
    '<div class="card"><table>' + j.audit.map(function(a){ return '<tr><td class="small">' + esc(when(a.at)) + '</td><td class="small">' + esc(a.action) + '<div class="muted">' + esc(a.target || "") + " · " + esc(a.actor) + '</div></td><td class="small muted" style="word-break:break-word">' + esc((a.after || "").slice(0, 160)) + "</td></tr>"; }).join("") + "</table></div>";
};

/* ── The sheet ── */
function sheet(title, html){ $("sheetT").textContent = title; $("sheetB").innerHTML = html; $("sheet").hidden = false; var f = $("sheetB").querySelector("input,select,textarea,button"); if(f) f.focus(); }
function closeSheet(){ $("sheet").hidden = true; $("sheetB").innerHTML = ""; }
function frame(src){ sheet("Preview", '<iframe src="' + esc(src) + '" title="Email preview"></iframe><p><a href="' + esc(src) + '&format=text" target="_blank" rel="noopener">The plain-text version</a></p>'); }

/* ── Every tap ── */
document.addEventListener("click", function(e){
  var el = e.target.closest ? e.target.closest("[data-act],[data-go]") : null;
  if(!el) return;
  if(el.hasAttribute("data-go")){ show(el.getAttribute("data-go")); return; }
  var a = el.getAttribute("data-act"), id = +el.getAttribute("data-id") || el.getAttribute("data-id");
  if(a === "close") closeSheet();
  else if(a === "undo") undo();
  else if(a === "next") nextStage(id, el.getAttribute("data-to"));
  else if(a === "preview") frame("/control/preview?t=" + encodeURIComponent(el.getAttribute("data-to")) + "&o=" + id);
  else if(a === "previewD") frame("/control/preview?t=dispatched&o=" + id + "&courier=" + encodeURIComponent($("cr").value) + "&tracking=" + encodeURIComponent($("tn").value) + "&url=" + encodeURIComponent($("tu").value));
  else if(a === "dispatchGo"){
    var cr = $("cr").value, tn = $("tn").value.trim(), tu = $("tu").value.trim();
    if(!tn || !/^https:\/\/\S+$/.test(tu)){ $("sheetErr").textContent = "The tracking number, and a tracking link that starts with https://."; return; }
    closeSheet(); hold(id, { to:"dispatched", courier:cr, tracking:tn, url:tu }, "No. " + pad(order(id).number) + " marked Dispatched. The email goes in");
  }
  else if(a === "deliverGo"){ var d = $("dd").value; if(!d){ $("sheetErr").textContent = "Choose the day it was delivered."; return; } closeSheet(); hold(id, { to:"delivered", day:d }, "No. " + pad(order(id).number) + " marked Delivered on " + d + ". Saving in"); }
  else if(a === "correct"){
    var o = order(id);
    sheet("Change No. " + pad(o.number) + " without email", '<label for="cs">Status</label><select id="cs">' + ["placed","inspected","packed","dispatched","delivered","registered","returned","cancelled"].map(function(s){ return "<option" + (s === o.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
      '<label for="cd">Delivered on (only when changing to delivered)</label><input id="cd" type="date" value="' + esc(o.delivered_on || DATA.orders.today) + '" max="' + esc(DATA.orders.today) + '">' +
      '<label for="cw">Reason (logged)</label><input id="cw"><p class="muted small">For corrections. No email is sent.</p><p class="err" id="sheetErr"></p><button class="btn go" data-act="correctGo" data-id="' + id + '">Change</button>');
  }
  else if(a === "correctGo"){ var w = $("cw").value.trim(); if(w.length < 3){ $("sheetErr").textContent = "Say why, in a few words."; return; }
    var to = $("cs").value, pay = { to:to, silent:true, reason:w }; if(to === "delivered") pay.day = $("cd").value;
    closeSheet(); hold(id, pay, "Changing to " + to + ", no email. Saving in"); }
  else if(a === "import"){ el.disabled = true; say("Asking Razorpay. This takes a few seconds.");
    api("POST", "/control/api/import", {}).then(function(j){ say(j.ok ? "Brought in: " + (j.imported || []).length + " new, " + (j.already || []).length + " already here." : "Razorpay did not answer. Try again in a minute.", !j.ok); load("overview"); }); }
  else if(a === "pastSale"){
    sheet("Record a past sale", '<p class="muted small">For a watch sold before this registry (Nos. 01 and 02). No email is sent. It cannot be refunded from here.</p>' +
      '<label for="ms">Number</label><input id="ms" inputmode="numeric" placeholder="01">' +
      '<label for="mn">Buyer name</label><input id="mn" autocomplete="off"><label for="me">Buyer email (how they will sign in to the registry)</label><input id="me" type="email" autocomplete="off">' +
      '<label for="mp">Phone</label><input id="mp" inputmode="tel" autocomplete="off"><label for="ma">Address</label><input id="ma" autocomplete="off">' +
      '<div class="row"><div class="sp"><label for="mc">City</label><input id="mc"></div><div class="sp"><label for="mt">State</label><input id="mt"></div></div><label for="mz">PIN</label><input id="mz" inputmode="numeric" maxlength="6">' +
      '<div class="row"><div class="sp"><label for="mpd">Paid on</label><input id="mpd" type="date" max="' + esc(DATA.orders.today) + '"></div><div class="sp"><label for="mdd">Delivered on (if it has arrived)</label><input id="mdd" type="date" max="' + esc(DATA.orders.today) + '"></div></div>' +
      '<label for="mr">Amount paid, rupees (leave empty for the series price)</label><input id="mr" inputmode="decimal">' +
      '<p class="err" id="sheetErr"></p><button class="btn go" data-act="pastSaleGo">Record it</button>');
  }
  else if(a === "pastSaleGo") api("POST", "/control/api/orders/manual", { n:$("ms").value, name:$("mn").value, email:$("me").value, phone:$("mp").value, line1:$("ma").value, city:$("mc").value, state:$("mt").value,
      pin:$("mz").value, paid_on:$("mpd").value, delivered_on:$("mdd").value, amount_rupees:$("mr").value }).then(function(j){ if(j.ok){ closeSheet(); say("Recorded."); load("orders"); } else $("sheetErr").textContent = j.why || "Not recorded."; });
  else if(a === "returned"){ var r = prompt("Mark No. " + pad(order(id).number) + " returned? The buyer will never be sold to again. Reason:"); if(r === null) return;
    api("POST", "/control/api/orders/" + id + "/returned", { reason:r }).then(function(j){ say(j.ok ? "Marked returned. Refund it next if you have not." : (j.why || "Not changed."), !j.ok); load("orders"); }); }
  else if(a === "refund"){ var n = el.getAttribute("data-n"); var c = prompt("Refund the full amount through Razorpay? This cannot be undone. Type " + n + " to confirm."); if(c === null) return;
    api("POST", "/control/api/orders/" + id + "/refund", { confirm:c, reason: order(id).status === "returned" ? "return" : "cancel" }).then(function(j){ say(j.ok ? "Refunded: " + j.refund : (j.why || "Not refunded."), !j.ok); load("orders"); }); }
  else if(a === "piece") pieceSheet(el.getAttribute("data-id"));
  else if(a === "photo"){ var f = $("ph").files[0]; if(!f){ $("sheetErr").textContent = "Choose a photograph first."; return; }
    api("POST", "/control/api/pieces/" + el.getAttribute("data-id") + "/photo", undefined, f).then(function(j){ if(j.ok){ closeSheet(); say("Photograph saved."); load("pieces"); } else $("sheetErr").textContent = j.why || "Not saved."; }); }
  else if(a === "pieceSave"){ var pid = el.getAttribute("data-id"), p0 = DATA.pieces.pieces.filter(function(x){ return x.id === pid; })[0], b = { colorway:$("pc").value, notes:$("pn").value };
    if($("ps").value !== p0.status){ b.status = $("ps").value; b.reason = $("pr").value; }
    api("POST", "/control/api/pieces/" + pid, b).then(function(j){ if(j.ok){ closeSheet(); say("Saved."); load("pieces"); } else $("sheetErr").textContent = j.why || "Not saved."; }); }
  else if(a === "owner") ownerSheet(id);
  else if(a === "ownerSave") api("POST", "/control/api/owners/" + id, { name:$("on").value, email:$("oe").value, phone:$("op").value, city:$("oc").value, state:$("os").value }).then(function(j){ if(j.ok){ closeSheet(); say("Saved."); load("owners"); } else $("sheetErr").textContent = j.why || "Not saved."; });
  else if(a === "revoke"){ if(!confirm("Sign this owner out on every device?")) return; api("POST", "/control/api/owners/" + id + "/revoke", {}).then(function(j){ say(j.ok ? "Signed out on " + j.revoked + " device(s)." : "Not changed.", !j.ok); }); }
  else if(a === "tpl") frame("/control/preview?t=" + encodeURIComponent(el.getAttribute("data-t")));
  else if(a === "test") api("POST", "/control/api/emails/test", { template: el.getAttribute("data-t") }).then(function(j){ say(j.ok ? "A test is on its way to " + j.to + "." : "Not sent.", !j.ok); setTimeout(function(){ load("emails"); }, 1500); });
  else if(a === "retry") api("POST", "/control/api/emails/" + id + "/retry", {}).then(function(j){ say(j.ok ? "Queued again." : "Not queued.", !j.ok); setTimeout(function(){ load("emails"); }, 1500); });
  else if(a === "saveSettings") api("POST", "/control/api/settings", { settings:{ stage_emails: $("s1").checked ? "1" : "0", transfers_need_approval: $("s2").checked ? "1" : "0", sender_name: $("s3").value, warranty_terms: $("s4").value },
    series:{ code: el.getAttribute("data-code"), return_days: $("s5").value, warranty_months: $("s6").value } }).then(function(j){ if(j.ok){ say(j.changed.length ? "Saved." : "Nothing changed."); load("settings"); } else $("setErr").textContent = j.why || "Not saved."; });
  else if(a === "block") api("POST", "/control/api/blocked", { email:$("b1").value, phone:$("b2").value, reason:$("b3").value }).then(function(j){ if(j.ok){ say("Blocked."); load("settings"); } else $("blkErr").textContent = j.why || "Not saved."; });
  else if(a === "unblock"){ if(!confirm("Remove this block?")) return; api("POST", "/control/api/blocked", { remove:id }).then(function(){ load("settings"); }); }
});
$("sheet").addEventListener("click", function(e){ if(e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", function(e){
  var typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "");
  if(e.key === "Escape"){ if(!$("sheet").hidden) closeSheet(); else undo(); return; }
  if(typing || $("app").hidden || e.metaKey || e.ctrlKey) return;
  var v = ["overview","orders","pieces","owners","approvals","emails","settings","audit"][+e.key - 1];
  if(v){ show(v); return; }
  if(e.key === "u") undo();
  if(e.key === "r") load(VIEW);
  if(e.key === "/" && VIEW === "owners"){ e.preventDefault(); var q = $("oq"); if(q) q.focus(); }
});
})();
</script>
</body></html>`;
}
