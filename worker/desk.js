/* ══════════════════════════════════════════════════════════════════
   KAAL · THE DESK (the page)

   The owner's private page, served by the worker at /desk. This file is
   only what the page looks like and does in the browser; who may see it,
   and what it shows, are decided in worker/kaal-sold-sync.js, section 6.

   One HTML document, styles and script inline, nothing fetched from any
   other site: no fonts, no images, no analytics. The script carries the
   nonce the worker's Content-Security-Policy names, so nothing else can
   run here. Written ES5-shaped, like the storefront's own script, and
   every value that came from a buyer is escaped before it is placed.

   Built for a phone first: the owner reads it between packing boxes.
   ══════════════════════════════════════════════════════════════════ */

export function deskPage(nonce) {
  return String.raw`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="#0b0c0a">
<title>KAAL · Desk</title>
<link rel="icon" href="data:,">
<style>
:root{
  --bg:#0b0c0a; --card:#121310; --card2:#171813; --line:#26231f; --line2:#3a352d;
  --bone:#EDE8DF; --mute:#B3AC9F; --faint:#8f897e; --gold:#C6A15B; --goldLit:#E0BE7C;
  --ok:#86B592; --warn:#E0BE7C; --bad:#E08A70;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--bone);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
a{color:var(--goldLit);text-decoration:none}
a:hover{text-decoration:underline}
button,input{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--goldLit);outline-offset:2px}
.wrap{max-width:760px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px calc(40px + env(safe-area-inset-bottom))}
.mark{font-weight:300;letter-spacing:.55em;font-size:13px;color:var(--bone)}
.mark span{letter-spacing:.2em;color:var(--gold);margin-left:.4em;font-size:11px;text-transform:uppercase}
h1,h2{font-family:var(--serif);font-weight:400;margin:0}
h2{font-size:22px;line-height:1.2}
.count{font-family:var(--sans);font-size:12px;color:var(--bg);background:var(--gold);border-radius:999px;padding:1px 8px;vertical-align:4px;margin-left:6px}
.sub{color:var(--faint);font-size:13px;margin:4px 0 0}
.mute{color:var(--mute)} .faint{color:var(--faint)}
.mono{font-family:var(--mono);font-size:12.5px;word-break:break-all}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:40px;padding:8px 16px;border-radius:999px;border:1px solid var(--gold);background:var(--gold);color:var(--bg);font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;cursor:pointer;text-decoration:none!important;white-space:nowrap}
.btn.ghost{background:transparent;color:var(--goldLit)}
.btn.quiet{background:transparent;border-color:var(--line2);color:var(--mute)}
.btn.sm{min-height:34px;padding:6px 12px;font-size:11px}
.btn[disabled]{opacity:.5;cursor:default}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

/* gate */
.gate{min-height:92vh;display:flex;flex-direction:column;justify-content:center;max-width:360px;margin:0 auto}
.gate h1{font-style:italic;color:var(--goldLit);font-size:40px;margin:28px 0 6px}
.gate form{margin-top:26px;display:grid;gap:10px}
.gate label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--faint)}
.gate input[type=password]{width:100%;min-height:48px;padding:10px 14px;border-radius:6px;border:1px solid var(--line2);background:var(--card);font-size:17px;letter-spacing:.08em}
.gate .btn{min-height:48px;font-size:13px}
.gate .msg{min-height:22px;color:var(--bad);font-size:14px;margin:4px 0 0}

/* desk */
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0 4px}
.stamp{color:var(--faint);font-size:12px;margin:2px 0 18px}
section.s{margin:0 0 30px}
.sec-h{display:flex;justify-content:space-between;align-items:flex-end;gap:10px;flex-wrap:wrap;margin-bottom:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px}

.alert{padding:14px 16px;border-left:3px solid var(--gold);background:var(--card);border-radius:0 8px 8px 0;margin-bottom:8px}
.alert.note{border-left-color:var(--line2)}
.alert b{display:block;font-weight:600}
.alert p{margin:3px 0 0;color:var(--mute);font-size:14px}
.alert .row{margin-top:10px}
.calm{padding:14px 16px;color:var(--ok);background:var(--card);border:1px solid var(--line);border-radius:8px}

.seg{display:inline-flex;border:1px solid var(--line2);border-radius:999px;padding:2px}
.seg button{border:0;background:none;border-radius:999px;padding:6px 12px;font-size:12px;color:var(--mute);cursor:pointer}
.seg button[aria-pressed=true]{background:var(--gold);color:var(--bg);font-weight:600}
.tiles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
@media (min-width:640px){.tiles{grid-template-columns:repeat(4,1fr)}}
.tile{padding:14px 14px 12px;background:var(--card);border:1px solid var(--line);border-radius:8px}
.tile .n{font-family:var(--serif);font-size:34px;line-height:1;color:var(--goldLit)}
.tile .l{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin-top:8px}
.tile .v{font-size:12px;color:var(--faint);margin-top:2px}
.funnel{margin-top:8px;padding:6px 14px 10px}
.f{display:grid;grid-template-columns:1fr auto;gap:2px 10px;padding:8px 0;border-top:1px solid var(--line)}
.f:first-child{border-top:0}
.f .k{color:var(--mute);font-size:14px}
.f .x{text-align:right;font-variant-numeric:tabular-nums}
.f .x small{color:var(--faint);margin-left:6px}
.bar{grid-column:1/-1;height:4px;background:var(--line);border-radius:2px;overflow:hidden}
.bar i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--goldLit));border-radius:2px}

.chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}
.chips button{border:1px solid var(--line2);background:none;border-radius:999px;padding:5px 12px;font-size:12px;color:var(--mute);cursor:pointer}
.chips button[aria-pressed=true]{border-color:var(--gold);color:var(--goldLit)}
.order{padding:16px;margin-bottom:10px}
.o-head{display:flex;justify-content:space-between;align-items:center;gap:10px}
.o-no{display:flex;align-items:center;gap:10px}
.o-no b{font-family:var(--serif);font-weight:400;font-size:24px}
.o-no .dial{color:var(--mute);font-size:13px}
.disc{width:18px;height:18px;border-radius:50%;flex:none;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.d-emerald{background:radial-gradient(120% 120% at 32% 24%,#5D8F6E,#245236 58%,#122A1D)}
.d-midnight{background:radial-gradient(120% 120% at 32% 24%,#3A3A38,#151514 58%,#070707);box-shadow:inset 0 0 0 1px rgba(198,161,91,.55)}
.d-champagne{background:radial-gradient(120% 120% at 32% 24%,#F0D89B,#C6A15B 56%,#8A6C33)}
.d-ivory{background:radial-gradient(120% 120% at 32% 24%,#FFFFFF,#DCD7CC 56%,#A49E92)}
.d-{background:var(--line2)}
.st{font-size:11px;letter-spacing:.1em;text-transform:uppercase;padding:4px 10px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.st.ok{color:var(--ok)} .st.warn{color:var(--warn)} .st.bad{color:var(--bad)} .st.gold{color:var(--goldLit)} .st.off{color:var(--faint)}
.o-meta{color:var(--mute);font-size:14px;margin-top:6px}
.o-gift{margin-top:6px;font-size:14px;color:var(--goldLit)}
.o-who{margin-top:10px;font-size:14px;display:flex;flex-wrap:wrap;gap:4px 14px}
.o-addr{margin-top:12px;padding:12px 14px;border:1px solid var(--line2);border-radius:6px;background:var(--card2);font-size:15px;line-height:1.5;display:flex;justify-content:space-between;gap:12px;align-items:flex-start}
.o-addr.none{border-style:dashed;color:var(--mute);font-size:14px;align-items:center}
.o-acts{margin-top:12px}
.o-ship{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);font-size:14px}
.o-ship .done{color:var(--ok)}
.refund-line{margin:0 0 4px;color:var(--bone)}
.o-ship .due{color:var(--mute)}
.o-ship .due.late{color:var(--bad)}
.o-foot{margin-top:10px;font-size:12px;color:var(--faint)}
form.ship{display:grid;gap:8px;margin-top:10px}
form.ship input[type=text],form.ship input[type=url]{width:100%;min-height:44px;padding:8px 12px;border-radius:6px;border:1px solid var(--line2);background:var(--bg);font-size:16px}
form.ship label.chk{display:flex;gap:10px;align-items:center;color:var(--mute);font-size:14px;padding:4px 0}
form.ship label.chk input{width:20px;height:20px;accent-color:var(--gold)}
.list .it{padding:12px 14px;border-top:1px solid var(--line)}
.list .it:first-child{border-top:0}
.it .t{display:flex;justify-content:space-between;gap:10px}
.it .t b{font-weight:600}
.it p{margin:2px 0 0;font-size:14px;color:var(--mute)}
.empty{padding:14px;color:var(--faint);font-size:14px}

.grid20{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px}
.cell{position:relative;aspect-ratio:1/1;border:1px solid var(--line2);border-radius:8px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;background:var(--card)}
.cell b{font-family:var(--serif);font-weight:400;font-size:20px;line-height:1}
.cell i{font-style:normal;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cell .disc{width:12px;height:12px}
.cell.sold{background:linear-gradient(160deg,#2a2418,#17140e);border-color:var(--gold)}
.cell.sold i{color:var(--goldLit)}
.cell.held{border-style:dashed;border-color:var(--goldLit)}
.cell.held i{color:var(--goldLit)}
.legend{display:flex;gap:14px;flex-wrap:wrap;margin-top:10px;font-size:12px;color:var(--faint)}

table.wk{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}
.wk th{font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--faint);font-weight:400;text-align:right;padding:10px 6px;border-bottom:1px solid var(--line)}
.wk td{text-align:right;padding:9px 6px;border-bottom:1px solid var(--line);color:var(--mute);white-space:nowrap}
.wk th:first-child,.wk td:first-child{text-align:left}
.wk tr.now td{color:var(--bone)}
.wk .vb{display:inline-block;height:6px;background:var(--gold);opacity:.55;border-radius:3px;margin-right:6px;vertical-align:1px}

.live-h{display:flex;align-items:center;gap:10px}
.pulse{width:9px;height:9px;border-radius:50%;background:var(--ok);animation:pulse 2s ease-out infinite}
.pulse.off{background:var(--faint);animation:none}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(134,181,146,.55)}70%{box-shadow:0 0 0 10px rgba(134,181,146,0)}100%{box-shadow:0 0 0 0 rgba(134,181,146,0)}}
.now{padding:16px 16px 12px}
.now .hd{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.now .big{font-family:var(--serif);font-size:58px;line-height:.9;color:var(--goldLit);font-variant-numeric:tabular-nums}
.now .what{color:var(--mute);font-size:15px}
.paid{color:var(--ok)}
.where{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
.where span{font-size:12px;border:1px solid var(--line2);border-radius:999px;padding:4px 10px;color:var(--mute)}
.where b{color:var(--bone);font-weight:600}
.spark{display:flex;align-items:flex-end;gap:2px;height:40px;margin-top:14px}
.spark i{flex:1;background:var(--gold);opacity:.6;border-radius:1px 1px 0 0}
.spark i.z{opacity:.18}
.sparkl{display:flex;justify-content:space-between;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--faint);margin-top:4px}
.sub2{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--faint);margin:16px 0 8px}
.vis{padding:12px 14px;border-top:1px solid var(--line)}
.vis:first-child{border-top:0}
.vis .t{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.vis .t b{font-weight:600}
.vis .at{color:var(--goldLit);font-size:14px;margin-top:3px}
.trail{margin:6px 0 0;font-size:12.5px;color:var(--faint);line-height:1.7}
.linkish{background:none;border:0;padding:0;color:var(--bone);font:inherit;cursor:pointer;text-align:left}
.linkish:hover b{text-decoration:underline}
.feed .it{display:grid;grid-template-columns:62px 1fr;gap:10px;padding:9px 14px}
.feed .tm{color:var(--faint);font-size:12px;font-variant-numeric:tabular-nums;padding-top:2px}
.vctl{display:grid;gap:8px;margin-bottom:10px}
.vctl input[type=search]{width:100%;min-height:42px;padding:8px 12px;border-radius:6px;border:1px solid var(--line2);background:var(--card);font-size:16px}
.vrow{display:block;width:100%;text-align:left;background:none;border:0;border-top:1px solid var(--line);padding:12px 14px;cursor:pointer;color:inherit}
.vrow:first-child{border-top:0}
.vrow:hover{background:var(--card2)}
.vrow .t{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.vrow .t b{font-weight:600}
.vrow .m{color:var(--mute);font-size:13px;margin-top:2px}
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}
.pill{font-size:11px;border:1px solid var(--line2);border-radius:999px;padding:2px 8px;color:var(--mute)}
.pill.g{border-color:var(--gold);color:var(--goldLit)}
.pill.ok{border-color:var(--ok);color:var(--ok)}
.journey{margin-top:10px}
.sheet{position:fixed;inset:0;z-index:20;background:rgba(5,5,4,.72);display:flex;justify-content:center;align-items:flex-end}
.sheet-in{width:min(760px,100%);max-height:92vh;overflow:auto;overscroll-behavior:contain;background:var(--bg);border:1px solid var(--line2);border-bottom:0;border-radius:14px 14px 0 0;padding:18px 16px calc(24px + env(safe-area-inset-bottom))}
@media (min-width:640px){.sheet{align-items:center}.sheet-in{border-radius:14px;border-bottom:1px solid var(--line2);max-height:86vh}}
.sheet-h{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.tl-v{margin:18px 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--goldLit)}
.tl{list-style:none;margin:0;padding:0;border-left:1px solid var(--line2)}
.tl li{display:grid;grid-template-columns:62px 1fr;gap:8px;padding:6px 0 6px 12px;position:relative;font-size:14px}
.tl li::before{content:"";position:absolute;left:-4px;top:12px;width:7px;height:7px;border-radius:50%;background:var(--line2)}
.tl li.k::before{background:var(--gold)}
.tl li.p::before{background:var(--ok)}
.tl .tm{color:var(--faint);font-size:12px;font-variant-numeric:tabular-nums;padding-top:1px}
.tl li.p span:last-child{color:var(--ok)}
.health .it{display:grid;grid-template-columns:22px 1fr;gap:2px 8px}
.health .ic{font-weight:700}
.health .ic.y{color:var(--ok)} .health .ic.n{color:var(--bad)}
.health p{grid-column:2}
footer{color:var(--faint);font-size:12px;line-height:1.6;border-top:1px solid var(--line);padding-top:16px}
.toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100% - 32px);background:var(--bone);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:9}
.busy{opacity:.6;transition:opacity .2s}
@media (prefers-reduced-motion:reduce){*{transition:none!important}.pulse{animation:none}}
</style>
</head>
<body>
<div class="wrap">

<section id="gate" class="gate" hidden>
  <div class="mark">K&Lambda;&Lambda;L</div>
  <h1>The desk</h1>
  <p class="mute" id="gateNote">Private. Orders, addresses, leads and the day's numbers.</p>
  <form id="login" autocomplete="on">
    <input type="text" name="username" autocomplete="username" value="KAAL desk" hidden readonly>
    <label for="pc">Passcode</label>
    <input id="pc" name="password" type="password" autocomplete="current-password" required>
    <button class="btn" type="submit">Open</button>
    <p class="msg" id="gateMsg" role="alert"></p>
  </form>
</section>

<div id="desk" hidden>
  <header class="top">
    <div class="mark">K&Lambda;&Lambda;L<span>Desk</span></div>
    <div class="row">
      <button class="btn quiet sm" type="button" data-act="refresh">Refresh</button>
      <button class="btn quiet sm" type="button" data-act="logout">Sign out</button>
    </div>
  </header>
  <p class="stamp" id="stamp"></p>
  <section class="s" id="now" aria-live="off"></section>
  <section class="s" id="needs"></section>
  <section class="s" id="day"></section>
  <section class="s" id="visitors"></section>
  <section class="s" id="orders"></section>
  <section class="s" id="nearly"></section>
  <section class="s" id="twenty"></section>
  <section class="s" id="leads"></section>
  <section class="s" id="week"></section>
  <section class="s" id="health"></section>
  <footer>
    Private. Nothing on thekaal.co links here, and search engines are told to ignore it.
    Sign out ends this device's session; changing DESK_PASSCODE on the worker ends every session.
  </footer>
</div>

</div>
<div class="sheet" id="sheet" hidden>
  <div class="sheet-in" role="dialog" aria-modal="true" aria-labelledby="sheetT">
    <div class="sheet-h"><h2 id="sheetT">Visitor</h2><button class="btn quiet sm" type="button" data-act="sheet-close">Close</button></div>
    <div id="sheetBody"></div>
  </div>
</div>
<div class="toast" id="toast" role="status" hidden></div>

<script nonce="${nonce}">
(function(){
  "use strict";
  var D = null, VIEW = "today", FILTER = "open", OPEN_FORM = "", LEADS_ALL = false, LOADED_AT = 0, busy = false;
  var LV = null, FEED_ALL = false, LAST_PAID = 0, liveBusy = false;
  var VR = "today", VF = "all", VQ = "", VD = null, VROWS = [], vBusy = false, vTimer = 0, SHEET_FROM = null;
  var COURIERS = ["Delhivery", "Blue Dart", "DTDC", "India Post", "Shiprocket", "Ekart", "Xpressbees", "Shadowfax"];

  function $(id){ return document.getElementById(id); }
  function esc(v){
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n){ return n < 10 ? "0" + n : String(n); }
  function no(n){ return n ? "No. " + pad(n) : "No. ??"; }
  function rupees(p){ return "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN"); }
  function plural(n, one, many){ return n + " " + (n === 1 ? one : (many || one + "s")); }
  function pct(n, of){ return of ? Math.round(n / of * 100) + "%" : ""; }
  function waNum(phone){
    var d = String(phone || "").replace(/\D/g, "");
    if (d.length === 10) d = "91" + d;
    if (d.length === 11 && d.charAt(0) === "0") d = "91" + d.slice(1);
    return d.length >= 11 ? d : "";
  }
  function dialClass(name){ return "d-" + String(name || "").toLowerCase(); }
  function dayShort(day){
    var d = new Date(day + "T12:00:00Z"), w = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return w[d.getUTCDay()] + " " + d.getUTCDate() + " " + m[d.getUTCMonth()];
  }
  function istTime(iso){
    var d = new Date(new Date(iso).getTime() + 5.5 * 3600000), m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    var h = d.getUTCHours(), mi = d.getUTCMinutes();
    return d.getUTCDate() + " " + m[d.getUTCMonth()] + ", " + (h % 12 || 12) + ":" + pad(mi) + " " + (h >= 12 ? "pm" : "am");
  }
  function addrText(a){
    return [a.name, a.line1, a.line2, a.city + ", " + a.state + " " + a.pin, a.phone ? "Phone " + a.phone : ""].filter(function(x){ return x; }).join("\n");
  }
  function addrHtml(a){
    return [a.name, a.line1, a.line2, a.city + ", " + a.state + " " + a.pin].filter(function(x){ return x; }).map(esc).join("<br>") +
      (a.phone ? '<br><a href="tel:' + esc(a.phone) + '">' + esc(a.phone) + "</a>" : "");
  }

  var toastTimer = null;
  function toast(msg){
    var t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function(){ t.hidden = true; }, 3800);
  }
  function call(method, path, body){
    var init = { method: method, credentials: "same-origin", cache: "no-store", headers: { "X-Desk": "1" } };
    if (body){ init.headers["Content-Type"] = "application/json"; init.body = JSON.stringify(body); }
    return fetch(path, init).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(j){ j.status = r.status; return j; });
    });
  }

  /* ── the gate ── */
  function showGate(reason){
    $("desk").hidden = true; $("gate").hidden = false;
    if (reason === "off"){
      $("gateNote").textContent = "The desk is not switched on yet. It opens once DESK_PASSCODE is set on the worker (docs/desk.md).";
      $("login").hidden = true;
    } else {
      $("login").hidden = false;
      setTimeout(function(){ try { $("pc").focus(); } catch (e) {} }, 50);
    }
  }
  $("login").addEventListener("submit", function(e){
    e.preventDefault();
    var btn = this.querySelector("button"), msg = $("gateMsg");
    btn.disabled = true; msg.textContent = "";
    call("POST", "/desk/login", { passcode: $("pc").value }).then(function(j){
      btn.disabled = false;
      if (j.ok){ $("pc").value = ""; load(); return; }
      msg.textContent = j.reason === "rate" ? "Too many tries. Wait fifteen minutes." : j.reason === "off" ? "The desk is not switched on yet." : "That is not the passcode.";
    }, function(){ btn.disabled = false; msg.textContent = "Could not reach the worker. Check the connection."; });
  });

  /* ── loading ── */
  function load(quiet){
    if (busy) return;
    busy = true;
    if (!quiet) document.body.className = "busy";
    fetch("/desk/data", { credentials: "same-origin", cache: "no-store", headers: { "X-Desk": "1" } }).then(function(r){
      if (r.status === 401){ showGate(""); return null; }
      if (r.status === 503){ showGate("off"); return null; }
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }).then(function(d){
      if (!d) return;
      D = d; LOADED_AT = Date.now();
      render();
      $("gate").hidden = true; $("desk").hidden = false;
      if (!LV) live();
    }).catch(function(){
      if (D) $("stamp").textContent = "Could not refresh just now. Showing " + D.now + ".";
      else showGate("");
    }).then(function(){ busy = false; document.body.className = ""; });
  }

  /* ── rendering ── */
  function orderStatus(o){
    if (o.refund === "full") return ["Refunded", "off"];
    if (o.sent) return ["Dispatched", "ok"];
    if (D.today > o.dueDay) return ["Late", "bad"];
    if (D.today === o.dueDay) return ["Due today", "warn"];
    if (!o.address) return ["Needs address", "warn"];
    return ["Ready to ship", "gold"];
  }
  function orderById(id){
    for (var i = 0; i < D.orders.length; i++) if (D.orders[i].orderId === id) return D.orders[i];
    return null;
  }
  function contactButtons(email, phone, sm){
    var w = waNum(phone), out = [];
    if (w) out.push('<a class="btn ghost' + (sm ? " sm" : "") + '" href="https://wa.me/' + w + '" target="_blank" rel="noopener">WhatsApp</a>');
    if (email) out.push('<a class="btn ghost' + (sm ? " sm" : "") + '" href="mailto:' + esc(email) + '">Email</a>');
    if (phone) out.push('<a class="btn quiet' + (sm ? " sm" : "") + '" href="tel:' + esc(phone) + '">Call</a>');
    return out.join("");
  }

  function renderNeeds(){
    var a = D.alerts || [], h = '<div class="sec-h"><h2>Needs you' + (a.length ? '<span class="count">' + a.length + "</span>" : "") + "</h2></div>";
    if (!a.length) return h + '<div class="calm">&#10003; Nothing needs you right now.</div>';
    return h + a.map(function(x){
      var acts = "", o = x.orderId ? orderById(x.orderId) : null;
      if (o){
        acts += contactButtons(o.email, o.contact, true);
        if (x.kind === "address" && o.shipUrl) acts += '<button class="btn quiet sm" type="button" data-act="copy" data-text="' + esc(o.shipUrl) + '">Copy address link</button>';
        acts += '<a class="btn quiet sm" href="#o-' + esc(o.orderId) + '" data-act="goto" data-o="' + esc(o.orderId) + '">Open order</a>';
      }
      if (x.kind === "unknown" && x.id) acts += '<a class="btn ghost sm" target="_blank" rel="noopener" href="https://dashboard.razorpay.com/app/payments/' + encodeURIComponent(x.id) + '">Open in Razorpay</a>';
      return '<div class="alert ' + (x.level === "act" ? "act" : "note") + '"><b>' + esc(x.title) + "</b>" + (x.detail ? "<p>" + esc(x.detail) + "</p>" : "") + (acts ? '<div class="row">' + acts + "</div>" : "") + "</div>";
    }).join("");
  }

  function renderDay(){
    var isToday = VIEW === "today", c = D.c[VIEW] || {}, o = D.c[isToday ? "yesterday" : "today"] || {};
    var paid = D.paid[VIEW] || 0, paidO = D.paid[isToday ? "yesterday" : "today"] || 0, rev = D.paid[VIEW + "Paise"] || 0;
    var other = isToday ? "Yesterday " : "Today so far ";
    function tile(n, label, then, extra){
      return '<div class="tile"><div class="n">' + esc(n) + '</div><div class="l">' + esc(label) + '</div><div class="v">' + esc(extra || (other + then)) + "</div></div>";
    }
    var visitors = c.visitor || 0;
    var steps = [
      ["Visitors", visitors, true], ["Page visits", c.visit || 0, false],
      ["Scrolled through the film", c.hero_complete || 0, true], ["Reached the twenty", c.view || 0, true],
      ["Chose a dial", (c.dial || 0) + (c.early_dial || 0), true], ["Chose a number", c.number || 0, true],
      ["Opened checkout", c.checkout || 0, true], ["Gave their details", c.details || 0, true], ["Paid", paid, true]
    ];
    var top = Math.max(visitors, 1);
    return '<div class="sec-h"><h2>' + (isToday ? "Today so far" : "Yesterday") + '</h2><div class="seg" role="group" aria-label="Day">' +
      '<button type="button" data-act="view" data-v="today" aria-pressed="' + isToday + '">Today</button>' +
      '<button type="button" data-act="view" data-v="yesterday" aria-pressed="' + !isToday + '">Yesterday</button></div></div>' +
      '<div class="tiles">' + tile(visitors, "Visitors", o.visitor || 0) + tile(c.number || 0, "Add to cart", o.number || 0) +
      tile(c.checkout || 0, "Checkouts", o.checkout || 0) + tile(paid, "Orders", paidO, paid ? rupees(rev) : "") + "</div>" +
      '<div class="card funnel">' + steps.map(function(s){
        var w = s[2] ? Math.min(100, Math.round(s[1] / top * 100)) : 0;
        return '<div class="f"><span class="k">' + esc(s[0]) + '</span><span class="x">' + s[1] + (s[2] && s[0] !== "Visitors" && visitors ? "<small>" + pct(s[1], visitors) + "</small>" : "") + "</span>" +
          (s[2] ? '<span class="bar"><i style="width:' + w + '%"></i></span>' : "") + "</div>";
      }).join("") + "</div>" +
      (D.counting ? "" : '<p class="sub">Visitor numbers start once the counter is connected.</p>');
  }

  function renderOrder(o){
    var st = orderStatus(o), a = o.address, s = o.sent, open = OPEN_FORM === o.orderId;
    var h = '<article class="card order" id="o-' + esc(o.orderId) + '">' +
      '<div class="o-head"><div class="o-no"><span class="disc ' + dialClass(o.dial) + '"></span><b>' + no(o.n) + '</b><span class="dial">' + esc(o.dial) + '</span></div><span class="st ' + st[1] + '">' + st[0] + "</span></div>" +
      '<div class="o-meta">' + esc(o.amount) + " &middot; " + esc(o.at) + (o.gift ? " &middot; Gift" : "") + (o.refund === "part" ? " &middot; part refunded" : "") + "</div>" +
      (o.gift ? '<div class="o-gift">Handwritten card, no price in the box' + (o.giftNote ? ": &ldquo;" + esc(o.giftNote) + "&rdquo;" : ".") + "</div>" : "") +
      '<div class="o-who">' + (o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + "</a>" : '<span class="faint">no email</span>') +
      (o.contact ? '<a href="tel:' + esc(o.contact) + '">' + esc(o.contact) + "</a>" : "") + "</div>";
    if (a) h += '<div class="o-addr"><div>' + addrHtml(a) + '</div><button class="btn quiet sm" type="button" data-act="copy" data-text="' + esc(addrText(a)) + '">Copy</button></div>';
    else if (o.refund !== "full") h += '<div class="o-addr none"><span>No delivery address yet.</span>' + (o.shipUrl ? '<button class="btn quiet sm" type="button" data-act="copy" data-text="' + esc(o.shipUrl) + '">Copy address link</button>' : "") + "</div>";
    h += '<div class="o-acts row">' + contactButtons(o.email, o.contact, true) +
      '<a class="btn quiet sm" target="_blank" rel="noopener" href="https://dashboard.razorpay.com/app/payments/' + encodeURIComponent(o.id) + '">Razorpay</a></div>';
    if (o.refund !== "full"){
      h += '<div class="o-ship">';
      if (s){
        h += '<div class="row" style="justify-content:space-between"><span class="done">&#10003; Dispatched ' + esc(istTime(s.at)) +
          (s.courier ? " &middot; " + esc(s.courier) : "") + (s.tracking ? ' &middot; <span class="mono">' + esc(s.tracking) + "</span>" : "") +
          (s.mailed ? " &middot; buyer emailed" : "") + "</span>" +
          '<button class="btn quiet sm" type="button" data-act="undo" data-o="' + esc(o.orderId) + '" data-n="' + o.n + '">Undo</button></div>';
      } else if (open){
        h += '<form class="ship" data-o="' + esc(o.orderId) + '" data-n="' + o.n + '">' +
          '<input type="text" name="courier" placeholder="Courier" list="couriers" autocomplete="off" maxlength="40">' +
          '<input type="text" name="tracking" placeholder="Tracking number" autocomplete="off" maxlength="60">' +
          '<input type="url" name="url" placeholder="Tracking link (optional)" autocomplete="off" maxlength="300">' +
          '<label class="chk"><input type="checkbox" name="notify"' + (o.email ? " checked" : " disabled") + "> " +
          (o.email ? "Email " + esc(o.email) + " the tracking" : "No buyer email to send tracking to") + "</label>" +
          '<div class="row"><button class="btn" type="submit">Mark dispatched</button><button class="btn quiet" type="button" data-act="close">Cancel</button></div>' +
          '<p class="sub">Already sent before the desk existed? Untick the email and mark it, so it stops being flagged.</p></form>';
      } else {
        var late = D.today > o.dueDay;
        h += '<div class="row" style="justify-content:space-between"><span class="due' + (late ? " late" : "") + '">' + (late ? "Was due " : "Dispatch by ") + esc(o.due) + "</span>" +
          '<button class="btn sm" type="button" data-act="open" data-o="' + esc(o.orderId) + '">Mark dispatched</button></div>';
      }
      h += "</div>";
    } else {
      h += '<div class="o-ship">' + refundBlock(o) + "</div>";
    }
    return h + journeyButton(o.orderId) + '<div class="o-foot mono">' + esc(o.id) + (o.orderId ? " &middot; " + esc(o.orderId) : "") + "</div></article>";
  }

  /* A full refund leaves one question, and only the owner answers it: is
     the number back on sale? Nothing moves on the site until a tap here. */
  function liveFor(n){
    return (D.orders || []).some(function(x){ return x.n === n && x.refund !== "full"; });
  }
  function refundBlock(o){
    var head = '<p class="refund-line">Refunded ' + esc(o.refunded || o.amount) + (o.refundedOn ? " on " + esc(o.refundedOn) : "") + ".</p>";
    if (!o.n) return head;
    var stillSold = D.sold && D.sold.indexOf(o.n) > -1, r = o.release || {};
    if (liveFor(o.n)) return head + '<p class="sub">' + no(o.n) + " has been bought again since.</p>";
    if (!stillSold) return head + '<p class="sub">' + no(o.n) + " is on sale" + (r.decided === "sell" && r.at ? " again since " + esc(istTime(r.at)) : "") + ".</p>";
    var sell = '<button class="btn sm" type="button" data-act="release" data-v="sell" data-n="' + o.n + '">Put ' + no(o.n) + " back on sale</button>";
    if (r.decided === "retire") return head + '<div class="row" style="justify-content:space-between"><span class="sub">Kept retired' + (r.at ? " since " + esc(istTime(r.at)) : "") + ".</span>" + sell + "</div>";
    return head + '<p class="sub">The site still shows ' + no(o.n) + " as sold. Back on sale, or keep it retired?</p>" +
      '<div class="row" style="margin-top:8px">' + sell + '<button class="btn quiet sm" type="button" data-act="release" data-v="retire" data-n="' + o.n + '">Keep it retired</button></div>';
  }

  function renderOrders(){
    var all = D.orders || [];
    var openN = all.filter(function(o){ return !o.sent && o.refund !== "full"; }).length;
    var list = all.filter(function(o){
      if (FILTER === "open") return !o.sent && o.refund !== "full";
      if (FILTER === "sent") return !!o.sent;
      return true;
    });
    var chip = function(v, label){ return '<button type="button" data-act="filter" data-v="' + v + '" aria-pressed="' + (FILTER === v) + '">' + label + "</button>"; };
    return '<div class="sec-h"><div><h2>Orders' + (all.length ? '<span class="count">' + all.length + "</span>" : "") + "</h2>" +
      '<p class="sub">' + rupees(D.revenue) + " taken &middot; " + plural(openN, "to dispatch", "to dispatch") + "</p></div>" +
      '<a class="btn ghost sm" href="/desk/orders.csv">Download CSV</a></div>' +
      '<div class="chips">' + chip("open", "To dispatch") + chip("sent", "Dispatched") + chip("all", "All") + "</div>" +
      (list.length ? list.map(renderOrder).join("") : '<div class="card empty">' + (FILTER === "open" ? "Nothing waiting to be dispatched." : "None yet.") + "</div>") +
      '<datalist id="couriers">' + COURIERS.map(function(c){ return '<option value="' + c + '">'; }).join("") + "</datalist>";
  }

  function renderNearly(){
    var u = D.unfinished || [];
    var h = '<div class="sec-h"><div><h2>Nearly bought' + (u.length ? '<span class="count">' + u.length + "</span>" : "") + '</h2><p class="sub">Checkouts opened today or yesterday that did not end in a payment</p></div></div>';
    if (!D.razorpay) return h + '<div class="card empty">Needs the Razorpay keys on the worker.</div>';
    if (!u.length) return h + '<div class="card empty">None. Every checkout opened today and yesterday was paid, or none were opened.</div>';
    return h + '<div class="card list">' + u.map(function(x){
      return '<div class="it"><div class="t"><b>' + no(x.n) + (x.dial ? " &middot; " + esc(x.dial) : "") + '</b><span class="faint">' + esc(x.at) + "</span></div>" +
        (x.name ? "<p><b>" + esc(x.name) + "</b>" + (x.city ? " &middot; " + esc(x.city) : "") + "</p>" : "") +
        "<p>" + esc(x.stage) + "</p>" + (x.followed ? '<p class="faint">Follow-up email sent ' + esc(x.followed) + "</p>" : "") + (x.email || x.contact ? "<p>" + (x.email ? esc(x.email) : "") + (x.email && x.contact ? " &middot; " : "") + (x.contact ? esc(x.contact) : "") + "</p>" : "") +
        ((x.email || x.contact) ? '<div class="row" style="margin-top:8px">' + contactButtons(x.email, x.contact, true) + "</div>" : '<p class="faint">No contact given for this one.</p>') +
        journeyButton(x.orderId) + "</div>";
    }).join("") + "</div>";
  }

  function renderTwenty(){
    var h = '<div class="sec-h"><div><h2>The twenty</h2><p class="sub">';
    if (!D.sold) return h + 'The sold list could not be read just now.</p></div></div>';
    var sold = {}, held = {}, i;
    for (i = 0; i < D.sold.length; i++) sold[D.sold[i]] = 1;
    for (i = 0; i < D.held.length; i++) held[D.held[i]] = 1;
    var heldNow = D.held.filter(function(n){ return !sold[n]; }).length;
    h += D.left + " of " + D.edition + " remain" + (heldNow ? " &middot; " + heldNow + " held by someone paying right now" : "") + "</p></div></div><div class=\"grid20\">";
    for (i = 1; i <= D.edition; i++){
      var k = sold[i] ? "sold" : held[i] ? "held" : "open", dial = D.dials[i] || "";
      h += '<div class="cell ' + k + '" title="' + no(i) + (dial ? " " + esc(dial) : "") + '"><span class="disc ' + dialClass(dial) + '"></span><b>' + pad(i) + "</b><i>" + (k === "sold" ? "Sold" : k === "held" ? "Held" : "Open") + "</i></div>";
    }
    return h + '</div><div class="legend"><span>Gold frame: sold</span><span>Dashed: held for twelve minutes while someone pays</span><span>The dot is the dial</span></div>';
  }

  function renderLeads(){
    var L = D.leads || { total: 0, today: 0, recent: [] }, list = LEADS_ALL ? L.recent : L.recent.slice(0, 8);
    var h = '<div class="sec-h"><div><h2>Series 02 list' + (L.total ? '<span class="count">' + L.total + "</span>" : "") + '</h2><p class="sub">' +
      (L.today ? plural(L.today, "joined", "joined") + " today" : "Nobody new today") + " &middot; one email when Series 02 is drawn, nothing else</p></div>" +
      (L.total ? '<a class="btn ghost sm" href="/desk/leads.csv">Download CSV</a>' : "") + "</div>";
    if (!L.total) return h + '<div class="card empty">No one on the list yet.</div>';
    h += '<div class="card list">' + list.map(function(l){
      return '<div class="it"><div class="t"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a><span class="faint">' + esc(l.source || "") + "</span></div><p class=\"faint\">" + esc(l.at) + "</p></div>";
    }).join("") + "</div>";
    if (L.recent.length > 8) h += '<div class="row" style="margin-top:8px"><button class="btn quiet sm" type="button" data-act="leads">' + (LEADS_ALL ? "Show fewer" : "Show the latest " + L.recent.length) + "</button></div>";
    return h;
  }

  function renderWeek(){
    var t = D.trend || [], top = 1, i;
    for (i = 0; i < t.length; i++) top = Math.max(top, t[i].visitors);
    return '<div class="sec-h"><h2>Last seven days</h2></div><div class="card" style="padding:4px 6px 6px;overflow-x:auto"><table class="wk"><thead><tr><th>Day</th><th>Visitors</th><th>Cart</th><th>Checkout</th><th>Orders</th></tr></thead><tbody>' +
      t.map(function(r){
        return '<tr class="' + (r.day === D.today ? "now" : "") + '"><td>' + (r.day === D.today ? "Today" : dayShort(r.day).replace(/ [A-Z][a-z]{2}$/, "")) + '</td><td><span class="vb" style="width:' + Math.round(r.visitors / top * 24) + 'px"></span>' + r.visitors +
          "</td><td>" + r.numbers + "</td><td>" + r.checkouts + "</td><td>" + r.orders + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  /* ── right now ── */
  var WHERE = { film: "Watching the film", story: "Reading the story", twenty: "At the twenty", below: "Below the twenty",
                details: "Giving their details", pay: "Paying now" };
  var SOURCES = { instagram: "Instagram", ig: "Instagram", facebook: "Facebook", fb: "Facebook", meta: "Meta ad", google: "Google",
                  "google ads": "Google Ads", bing: "Bing", x: "X", youtube: "YouTube", whatsapp: "WhatsApp", linkedin: "LinkedIn",
                  chatgpt: "ChatGPT", perplexity: "Perplexity", duckduckgo: "DuckDuckGo", direct: "Direct" };
  function srcName(v){
    var s = v.s || "", name = SOURCES[s] || v.from || s;
    /* The ads open in Instagram's and Facebook's own browsers, which send
       no referrer: the app is the better answer than "Direct". */
    if (v.app && (!s || s === "direct" || s === "meta")) name = v.app;
    return name || "Direct";
  }
  function devName(v){ return v.os || ({ computer: "Computer", tablet: "Tablet", phone: "Phone" })[v.dev] || ""; }
  function took(ms){
    var t = Math.max(0, Math.round(ms / 1000));
    return t < 60 ? t + "s" : t < 3600 ? Math.floor(t / 60) + "m " + pad(t % 60) + "s" : Math.floor(t / 3600) + "h " + pad(Math.floor(t % 3600 / 60)) + "m";
  }
  function clock(ts){
    var d = new Date(ts + 5.5 * 3600000), h = d.getUTCHours();
    return (h % 12 || 12) + ":" + pad(d.getUTCMinutes()) + " " + (h >= 12 ? "pm" : "am");
  }
  var PAGES = { about: "the About page", manifesto: "the manifesto", movement: "the movement page", provenance: "Who is selling this",
                legal: "terms and privacy", claimed: "the thank-you page", "404": "a missing page" };
  function renderNow(){
    var h = '<div class="sec-h"><div class="live-h"><h2>Right now</h2><span class="pulse' + (LV && LV.live ? "" : " off") + '" aria-hidden="true"></span></div>' +
      (LV && LV.live ? '<span class="faint" style="font-size:12px">Live &middot; every ten seconds</span>' : "") + "</div>";
    if (!LV) return h + '<div class="card empty">Connecting&hellip;</div>';
    if (!LV.live) return h + '<div class="card empty">' + (LV.counting ? "The live view could not be read just now. It tries again in ten seconds." : "The live view starts once the visitor counter is connected (Health, below).") + "</div>";
    var L = LV.live, here = L.here || [], now = L.now || LV.now || Date.now(), by = {}, i;
    for (i = 0; i < here.length; i++){ var w = here[i].w || "film"; by[w] = (by[w] || 0) + 1; }
    var chips = ["pay", "details", "twenty", "story", "film", "below"].filter(function(w){ return by[w]; })
      .map(function(w){ return "<span><b>" + by[w] + "</b> " + WHERE[w].toLowerCase() + "</span>"; }).join("");
    var mins = L.minutes || [], top = 1;
    for (i = 0; i < mins.length; i++) top = Math.max(top, mins[i]);
    var spark = mins.map(function(x, j){
      return '<i class="' + (x ? "" : "z") + '" style="height:' + (x ? Math.max(8, Math.round(x / top * 100)) : 4) + '%" title="' + plural(x, "person", "people") + ", " + (mins.length - 1 - j) + ' min ago"></i>';
    }).join("");
    var sales = (L.paid || []).length;
    h += '<div class="card now"><div class="hd"><span class="big">' + here.length + '</span><span class="what">' + (here.length === 1 ? "person on the site" : "people on the site") +
      (sales ? ' &middot; <span class="paid">' + plural(sales, "sale") + " in the last hour</span>" : "") + "</span></div>" +
      (chips ? '<div class="where">' + chips + "</div>" : "") +
      '<div class="spark" role="img" aria-label="People on the site in each minute of the last half hour">' + spark + '</div><div class="sparkl"><span>30 min ago</span><span>Now</span></div></div>';

    if (here.length){
      h += '<p class="sub2">On the site</p><div class="card list">' + here.map(function(v){
        var at = WHERE[v.w] || (v.p && v.p !== "home" ? "On " + (PAGES[v.p] || v.p) : "On the page"), trail = (v.steps || []).filter(function(e){ return e.e !== "early_dial"; });
        return '<div class="vis"><div class="t">' + (v.vk ? '<button class="linkish" type="button" data-act="visitor" data-k="' + v.vk + '"><b>Visitor ' + v.vk + "</b> &rsaquo;</button>" : "<b>A visitor</b>") +
          '<span class="faint">' + took(now - v.since) + "</span></div>" +
          '<div class="faint" style="font-size:13px">' + esc(srcName(v)) + (devName(v) ? " &middot; " + esc(devName(v)) : "") + "</div>" +
          '<div class="at">' + at + (v.n ? " &middot; No. " + pad(v.n) : "") + (v.d ? " &middot; " + esc(v.d.charAt(0).toUpperCase() + v.d.slice(1)) : "") + "</div>" +
          (trail.length ? '<p class="trail">' + trail.slice(-6).map(function(e, j, a){
            var t = clock(e.ts);
            return (j && clock(a[j - 1].ts) === t ? "" : t + " ") + esc(e.txt || e.e);
          }).join(" &rarr; ") + "</p>" : "") + "</div>";
      }).join("") + "</div>";
    }

    var visits = {};
    (L.here || []).concat(L.left || []).forEach(function(v){ visits[v.k] = v; });
    function who(e){ return e.vk ? '<button class="linkish" type="button" data-act="visitor" data-k="' + e.vk + '"><b>Visitor ' + e.vk + "</b></button>" : "<b>A visitor</b>"; }
    var feed = (L.feed || []).filter(function(e){ return e.e !== "early_dial"; }), list = FEED_ALL ? feed : feed.slice(0, 12);
    h += '<p class="sub2">The last hour</p>';
    if (!feed.length) return h + '<div class="card empty">Nothing yet. Each step a visitor takes appears here a few seconds after they take it.</div>';
    h += '<div class="card list feed">' + list.map(function(e){
      if (e.e === "paid") return '<div class="it"><span class="tm">' + clock(e.ts) + '</span><span class="paid"><b>Paid</b> &middot; ' + (e.no ? "No. " + esc(e.no) : "a number") + (e.dial ? " &middot; " + esc(e.dial) : "") + (e.paise ? " &middot; " + rupees(e.paise) : "") + "</span></div>";
      var v = visits[e.k];
      return '<div class="it"><span class="tm">' + clock(e.ts) + "</span><span>" + who(e) + " &middot; " + esc(e.txt || e.e) + (v ? ' <span class="faint">&middot; ' + esc(srcName(v)) + "</span>" : "") + "</span></div>";
    }).join("") + "</div>";
    if (feed.length > 12) h += '<div class="row" style="margin-top:8px"><button class="btn quiet sm" type="button" data-act="feed">' + (FEED_ALL ? "Show fewer" : "Show the whole hour (" + feed.length + ")") + "</button></div>";
    return h;
  }

  /* ── visitors: everyone's whole story, ninety days of it ── */
  function journeyButton(orderId){
    var j = orderId && D.journeys && D.journeys[orderId];
    if (!j) return "";
    return '<div class="journey"><button class="btn quiet sm" type="button" data-act="visitor" data-k="' + j.k + '">Their journey &middot; Visitor ' + j.k +
      " &middot; " + plural(j.visits, "visit") + " &middot; " + esc(srcName(j)) + "</button></div>";
  }
  function dayAt(ms){
    var d = new Date(ms + 5.5 * 3600000), w = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"], m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return w[d.getUTCDay()] + " " + d.getUTCDate() + " " + m[d.getUTCMonth()];
  }
  function seenAt(ms){
    var today = dayAt(Date.now());
    return dayAt(ms) === today ? clock(ms) : dayAt(ms) + ", " + clock(ms);
  }
  function pills(v){
    var p = [];
    (v.dials || []).forEach(function(d){ p.push('<span class="pill">' + esc(d) + "</span>"); });
    (v.numbers || []).forEach(function(n){ p.push('<span class="pill g">No. ' + esc(n) + "</span>"); });
    if (v.checkout) p.push('<span class="pill g">Opened checkout</span>');
    (v.paid || []).forEach(function(n){ p.push('<span class="pill ok">Paid &middot; No. ' + esc(n) + "</span>"); });
    if (!p.length && v.twenty) p.push('<span class="pill">Reached the twenty</span>');
    if (!p.length && v.film) p.push('<span class="pill">Watched the film</span>');
    return p.length ? '<div class="pills">' + p.join("") + "</div>" : "";
  }
  function visitorMeta(v){
    return [esc(srcName(v)), esc(devName(v)), plural(v.visits, "visit"), v.time ? took(v.time) + " on the site" : ""].filter(function(x){ return x; }).join(" &middot; ");
  }
  function renderVisitorsShell(){
    var seg = function(v, label){ return '<button type="button" data-act="vr" data-v="' + v + '" aria-pressed="' + (VR === v) + '">' + label + "</button>"; };
    var chip = function(v, label){ return '<button type="button" data-act="vf" data-v="' + v + '" aria-pressed="' + (VF === v) + '">' + label + "</button>"; };
    return '<div class="sec-h"><div><h2>Visitors<span class="count" id="vcount" hidden></span></h2><p class="sub">Everyone who came, where from, and everything they did. Kept ninety days.</p></div>' +
      '<div class="seg" role="group" aria-label="Period">' + seg("today", "Today") + seg("7d", "7 days") + seg("90d", "90 days") + "</div></div>" +
      '<div class="vctl"><input type="search" id="vq" placeholder="Name, phone, email or number" aria-label="Search visitors" autocomplete="off">' +
      '<div class="chips" style="margin:0">' + chip("all", "Everyone") + chip("bought", "Bought") + chip("checkout", "Opened checkout") + chip("details", "Gave details") + chip("number", "Chose a number") + "</div></div>" +
      '<div id="vlist"><div class="card empty">Loading&hellip;</div></div>' +
      '<div class="row" style="margin-top:10px"><a class="btn ghost sm" id="vcsv1" href="/desk/visitors.csv?r=90d">Spreadsheet: one row per visitor</a><a class="btn ghost sm" id="vcsv2" href="/desk/steps.csv?r=90d">Spreadsheet: every step</a></div>';
  }
  function renderVisitorList(){
    var el = $("vlist"); if (!el) return;
    var c = $("vcount");
    if (!VD){ el.innerHTML = '<div class="card empty">Loading&hellip;</div>'; return; }
    if (!VD.on){ el.innerHTML = '<div class="card empty">Visitor histories start once the visitor counter is connected (Health, below).</div>'; return; }
    if (c){ c.textContent = VD.total; c.hidden = !VD.total; }
    if (!VROWS.length){
      el.innerHTML = '<div class="card empty">' + (VQ ? "No visitor matches that." : VR === "today" ? "Nobody yet today. Each visitor appears here the moment they arrive." : "Nobody in this period.") + "</div>";
      return;
    }
    el.innerHTML = '<div class="card list">' + VROWS.map(function(v){
      return '<button class="vrow" type="button" data-act="visitor" data-k="' + v.k + '"><div class="t"><b>Visitor ' + v.k + (v.name ? " &middot; " + esc(v.name) : "") + '</b><span class="faint">' + seenAt(v.last) + "</span></div>" +
        '<div class="m">' + visitorMeta(v) + (v.city ? " &middot; " + esc(v.city) : "") + "</div>" + pills(v) + "</button>";
    }).join("") + "</div>" +
      (VD.total > VROWS.length ? '<div class="row" style="margin-top:8px"><button class="btn quiet sm" type="button" data-act="vmore">Show more (' + (VD.total - VROWS.length) + " left)</button></div>" : "");
  }
  function loadVisitors(more){
    if (!D || vBusy) return;
    vBusy = true;
    var q = "/desk/visitors?r=" + VR + "&f=" + VF + "&q=" + encodeURIComponent(VQ) + "&off=" + (more ? VROWS.length : 0);
    fetch(q, { credentials: "same-origin", cache: "no-store", headers: { "X-Desk": "1" } }).then(function(r){
      if (r.status === 401){ showGate(""); return null; }
      return r.ok ? r.json() : null;
    }).then(function(j){
      if (!j) return;
      VD = j; VROWS = more ? VROWS.concat(j.rows || []) : (j.rows || []);
      renderVisitorList();
    }).catch(function(){ /* the list on screen stands */ }).then(function(){ vBusy = false; });
    var a = $("vcsv1"), b = $("vcsv2"), r = VR === "today" ? "today" : VR;
    if (a) a.href = "/desk/visitors.csv?r=" + r;
    if (b) b.href = "/desk/steps.csv?r=" + r;
  }

  function openSheet(title, html, from){
    SHEET_FROM = from || document.activeElement;
    $("sheetT").textContent = title; $("sheetBody").innerHTML = html; $("sheet").hidden = false;
    document.body.style.overflow = "hidden";
    var c = $("sheet").querySelector('[data-act="sheet-close"]'); if (c) c.focus();
  }
  function closeSheet(){
    if ($("sheet").hidden) return;
    $("sheet").hidden = true; document.body.style.overflow = "";
    if (SHEET_FROM && SHEET_FROM.focus && document.body.contains(SHEET_FROM)) SHEET_FROM.focus();
  }
  function renderTimeline(v){
    var h = '<p class="mute" style="margin:4px 0 0">' + visitorMeta(v) + "</p>" +
      '<p class="faint" style="margin:2px 0 0;font-size:13px">First seen ' + dayAt(v.first) + ", " + clock(v.first) + " &middot; last seen " + seenAt(v.last) + "</p>";
    if (v.name || v.phone || v.email){
      h += '<div class="card" style="padding:12px 14px;margin-top:12px"><b>' + esc(v.name || "Gave contact details") + "</b>" + (v.city ? ' <span class="faint">&middot; ' + esc(v.city) + "</span>" : "") +
        "<p class=\"mute\" style=\"margin:4px 0 0;font-size:14px\">" + [v.phone ? esc(v.phone) : "", v.email ? esc(v.email) : ""].filter(function(x){ return x; }).join(" &middot; ") + "</p>" +
        '<div class="row" style="margin-top:8px">' + contactButtons(v.email, v.phone, true) + "</div></div>";
    }
    h += pills(v);
    var visit = 0, open = false, foot = '<div class="row" style="margin-top:22px;padding-top:14px;border-top:1px solid var(--line)">' +
      '<button class="btn quiet sm" type="button" data-act="forget" data-k="' + v.k + '">Delete this visitor</button>' +
      '<span class="faint" style="font-size:12px">For when someone asks. Their orders stay in Razorpay.</span></div>';
    (v.steps || []).forEach(function(e){
      if (e.e === "early_dial") return;
      if (e.e === "visit"){
        if (open) h += "</ul>";
        visit++; open = true;
        h += '<p class="tl-v">Visit ' + visit + " &middot; " + dayAt(e.t) + "</p><ul class=\"tl\">";
      } else if (!open){ open = true; h += '<ul class="tl">'; }
      var cls = e.e === "paid" ? "p" : (e.e === "number" || e.e === "checkout" || e.e === "details") ? "k" : "";
      h += '<li class="' + cls + '"><span class="tm">' + clock(e.t) + "</span><span>" + esc(e.txt || e.e) + "</span></li>";
    });
    if (open) h += "</ul>";
    return h + foot;
  }
  function openVisitor(k, from){
    openSheet("Visitor " + k, '<div class="empty">Loading&hellip;</div>', from);
    fetch("/desk/visitor?k=" + k, { credentials: "same-origin", cache: "no-store", headers: { "X-Desk": "1" } }).then(function(r){
      if (r.status === 401){ closeSheet(); showGate(""); return null; }
      return r.ok ? r.json() : null;
    }).then(function(j){
      if ($("sheet").hidden) return;
      if (!j || !j.ok){ $("sheetBody").innerHTML = '<div class="empty">This visitor is no longer kept (more than ninety days since they were last seen).</div>'; return; }
      var v = j.v;
      $("sheetT").textContent = "Visitor " + v.k + (v.name ? " · " + v.name : "");
      $("sheetBody").innerHTML = renderTimeline(v);
    }).catch(function(){ if (!$("sheet").hidden) $("sheetBody").innerHTML = '<div class="empty">Could not load just now. Try again.</div>'; });
  }

  function renderHealth(){
    return '<div class="sec-h"><h2>Health</h2></div><div class="card list health">' + (D.health || []).map(function(x){
      return '<div class="it"><span class="ic ' + (x.ok ? "y" : "n") + '">' + (x.ok ? "&#10003;" : "!") + "</span><b>" + esc(x.label) + "</b><p>" + esc(x.detail) + "</p></div>";
    }).join("") + "</div>";
  }

  function render(){
    $("stamp").textContent = "Updated " + D.now + ". Orders refresh every two minutes while open; Right now, every ten seconds.";
    $("now").innerHTML = renderNow();
    $("needs").innerHTML = renderNeeds();
    $("day").innerHTML = renderDay();
    if (!$("vlist")){ $("visitors").innerHTML = renderVisitorsShell(); renderVisitorList(); }
    if (VROWS.length <= 25) loadVisitors(false);   /* a list opened past its first page is left as it is */
    $("orders").innerHTML = renderOrders();
    $("nearly").innerHTML = renderNearly();
    $("twenty").innerHTML = renderTwenty();
    $("leads").innerHTML = renderLeads();
    $("week").innerHTML = renderWeek();
    $("health").innerHTML = renderHealth();
  }

  /* ── actions ── */
  function copy(text){
    function fallback(){
      var ta = document.createElement("textarea"); ta.value = text; ta.setAttribute("readonly", "");
      ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); toast("Copied"); } catch (e) { toast("Could not copy"); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ toast("Copied"); }, fallback);
    else fallback();
  }

  document.addEventListener("click", function(e){
    var el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    var act = el.getAttribute("data-act");
    if (act === "refresh"){ load(); }
    else if (act === "logout"){ call("POST", "/desk/logout").then(function(){ D = null; showGate(""); }); }
    else if (act === "view"){ VIEW = el.getAttribute("data-v"); $("day").innerHTML = renderDay(); }
    else if (act === "filter"){ FILTER = el.getAttribute("data-v"); OPEN_FORM = ""; $("orders").innerHTML = renderOrders(); }
    else if (act === "leads"){ LEADS_ALL = !LEADS_ALL; $("leads").innerHTML = renderLeads(); }
    else if (act === "visitor"){ e.preventDefault(); openVisitor(parseInt(el.getAttribute("data-k"), 10), el); }
    else if (act === "sheet-close"){ closeSheet(); }
    else if (act === "forget"){
      var fk = parseInt(el.getAttribute("data-k"), 10);
      if (!window.confirm("Delete everything kept about Visitor " + fk + "? Their history, and their name and contact on it, go for good. Their orders stay in Razorpay.")) return;
      el.disabled = true;
      call("POST", "/desk/forget", { k: fk }).then(function(j){
        if (j.ok){ closeSheet(); toast("Visitor " + fk + " deleted"); VD = null; loadVisitors(false); load(true); }
        else { el.disabled = false; toast("Not deleted (" + (j.reason || j.status) + ")"); }
      }, function(){ el.disabled = false; toast("Could not reach the worker"); });
    }
    else if (act === "vr"){ VR = el.getAttribute("data-v"); $("visitors").querySelectorAll('[data-act="vr"]').forEach(function(b){ b.setAttribute("aria-pressed", String(b === el)); }); VD = null; renderVisitorList(); loadVisitors(false); }
    else if (act === "vf"){ VF = el.getAttribute("data-v"); $("visitors").querySelectorAll('[data-act="vf"]').forEach(function(b){ b.setAttribute("aria-pressed", String(b === el)); }); VD = null; renderVisitorList(); loadVisitors(false); }
    else if (act === "vmore"){ loadVisitors(true); }
    else if (act === "feed"){ FEED_ALL = !FEED_ALL; $("now").innerHTML = renderNow(); var fb = $("now").querySelector('[data-act="feed"]'); if (fb) fb.focus(); }
    else if (act === "copy"){ copy(el.getAttribute("data-text")); }
    else if (act === "open"){
      OPEN_FORM = el.getAttribute("data-o"); $("orders").innerHTML = renderOrders();
      var f = document.querySelector('form.ship input[name="courier"]'); if (f) f.focus();
    }
    else if (act === "close"){ OPEN_FORM = ""; $("orders").innerHTML = renderOrders(); }
    else if (act === "goto"){
      e.preventDefault();
      var o = orderById(el.getAttribute("data-o"));
      if (o && (o.sent || o.refund === "full") && FILTER === "open") FILTER = "all";
      $("orders").innerHTML = renderOrders();
      var card = $("o-" + el.getAttribute("data-o")); if (card) card.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if (act === "release"){
      var rn = parseInt(el.getAttribute("data-n"), 10), what = el.getAttribute("data-v");
      if (what === "sell" && !window.confirm("Put " + no(rn) + " back on sale? Anyone can buy it on thekaal.co within a minute.")) return;
      el.disabled = true;
      call("POST", "/desk/release", { n: rn, action: what }).then(function(j){
        if (j.ok){ toast(what === "sell" ? no(rn) + " is back on sale" : no(rn) + " stays retired"); load(true); }
        else { el.disabled = false; toast("Not changed (" + (j.reason || j.status) + ")"); }
      }, function(){ el.disabled = false; toast("Could not reach the worker"); });
    }
    else if (act === "undo"){
      var n = parseInt(el.getAttribute("data-n"), 10);
      if (!window.confirm("Take back the dispatch mark on " + no(n) + "? An email already sent to the buyer cannot be unsent.")) return;
      el.disabled = true;
      call("POST", "/desk/dispatch", { o: el.getAttribute("data-o"), undo: true }).then(function(j){
        if (j.ok){ toast(no(n) + " is back to waiting for dispatch"); load(true); }
        else { el.disabled = false; toast("Could not undo (" + (j.reason || j.status) + ")"); }
      });
    }
  });

  document.addEventListener("submit", function(e){
    var f = e.target;
    if (!f.classList || !f.classList.contains("ship")) return;
    e.preventDefault();
    var n = parseInt(f.getAttribute("data-n"), 10), btn = f.querySelector("button[type=submit]");
    var body = { o: f.getAttribute("data-o"), courier: f.courier.value.trim(), tracking: f.tracking.value.trim(), url: f.url.value.trim(), notify: !!(f.notify && f.notify.checked && !f.notify.disabled) };
    if (body.notify && !body.tracking && !window.confirm("Email the buyer without a tracking number?")) return;
    btn.disabled = true;
    call("POST", "/desk/dispatch", body).then(function(j){
      if (!j.ok){ btn.disabled = false; toast("Not saved (" + (j.reason || j.status) + ")"); return; }
      OPEN_FORM = "";
      toast(no(n) + " marked dispatched" + (j.mailed ? ". Tracking emailed to " + j.to : body.notify ? ". The email did not go; check Health" : ""));
      load(true);
    }, function(){ btn.disabled = false; toast("Could not reach the worker"); });
  });

  /* The search waits for a pause in typing. */
  document.addEventListener("input", function(e){
    if (!e.target || e.target.id !== "vq") return;
    clearTimeout(vTimer);
    vTimer = setTimeout(function(){ VQ = e.target.value.trim(); VD = null; renderVisitorList(); loadVisitors(false); }, 350);
  });
  /* A tap on the dimmed backdrop, or Escape, closes the visitor. */
  $("sheet").addEventListener("click", function(e){ if (e.target === this) closeSheet(); });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape") closeSheet(); });

  /* ── the live view: every ten seconds while the desk is on screen ── */
  function live(){
    if (!D || liveBusy) return;
    liveBusy = true;
    fetch("/desk/live", { credentials: "same-origin", cache: "no-store", headers: { "X-Desk": "1" } }).then(function(r){
      if (r.status === 401){ showGate(""); return null; }
      return r.ok ? r.json() : null;
    }).then(function(j){
      if (!j || !D) return;
      LV = j;
      /* A button in here keeps its focus across the redraw. */
      var f = document.activeElement, act = f && $("now").contains(f) ? f.getAttribute("data-act") : "";
      $("now").innerHTML = renderNow();
      if (act){ var back = $("now").querySelector('[data-act="' + act + '"]'); if (back) back.focus(); }
      /* Today's totals, as they happen rather than every two minutes. */
      if (j.c && D.c && JSON.stringify(D.c.today || {}) !== JSON.stringify(j.c)){
        D.c.today = j.c;
        if (VIEW === "today") $("day").innerHTML = renderDay();
      }
      /* A sale the last full load has not seen: load it, address and all. */
      var p = j.live && j.live.paid && j.live.paid[0];
      if (p && p.ts > LAST_PAID){ if (LAST_PAID && !OPEN_FORM) load(true); LAST_PAID = p.ts; }
    }).catch(function(){ /* the last picture stands; the next try is ten seconds away */ })
      .then(function(){ liveBusy = false; });
  }
  setInterval(function(){ if (D && document.visibilityState === "visible") live(); }, 10000);

  /* Fresh while it is being looked at; never while a dispatch is being typed. */
  setInterval(function(){ if (D && !OPEN_FORM && document.visibilityState === "visible") load(true); }, 120000);
  document.addEventListener("visibilitychange", function(){
    if (D && document.visibilityState === "visible") live();
    if (D && !OPEN_FORM && document.visibilityState === "visible" && Date.now() - LOADED_AT > 60000) load(true);
  });

  load();
})();
</script>
</body></html>`;
}
