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

.health .it{display:grid;grid-template-columns:22px 1fr;gap:2px 8px}
.health .ic{font-weight:700}
.health .ic.y{color:var(--ok)} .health .ic.n{color:var(--bad)}
.health p{grid-column:2}
footer{color:var(--faint);font-size:12px;line-height:1.6;border-top:1px solid var(--line);padding-top:16px}
.toast{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);max-width:calc(100% - 32px);background:var(--bone);color:var(--bg);padding:10px 16px;border-radius:999px;font-size:14px;box-shadow:0 8px 30px rgba(0,0,0,.5);z-index:9}
.busy{opacity:.6;transition:opacity .2s}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
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
  <section class="s" id="needs"></section>
  <section class="s" id="day"></section>
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
<div class="toast" id="toast" role="status" hidden></div>

<script nonce="${nonce}">
(function(){
  "use strict";
  var D = null, VIEW = "today", FILTER = "open", OPEN_FORM = "", LEADS_ALL = false, LOADED_AT = 0, busy = false;
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
    return h + '<div class="o-foot mono">' + esc(o.id) + (o.orderId ? " &middot; " + esc(o.orderId) : "") + "</div></article>";
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
        "<p>" + esc(x.stage) + "</p>" + (x.email || x.contact ? "<p>" + (x.email ? esc(x.email) : "") + (x.email && x.contact ? " &middot; " : "") + (x.contact ? esc(x.contact) : "") + "</p>" : "") +
        ((x.email || x.contact) ? '<div class="row" style="margin-top:8px">' + contactButtons(x.email, x.contact, true) + "</div>" : '<p class="faint">No contact given for this one.</p>') + "</div>";
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

  function renderHealth(){
    return '<div class="sec-h"><h2>Health</h2></div><div class="card list health">' + (D.health || []).map(function(x){
      return '<div class="it"><span class="ic ' + (x.ok ? "y" : "n") + '">' + (x.ok ? "&#10003;" : "!") + "</span><b>" + esc(x.label) + "</b><p>" + esc(x.detail) + "</p></div>";
    }).join("") + "</div>";
  }

  function render(){
    $("stamp").textContent = "Updated " + D.now + ". Refreshes every two minutes while open.";
    $("needs").innerHTML = renderNeeds();
    $("day").innerHTML = renderDay();
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

  /* Fresh while it is being looked at; never while a dispatch is being typed. */
  setInterval(function(){ if (D && !OPEN_FORM && document.visibilityState === "visible") load(true); }, 120000);
  document.addEventListener("visibilitychange", function(){
    if (D && !OPEN_FORM && document.visibilityState === "visible" && Date.now() - LOADED_AT > 60000) load(true);
  });

  load();
})();
</script>
</body></html>`;
}
