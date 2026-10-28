/* ══════════════════════════════════════════════════════════════════
   KAAL · THE COMMAND CENTRE (the page)

   Served by the worker at /control (worker/control.js decides who may
   see what). It is the control room and the old desk in one: the orders
   and owners in the registry (/control/api/*), and the shop's own
   records, the live view, every visitor's history and the Insights
   (/desk/*, worker/kaal-sold-sync.js), behind one sign-in.

   One document, styles and script inline, nothing fetched from any other
   site; the script carries the nonce the worker's CSP names. ES5-shaped
   like the storefront. Every value that came from a buyer or a visitor is
   escaped before it is placed. Inside String.raw: no backticks and no
   dollar-brace in the script below.

   Built for one person running the business from a phone: a bottom bar
   on a phone, a sidebar on a computer. One tap marks a stage, with a ten
   second Undo before it is sent; the only motion is state.
   Keyboard: 1 to 9 open screens, / searches, r refreshes, u undoes,
   ? lists these.
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
<title>KAAL · Command centre</title>
<link rel="icon" href="/control/icon-192.png">
<link rel="manifest" href="/control/manifest.webmanifest">
<link rel="apple-touch-icon" href="/control/icon-192.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="KAAL">
<style>
:root{
  --bg:#0b0c0a; --side:#0e0f0d; --card:#141512; --card2:#1a1b17; --line:#25231e; --line2:#37332b;
  --bone:#EDE8DF; --mute:#B3AC9F; --faint:#8d877c; --gold:#C6A15B; --goldLit:#E0BE7C; --goldDim:rgba(198,161,91,.14);
  --ok:#86B592; --okDim:rgba(134,181,146,.13); --warn:#E0BE7C; --bad:#E08A70; --badDim:rgba(224,138,112,.13);
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  --r:12px;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--bone);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}
a{color:var(--goldLit);text-decoration:none}
a:hover{text-decoration:underline}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--goldLit);outline-offset:2px}
.num,.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.muted{color:var(--mute)}.faint{color:var(--faint)}.small{font-size:13px}.tiny{font-size:12px}
.sp{flex:1}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}
.stack>*+*{margin-top:12px}

/* ── the gate ── */
.gate{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.gate .box{width:100%;max-width:400px}
.brand{font-weight:300;letter-spacing:.55em;font-size:14px}
.brand span{letter-spacing:.22em;color:var(--gold);margin-left:.5em;font-size:10.5px;text-transform:uppercase}
.gate h1{font-family:var(--serif);font-weight:400;font-size:28px;margin:28px 0 6px}
.gate p{margin:0 0 18px}
.pw{position:relative}
.pw input{padding-right:84px}
.pw button{position:absolute;right:4px;top:4px;bottom:4px;min-height:0;padding:0 12px;border:0;background:var(--card2);border-radius:8px;color:var(--mute);cursor:pointer;font-size:13px}

/* ── frame: sidebar on a computer, a bar below on a phone ── */
.side{position:fixed;left:0;top:0;bottom:0;width:236px;background:var(--side);border-right:1px solid var(--line);display:flex;flex-direction:column;padding:20px 12px 14px;overflow-y:auto;z-index:6}
.side .brand{padding:0 10px 22px}
.navg{margin-bottom:16px}
.navg p{margin:0 10px 6px;font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--faint)}
.navb{display:flex;align-items:center;gap:10px;width:100%;min-height:40px;padding:8px 10px;border:0;border-radius:8px;background:none;color:var(--mute);cursor:pointer;text-align:left;font-size:14.5px}
.navb:hover{background:var(--card);color:var(--bone)}
.navb[aria-current="page"]{background:var(--card2);color:var(--bone);box-shadow:inset 2px 0 0 var(--gold)}
.navb .k{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--faint)}
.badge{margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:var(--gold);color:#111;font-size:11.5px;font-weight:700;display:inline-flex;align-items:center;justify-content:center}
.badge.bad{background:var(--bad)}
.side .foot{margin-top:auto;border-top:1px solid var(--line);padding:12px 10px 0}
.main{margin-left:236px;min-height:100vh}
.bar{position:sticky;top:0;z-index:5;background:rgba(11,12,10,.96);border-bottom:1px solid var(--line);padding:max(10px,env(safe-area-inset-top)) 24px 10px;display:flex;align-items:center;gap:12px;min-height:58px}
.bar h1{font-family:var(--serif);font-weight:400;font-size:22px;margin:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bar .brand{display:none}
.live{display:inline-flex;align-items:center;gap:7px;font-size:13px;color:var(--mute);white-space:nowrap}
.dot{width:8px;height:8px;border-radius:50%;background:var(--line2)}
.dot.on{background:var(--ok);box-shadow:0 0 0 0 rgba(134,181,146,.5);animation:pulse 2s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 rgba(134,181,146,.45)}100%{box-shadow:0 0 0 9px rgba(134,181,146,0)}}
.view{max-width:1120px;margin:0 auto;padding:22px 24px 60px}
.tabs{display:none}
.stg{background:#3a2a12;color:var(--goldLit);font-size:13px;padding:8px 24px}

@media (max-width:1023px){
  .side{display:none}
  .main{margin-left:0}
  .bar{padding:max(10px,env(safe-area-inset-top)) 16px 10px}
  .bar .brand{display:block;font-size:12px}
  .bar h1{font-size:19px}
  .view{padding:16px 16px calc(96px + env(safe-area-inset-bottom))}
  .tabs{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:7;background:rgba(11,12,10,.98);border-top:1px solid var(--line);padding:4px 4px calc(4px + env(safe-area-inset-bottom))}
  .tabs button{flex:1;min-height:52px;background:none;border:0;color:var(--mute);font-size:11.5px;letter-spacing:.02em;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;position:relative}
  .tabs button i{font-style:normal;font-size:17px;line-height:1}
  .tabs button[aria-current="page"]{color:var(--bone)}
  .tabs button[aria-current="page"]::before{content:"";position:absolute;top:0;left:30%;right:30%;height:2px;background:var(--gold);border-radius:2px}
  .tabs .badge{position:absolute;top:4px;left:56%;margin:0;min-width:17px;height:17px;font-size:10px}
}

/* ── pieces of a screen ── */
h2{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin:30px 0 10px}
.view>h2:first-child{margin-top:4px}
h2 .count{color:var(--faint);letter-spacing:0;margin-left:6px;font-weight:400}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:16px}
.card+.card{margin-top:10px}
.card.tight{padding:4px 0}
.card h3{margin:0 0 4px;font-size:15px;font-weight:600}
.empty{color:var(--mute);text-align:center;padding:26px 16px}
.grid{display:grid;gap:12px}
.g2{grid-template-columns:repeat(2,minmax(0,1fr))}
.g3{grid-template-columns:repeat(3,minmax(0,1fr))}
.g4{grid-template-columns:repeat(4,minmax(0,1fr))}
@media (max-width:860px){.g3,.g4{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:560px){.g2.solo{grid-template-columns:1fr}}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;min-width:0}
.kpi .v{font-family:var(--mono);font-size:26px;line-height:1.15;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kpi .l{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute);margin-top:4px}
.kpi .d{font-size:12.5px;color:var(--faint);margin-top:2px}
.kpi.go{cursor:pointer}
.kpi.go:hover{border-color:var(--line2)}
.up{color:var(--ok)}.down{color:var(--bad)}
.kpis{display:grid;gap:10px;grid-template-columns:repeat(6,minmax(0,1fr))}
@media (max-width:1180px){.kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:560px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.kpis .kpi .l{margin:0 0 6px}
.kpis .kpi .v{font-size:25px}
.kpis .kpi .d{font-size:12px}
.mini{display:flex;align-items:flex-end;gap:1px;height:26px;margin-top:9px}
.mini i{flex:1;background:var(--gold);opacity:.75;border-radius:1px;min-height:1px}
.mini i.z{background:var(--line2);opacity:1}
.chart{display:flex;align-items:flex-end;gap:3px;height:170px;margin-top:14px;padding-top:18px}
.cday{flex:1;height:100%;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;position:relative;min-width:0}
.cday .b{display:block;width:100%;max-width:34px;background:#4a463d;border-radius:3px 3px 0 0}
.cday.now .b{background:var(--bone)}
.cday .o{font-family:var(--mono);font-size:10.5px;color:#111;background:var(--gold);border-radius:99px;min-width:17px;height:17px;padding:0 4px;display:flex;align-items:center;justify-content:center;margin-bottom:4px;font-weight:700}
.legend{font-size:12px;color:var(--faint);display:inline-flex;align-items:center;gap:6px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-left:8px}
.legend i.lv{background:#4a463d}.legend i.lo{background:var(--gold);border-radius:50%}
.strip.half{grid-template-columns:repeat(10,minmax(0,1fr))}
.stagek{background:var(--card2);border-radius:9px;padding:10px;text-align:center;cursor:pointer}
.stagek b{display:block;font-size:22px}
.stagek span{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mute)}
.card.go{cursor:pointer}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:44px;padding:9px 16px;border-radius:9px;border:1px solid var(--line2);background:var(--card2);color:var(--bone);cursor:pointer;text-decoration:none!important;font-size:14px;white-space:nowrap}
.btn:hover{border-color:#4a4539}
.btn.go{background:var(--bone);color:#111;border-color:var(--bone);font-weight:600}
.btn.gold{background:var(--gold);color:#111;border-color:var(--gold);font-weight:600}
.btn.warn{border-color:#6b3a2c;color:var(--bad);background:transparent}
.btn.ghost{background:transparent}
.btn.sm{min-height:36px;padding:6px 12px;font-size:13px;border-radius:8px}
.btn[disabled]{opacity:.45;cursor:default}
input,select,textarea{min-height:44px;width:100%;background:#0d0e0c;border:1px solid var(--line2);border-radius:9px;padding:10px 12px;color:var(--bone)}
input::placeholder{color:var(--faint)}
textarea{min-height:88px}
label{display:block;font-size:13px;color:var(--mute);margin:12px 0 5px}
.check{display:flex;gap:10px;align-items:center;min-height:44px}.check input{width:22px;min-height:22px}.check label{margin:0;color:var(--bone)}
.err{color:var(--bad);min-height:1.3em;font-size:14px;margin:8px 0 0}
.seg{display:inline-flex;border:1px solid var(--line2);border-radius:9px;overflow:hidden;flex-shrink:0}
.seg button{min-height:36px;padding:6px 12px;background:none;border:0;color:var(--mute);cursor:pointer;font-size:13px}
.seg button+button{border-left:1px solid var(--line2)}
.seg button[aria-pressed="true"]{background:var(--card2);color:var(--bone)}
.chips{display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;scrollbar-width:none}
.chips::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;min-height:36px;padding:6px 13px;border-radius:99px;border:1px solid var(--line2);background:none;color:var(--mute);cursor:pointer;font-size:13px;white-space:nowrap}
.chip[aria-pressed="true"]{background:var(--bone);color:#111;border-color:var(--bone)}
.chip.x{border-color:var(--gold);color:var(--goldLit)}
.pill{display:inline-block;font-size:11px;padding:2px 8px;border-radius:99px;border:1px solid var(--line2);color:var(--mute);letter-spacing:.03em;white-space:nowrap}
.pill.ok{color:var(--ok);border-color:#2e4a35}.pill.bad{color:var(--bad);border-color:#5a2e24}.pill.gold{color:var(--goldLit);border-color:#5a4724}
.pills{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.list>*{display:block;padding:13px 16px;border-top:1px solid var(--line)}
.list>*:first-child{border-top:0}
button.lrow{width:100%;text-align:left;background:none;border-left:0;border-right:0;border-bottom:0;color:inherit;cursor:pointer;font:inherit}
button.lrow:hover{background:var(--card2)}
.lrow .t{display:flex;align-items:baseline;gap:10px;justify-content:space-between}
.lrow .m{font-size:13px;color:var(--mute);margin-top:2px}
table{width:100%;border-collapse:collapse;font-size:13.5px}
td,th{text-align:left;padding:10px 12px;border-top:1px solid var(--line);vertical-align:top}
tr:first-child td,tr:first-child th{border-top:0}
th{font-weight:500;color:var(--faint);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase}
td.n,th.n{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
@media (max-width:560px){td,th{padding:9px 7px}th{font-size:10.5px;letter-spacing:.05em}}
tr.go{cursor:pointer}tr.go:hover td{background:var(--card2)}
.scroll{overflow-x:auto}
.alert{border-left:3px solid var(--gold);background:var(--card);border-radius:0 var(--r) var(--r) 0;padding:13px 16px}
.alert.act{border-left-color:var(--bad)}
.alert+.alert{margin-top:8px}
.alert b{display:block}
.alert p{margin:3px 0 0;color:var(--mute);font-size:13.5px}
.alert .row{margin-top:10px}
.calm{color:var(--ok);padding:14px 16px;background:var(--okDim);border-radius:var(--r)}

/* the twenty */
.strip{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:4px;margin-top:12px}
@media (min-width:700px){.strip{grid-template-columns:repeat(20,minmax(0,1fr))}}
.cell{aspect-ratio:1;border-radius:5px;border:1px solid var(--line2);display:flex;align-items:center;justify-content:center;font-size:11px;font-family:var(--mono);color:var(--mute)}
.cell.sold,.cell.placed,.cell.delivered,.cell.registered{background:var(--bone);color:#111;border-color:var(--bone)}
.cell.held{border-color:var(--gold);color:var(--goldLit);border-style:dashed}
.cell.unavailable,.cell.retired,.cell.withheld{opacity:.45;border-style:dashed}
.cell.stolen,.cell.reported_stolen{background:#5a2418;border-color:var(--bad);color:var(--bone)}

/* bars: a label, a bar, its numbers */
.bars{display:grid;gap:9px}
.brow{display:grid;grid-template-columns:minmax(90px,34%) 1fr auto;gap:10px;align-items:center;font-size:13.5px}
.brow.go{cursor:pointer}
.brow .lab{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.brow .track{height:8px;background:var(--card2);border-radius:4px;overflow:hidden}
.brow .track i{display:block;height:100%;background:var(--gold);border-radius:4px;min-width:2px}
.brow .track i.ok{background:var(--ok)}
.brow .val{font-family:var(--mono);font-size:12.5px;color:var(--mute);white-space:nowrap;text-align:right}
.cols{display:flex;align-items:flex-end;gap:3px;height:96px;margin-top:6px}
.cols i{flex:1;background:var(--gold);border-radius:3px 3px 0 0;min-height:2px;opacity:.85}
.cols i.z{background:var(--line2);opacity:1}
.cols i.peak{background:var(--goldLit);opacity:1}
.axis{display:flex;justify-content:space-between;font-size:11px;color:var(--faint);margin-top:5px;font-family:var(--mono)}
.funnel .st{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--line);font-size:14px}
.funnel .st:first-child{border-top:0}
.funnel .track{height:10px;background:var(--card2);border-radius:5px;overflow:hidden}
.funnel .track i{display:block;height:100%;background:var(--gold)}
.funnel .val{font-family:var(--mono);font-size:13px;text-align:right;white-space:nowrap}
.funnel .val small{color:var(--faint);margin-left:6px}
.funnel .hdr{display:grid;grid-template-columns:minmax(120px,38%) 1fr auto;gap:10px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);padding-bottom:6px}
.funnel .y{display:inline-block;min-width:52px;text-align:right;color:var(--faint)}
td.d{white-space:nowrap}
.heat{display:grid;grid-template-columns:repeat(10,minmax(0,1fr));gap:4px}
.heat div{aspect-ratio:1;border-radius:6px;border:1px solid var(--line2);display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:var(--mono);font-size:11px;position:relative}
.heat div b{font-size:12px}
.heat div small{font-size:9.5px;color:var(--faint)}
.heat div.gone{outline:1px solid var(--bone);outline-offset:-3px}

/* visitors */
.score{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:24px;padding:0 7px;border-radius:7px;font-family:var(--mono);font-size:12.5px;border:1px solid var(--line2);color:var(--faint);flex-shrink:0}
.score.warm{border-color:#6a5530;color:var(--goldLit)}
.score.hot{background:var(--gold);border-color:var(--gold);color:#111;font-weight:700}
.score.paid{background:var(--ok);border-color:var(--ok);color:#0b1a10;font-weight:700}
.vr{display:flex;gap:12px;align-items:flex-start}
.vr .body{flex:1;min-width:0}
.vr .t b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.facts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 16px;margin-top:12px}
.facts div{min-width:0}
.facts span{display:block;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.facts b{font-weight:500;font-size:14px;word-break:break-word}
.meter{height:6px;background:var(--card2);border-radius:3px;overflow:hidden;margin-top:6px}
.meter i{display:block;height:100%;background:var(--gold)}
.tl-v{margin:20px 0 6px;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute)}
.tl{list-style:none;margin:0;padding:0 0 0 14px;border-left:1px solid var(--line2)}
.tl li{position:relative;padding:5px 0 5px 12px;font-size:14px;display:flex;gap:10px}
.tl li::before{content:"";position:absolute;left:-18px;top:13px;width:7px;height:7px;border-radius:50%;background:var(--line2)}
.tl li.k::before{background:var(--gold)}
.tl li.p::before{background:var(--ok)}
.tl .tm{font-family:var(--mono);font-size:12px;color:var(--faint);min-width:58px;padding-top:2px}
.spark{display:flex;align-items:flex-end;gap:2px;height:44px;margin-top:12px}
.spark i{flex:1;background:var(--ok);opacity:.75;border-radius:2px 2px 0 0;min-height:2px}
.spark i.z{background:var(--line2);opacity:1}
.wherechips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.wherechips span{font-size:12.5px;padding:3px 9px;border-radius:99px;background:var(--card2);color:var(--mute)}
.wherechips b{color:var(--bone);font-family:var(--mono)}

/* orders */
.stages{display:flex;gap:4px;margin:10px 0}
.stages i{flex:1;height:4px;border-radius:2px;background:var(--line2)}
.stages i.on{background:var(--gold)}
.ohead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.ohead b{font-family:var(--mono);font-size:16px}
.oact{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}

/* overlays */
.toast{position:fixed;left:16px;right:16px;bottom:calc(20px + env(safe-area-inset-bottom));max-width:560px;margin:0 auto;background:var(--bone);color:#111;border-radius:12px;padding:12px 14px;display:flex;gap:12px;align-items:center;z-index:12;box-shadow:0 10px 36px rgba(0,0,0,.55)}
@media (max-width:1023px){.toast{bottom:calc(76px + env(safe-area-inset-bottom))}}
.toast .btn{background:#111;color:var(--bone);border-color:#111;min-height:40px}
.toast.bad{background:var(--bad)}
.tbar{height:3px;background:#111;opacity:.25;border-radius:2px;margin-top:6px;transform-origin:left;transition:transform 10s linear}
.sheet{position:fixed;inset:0;background:rgba(0,0,0,.62);z-index:10;display:flex;align-items:flex-end;justify-content:center}
.sheet .in{background:var(--card);border:1px solid var(--line);width:100%;max-width:760px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 18px calc(22px + env(safe-area-inset-bottom))}
@media (min-width:1024px){.sheet{align-items:center}.sheet .in{border-radius:16px;max-height:86vh}}
.sheet .hd{display:flex;align-items:center;gap:10px;position:sticky;top:-18px;background:var(--card);padding:6px 0 10px;margin-top:-6px;z-index:1}
.sheet .hd h2{margin:0;flex:1;font-family:var(--serif);font-weight:400;font-size:21px;letter-spacing:0;text-transform:none;color:var(--bone)}
iframe{width:100%;height:68vh;border:1px solid var(--line2);border-radius:10px;background:#F4F1EA}
.more{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
.more button{min-height:56px;justify-content:flex-start}
.key{font-family:var(--mono);font-size:17px;letter-spacing:.06em;word-break:break-all}
.note{font-size:13px;color:var(--mute);margin:10px 0 0}
.copy{font-family:var(--mono);font-size:12.5px;background:#0d0e0c;border:1px solid var(--line2);border-radius:8px;padding:10px 12px;word-break:break-all}
/* Activity */
.astat{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 4px}
.astat span{background:var(--card);border:1px solid var(--line);border-radius:99px;padding:5px 12px;font-size:13px;color:var(--mute)}
.astat b{color:var(--bone);font-weight:600;font-variant-numeric:tabular-nums}
.aday{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:20px 0 6px}
.alist{border-left:1px solid var(--line);margin-left:70px}
.arow{display:grid;grid-template-columns:62px 1fr;gap:16px;position:relative;margin-left:-70px;padding:9px 12px 9px 0;width:calc(100% + 70px);text-align:left;background:none;border:0;border-radius:10px;color:inherit;font:inherit}
button.arow{cursor:pointer}button.arow:hover,button.arow:focus-visible{background:var(--card)}
.arow .at{font-size:12px;color:var(--faint);text-align:right;font-variant-numeric:tabular-nums;padding-top:1px}
.arow::before{content:"";position:absolute;left:66px;top:15px;width:9px;height:9px;border-radius:50%;background:var(--line2);box-shadow:0 0 0 3px var(--bg)}
.arow .tx{font-size:14px;line-height:1.4}.arow .m{font-size:12px;color:var(--faint);margin-top:2px}
.arow.k-paid::before{background:var(--ok);box-shadow:0 0 0 3px var(--bg),0 0 12px var(--ok)}.arow.k-paid .tx{color:var(--ok);font-weight:600}
.arow.k-money::before{background:var(--gold)}.arow.k-intent::before{background:var(--goldLit);opacity:.6}
.arow.k-arrive::before{background:var(--mute)}.arow.k-you::before{background:#8FA8C8}.arow.k-own::before{background:#B49BD0}.arow.k-sys::before{background:var(--bad)}
.arow.hot .m b{color:var(--goldLit)}
.arow.fresh{animation:fresh 2.6s ease-out}
@keyframes fresh{0%{background:var(--goldDim)}100%{background:transparent}}
.arow .tx, .arow .m{padding-left:10px}
/* Command bar */
.cmdb{display:flex;align-items:center;gap:8px;background:var(--card);border:1px solid var(--line2);border-radius:99px;color:var(--mute);padding:6px 12px;font:inherit;font-size:13px;cursor:pointer;min-width:0}
.cmdb:hover{border-color:var(--gold);color:var(--bone)}.cmdb kbd{font:11px var(--mono);border:1px solid var(--line2);border-radius:5px;padding:1px 5px;color:var(--faint)}
.cmdex{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.cmdex button{background:none;border:1px dashed var(--line2);border-radius:99px;color:var(--mute);font:inherit;font-size:12px;padding:4px 10px;cursor:pointer}
.cmdex button:hover{border-color:var(--gold);color:var(--bone)}
.obd{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}
.ocard{display:block;text-align:left;width:100%;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:14px 16px;color:inherit;font:inherit;cursor:pointer;transition:border-color .2s}
.ocard:hover,.ocard:focus-visible{border-color:var(--gold)}
.ow{margin:10px 0 6px}.wclk{font-size:14px;color:var(--bone)}.wclk b{font-family:var(--serif);font-weight:400;font-size:22px}.wclk .t{color:var(--mute);margin-left:6px}
.wbar{display:block;height:2px;background:var(--line2);border-radius:2px;margin-top:6px;overflow:hidden}.wbar i{display:block;height:100%;background:var(--gold)}
.card.dz table td{padding:4px 0;border:0}
.saleBox{border:1px solid var(--line2);border-radius:var(--r);padding:14px;margin:14px 0;background:var(--card2)}
.saleBox .big{font-family:var(--serif);font-size:20px}
.arow .at{white-space:nowrap}
@media (max-width:760px){.cmdb{padding:6px 9px}.cmdb span.t,.cmdb kbd{display:none}.bar [data-act="refresh"]{display:none}.alist{margin-left:62px}.arow{grid-template-columns:54px 1fr;gap:14px;margin-left:-62px;width:calc(100% + 62px)}.arow::before{left:58px}.arow .at{font-size:11px}}
@media (prefers-reduced-motion:reduce){.tbar{transition:none}.dot.on{animation:none}.arow.fresh{animation:none}}
</style>
</head>
<body>
${staging ? '<div class="stg">Staging: Razorpay test mode. Every email goes to the owner only.</div>' : ""}

<section class="gate" id="gate" hidden>
  <div class="box">
    <div class="brand">KAAL<span>Command centre</span></div>
    <h1 id="gateT">Welcome back</h1>
    <form id="fPass" novalidate>
      <p class="muted" id="gateLead">Your passcode opens this phone for thirty days.</p>
      <label for="pass">Passcode</label>
      <div class="pw"><input id="pass" type="password" autocomplete="current-password" required><button type="button" id="peek" aria-pressed="false">Show</button></div>
      <button class="btn go" type="submit" style="width:100%;margin-top:14px" id="passGo">Open</button>
      <p class="center small" style="margin-top:16px"><a href="#" id="useCode">Use an emailed code instead</a></p>
    </form>
    <form id="fEmail" hidden novalidate><p class="muted">A six-digit code comes to the shop's admin address. It works once, for ten minutes.</p>
      <label for="email">Admin email</label><input id="email" type="email" autocomplete="email" required>
      <button class="btn go" type="submit" style="width:100%;margin-top:14px">Send the code</button>
      <p class="small" style="margin-top:16px"><a href="#" class="usePass">Use the passcode instead</a></p></form>
    <form id="fCode" hidden novalidate><label for="code">The code from the email</label><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
      <div class="row" style="margin-top:14px"><button class="btn go" type="submit">Continue</button><button class="btn ghost" type="button" id="again">Send another</button></div></form>
    <div id="enroll" hidden><p>Add KAAL to your authenticator app. Tap the link on this phone, or type the key.</p>
      <p><a id="otp" class="btn" href="#">Open in authenticator app</a></p><p class="key" id="key"></p></div>
    <form id="fTotp" hidden novalidate><label for="totp">The six digits your authenticator app shows for KAAL</label><input id="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
      <button class="btn go" type="submit" style="width:100%;margin-top:14px">Open the command centre</button></form>
    <p class="err" id="gateErr" role="alert"></p>
  </div>
</section>

<div id="app" hidden>
  <aside class="side" aria-label="Screens">
    <div class="brand">KAAL<span>Command</span></div>
    <nav id="sideNav"></nav>
    <div class="foot"><button class="navb" id="out" type="button">Sign out</button><p class="tiny faint" style="margin:6px 10px 0">Press ? for shortcuts</p></div>
  </aside>
  <div class="main">
    <header class="bar">
      <div class="brand">KAAL</div>
      <h1 id="title">Today</h1>
      <button class="cmdb" type="button" data-act="cmd" aria-label="Tell the command centre what to do"><span aria-hidden="true">&#8984;</span><span class="t">Tell it what to do</span><kbd>K</kbd></button>
      <span class="live" id="liveTop" title="People on the site now"><span class="dot" id="liveDot"></span><span id="liveN">·</span></span>
      <button class="btn sm ghost" type="button" data-act="refresh" aria-label="Refresh">Refresh</button>
    </header>
    <main class="view" id="view"></main>
  </div>
  <nav class="tabs" id="tabs" aria-label="Screens">
    <button data-go="today"><i aria-hidden="true">&#9673;</i>Today</button>
    <button data-go="orders"><i aria-hidden="true">&#9635;</i>Orders<span class="badge" data-badge="orders" hidden></span></button>
    <button data-go="visitors"><i aria-hidden="true">&#9737;</i>Visitors<span class="badge" data-badge="visitors" hidden></span></button>
    <button data-go="activity"><i aria-hidden="true">&#8776;</i>Activity</button>
    <button data-act="more"><i aria-hidden="true">&#8943;</i>More<span class="badge" data-badge="more" hidden></span></button>
  </nav>
</div>

<div class="toast" id="toast" role="status" aria-live="polite" hidden></div>
<div class="sheet" id="sheet" hidden><div class="in" role="dialog" aria-modal="true" aria-labelledby="sheetT"><div class="hd"><h2 id="sheetT"></h2><button class="btn sm ghost" data-act="close">Close</button></div><div id="sheetB"></div></div></div>

<script nonce="${nonce}">
(function(){
"use strict";

/* ══ helpers ══ */
var $ = function(id){ return document.getElementById(id); };
function esc(v){ return String(v == null ? "" : v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); }
function pad(n){ n = +n; return n < 10 ? "0" + n : "" + n; }
function rupees(p){ return "₹" + Math.round((p || 0) / 100).toLocaleString("en-IN"); }
function plural(n, one, many){ return n + " " + (n === 1 ? one : (many || one + "s")); }
function pct(n, of){ if(!of) return "–"; var v = Math.round(n / of * 100); return v === 0 && n > 0 ? "<1%" : v + "%"; }
function when(iso){ if(!iso) return ""; var d = new Date(iso); return d.toLocaleString("en-IN", { timeZone:"Asia/Kolkata", day:"numeric", month:"short", hour:"numeric", minute:"2-digit" }); }
var MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"], WD = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
function ist(ms){ return new Date(ms + 5.5 * 3600000); }
function clock(ms){ var d = ist(ms), h = d.getUTCHours(); return (h % 12 || 12) + ":" + pad(d.getUTCMinutes()) + " " + (h >= 12 ? "pm" : "am"); }
function dayAt(ms){ var d = ist(ms); return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]; }
function seenAt(ms){ return dayAt(ms) === dayAt(Date.now()) ? clock(ms) : dayAt(ms) + ", " + clock(ms); }
function dayShort(day){ var d = new Date(day + "T12:00:00Z"); return WD[d.getUTCDay()] + " " + d.getUTCDate(); }
function stay(ms){ return ms >= 5000 ? took(ms) : "a few seconds"; }
function cleanSrc(k){ k = String(k || "").replace(/^an? /, ""); return k.charAt(0).toUpperCase() + k.slice(1); }
var PAGESN = { home:"the shop", about:"the About page", manifesto:"the manifesto", movement:"the movement page", provenance:"Who is selling this", legal:"terms and privacy", claimed:"the thank-you page" };
function took(ms){ var t = Math.max(0, Math.round(ms / 1000)); return t < 60 ? t + "s" : t < 3600 ? Math.floor(t / 60) + "m " + pad(t % 60) + "s" : Math.floor(t / 3600) + "h " + pad(Math.floor(t % 3600 / 60)) + "m"; }
function waNum(phone){ var d = String(phone || "").replace(/\D/g, ""); if(d.length === 10) d = "91" + d; if(d.length === 11 && d.charAt(0) === "0") d = "91" + d.slice(1); return d.length >= 11 ? d : ""; }
var SOURCES = { instagram:"Instagram", ig:"Instagram", facebook:"Facebook", fb:"Facebook", meta:"Meta ad", google:"Google", "google ads":"Google Ads", bing:"Bing", x:"X",
  youtube:"YouTube", whatsapp:"WhatsApp", linkedin:"LinkedIn", chatgpt:"ChatGPT", perplexity:"Perplexity", duckduckgo:"DuckDuckGo", direct:"Direct", "thekaal.co":"thekaal.co" };
function srcName(v){ var s = v.s || "", n = SOURCES[s] || v.from || s; if(v.app && (!s || s === "direct" || s === "meta")) n = v.app; return n || "Direct"; }
function devName(v){ return v.os || ({ computer:"Computer", tablet:"Tablet", phone:"Phone" })[v.dev] || ""; }
function place(v){ return v.city || [v.gcity, v.region].filter(Boolean).join(", "); }
function scoreTag(v){
  var paid = v.paid && v.paid.length, s = paid ? 100 : (v.score || 0);
  var cls = paid ? "paid" : s >= 50 ? "hot" : s >= 25 ? "warm" : "";
  return '<span class="score ' + cls + '" title="' + (paid ? "Bought" : s >= 50 ? "Hot: close to buying" : s >= 25 ? "Warm" : "Browsing") + '">' + (paid ? "Paid" : s) + "</span>";
}
function contactBtns(email, phone){
  var w = waNum(phone), o = [];
  if(w) o.push('<a class="btn sm gold" href="https://wa.me/' + w + '" target="_blank" rel="noopener">WhatsApp</a>');
  if(phone) o.push('<a class="btn sm" href="tel:' + esc(phone) + '">Call</a>');
  if(email) o.push('<a class="btn sm" href="mailto:' + esc(email) + '">Email</a>');
  return o.join("");
}

function api(method, path, body, raw){
  var o = { method:method, credentials:"same-origin", cache:"no-store", headers:{ "X-KAAL":"1", "X-Desk":"1" } };
  if(raw){ o.body = raw; o.headers["Content-Type"] = raw.type; }
  else if(body !== undefined){ o.body = JSON.stringify(body); o.headers["Content-Type"] = "application/json"; }
  return fetch(path, o).then(function(r){
    return r.json().catch(function(){ return { ok:false }; }).then(function(j){ j._status = r.status; if(r.status === 401 && j.reason !== "wrong") signedOut(j.reason); return j; });
  }, function(){ return { ok:false, _status:0, why:"Could not reach the server. Check the connection." }; });
}
var tt = null;
function say(msg, bad){ var t = $("toast"); if(PENDING) return; t.className = "toast" + (bad ? " bad" : ""); t.innerHTML = '<span class="sp">' + esc(msg) + "</span>"; t.hidden = false; clearTimeout(tt); tt = setTimeout(function(){ if(!PENDING) t.hidden = true; }, 3800); }
function copy(text){
  function fb(){ var a = document.createElement("textarea"); a.value = text; a.style.position = "fixed"; a.style.opacity = "0"; document.body.appendChild(a); a.select(); try{ document.execCommand("copy"); say("Copied"); }catch(e){ say("Could not copy", true); } document.body.removeChild(a); }
  if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function(){ say("Copied"); }, fb); else fb();
}

/* ══ signing in ══ */
var EMAIL = "", SIGNED = false;
function gate(step, err){
  SIGNED = false; stopLive();
  $("gate").hidden = false; $("app").hidden = true;
  ["fPass","fEmail","fCode","fTotp","enroll"].forEach(function(id){ $(id).hidden = true; });
  $("gateErr").textContent = err || "";
  if(step === "pass"){ $("fPass").hidden = false; $("gateT").textContent = "Welcome back"; setTimeout(function(){ $("pass").focus(); }, 30); }
  if(step === "email"){ $("fEmail").hidden = false; $("gateT").textContent = "Sign in by email"; $("email").focus(); }
  if(step === "code"){ $("fCode").hidden = false; $("gateT").textContent = "Check your email"; $("code").value = ""; $("code").focus(); }
  if(step === "enroll"){ $("enroll").hidden = false; $("fTotp").hidden = false; $("gateT").textContent = "One more lock";
    api("POST", "/auth/totp/enroll", {}).then(function(j){ if(j.ok){ $("key").textContent = j.key; $("otp").href = j.uri; } else $("gateErr").textContent = "Could not start the authenticator. Sign in again."; }); }
  if(step === "totp"){ $("fTotp").hidden = false; $("gateT").textContent = "Your authenticator"; $("totp").value = ""; $("totp").focus(); }
}
function signedOut(reason){ if(!SIGNED) return; gate(reason === "mfa" ? "totp" : "pass", "Signed out. Open it again with your passcode."); }
var WHY = { wrong:"That passcode is not right.", rate:"Too many tries from here. Wait fifteen minutes, or use an emailed code.", paused:"Too many wrong passcodes from everywhere in the last hour, so the passcode is paused. Use an emailed code.",
  off:"No passcode is set yet. Use an emailed code.", expired:"That code has expired or was used. Ask for another.", tries:"Too many wrong tries for that code. Ask for another.",
  invalid:"That does not look like an email address.", used:"That code was already used. Wait for the next one.", locked:"Too many wrong codes. Sign in again from the start.", "not-admin":"This is the shop owner's page only." };
$("peek").addEventListener("click", function(){ var p = $("pass"), on = p.type === "password"; p.type = on ? "text" : "password"; this.textContent = on ? "Hide" : "Show"; this.setAttribute("aria-pressed", String(on)); p.focus(); });
$("fPass").addEventListener("submit", function(e){ e.preventDefault(); var b = $("passGo"); b.disabled = true; $("gateErr").textContent = "";
  api("POST", "/auth/passcode", { passcode: $("pass").value }).then(function(j){
    b.disabled = false;
    if(!j.ok){ $("gateErr").textContent = (WHY[j.reason] || j.why || "That did not work. Try again.") + (j.reason === "wrong" && j.left <= 3 ? " " + plural(j.left, "try", "tries") + " left before a fifteen minute wait." : ""); $("pass").select(); return; }
    $("pass").value = "";
    if(j.mfa === "none") start(); else gate(j.mfa === "enroll" ? "enroll" : "totp");
  }); });
$("useCode").addEventListener("click", function(e){ e.preventDefault(); gate("email"); });
Array.prototype.forEach.call(document.querySelectorAll(".usePass"), function(a){ a.addEventListener("click", function(e){ e.preventDefault(); gate("pass"); }); });
$("fEmail").addEventListener("submit", function(e){ e.preventDefault(); EMAIL = $("email").value.trim();
  api("POST", "/auth/start", { email: EMAIL }).then(function(j){ if(j.ok) gate("code"); else gate("email", WHY[j.reason] || "That did not work. Try again."); }); });
$("again").addEventListener("click", function(){ api("POST", "/auth/start", { email: EMAIL }).then(function(){ gate("code", "Another code is on its way."); }); });
$("fCode").addEventListener("submit", function(e){ e.preventDefault();
  api("POST", "/auth/verify", { email: EMAIL, code: $("code").value }).then(function(j){
    if(!j.ok){ gate(j.reason === "expired" || j.reason === "tries" ? "email" : "code", WHY[j.reason] || "That did not work."); return; }
    if(j.role !== "admin"){ gate("pass", WHY["not-admin"]); return; }
    if(j.mfa === "none"){ start(); return; }
    gate(j.mfa === "enroll" ? "enroll" : "totp");
  }); });
$("fTotp").addEventListener("submit", function(e){ e.preventDefault();
  api("POST", "/auth/totp", { code: $("totp").value }).then(function(j){
    if(j.ok){ start(); return; }
    if(j.reason === "locked"){ gate("pass", WHY.locked); return; }
    $("gateErr").textContent = WHY[j.reason] || "That code is not right."; $("totp").value = ""; }); });
$("out").addEventListener("click", function(){ api("POST", "/auth/logout", {}).then(function(){ gate("pass"); }); });

/* ══ screens ══ */
var NAV = [
  { g:"Run",  v:"today",     t:"Today" },
  { g:"Run",  v:"activity",  t:"Activity, live" },
  { g:"Run",  v:"orders",    t:"Orders" },
  { g:"Run",  v:"approvals", t:"Approvals" },
  { g:"Grow", v:"visitors",  t:"Visitors and leads" },
  { g:"Grow", v:"insights",  t:"Insights" },
  { g:"Grow", v:"followups", t:"Follow-ups" },
  { g:"Grow", v:"ai",        t:"AI search" },
  { g:"Keep", v:"pieces",    t:"The twenty" },
  { g:"Keep", v:"owners",    t:"Owners" },
  { g:"Keep", v:"list",      t:"Series 02 list" },
  { g:"System", v:"emails",  t:"Emails" },
  { g:"System", v:"settings",t:"Settings" },
  { g:"System", v:"audit",   t:"Audit and export" },
  { g:"System", v:"health",  t:"Health" }
];
var KEYS = ["today","activity","orders","visitors","insights","approvals","pieces","owners","settings"];
var VIEW = "today", PARAMS = {}, DATA = {}, BADGE = {};
(function(){
  var g = "", h = "";
  NAV.forEach(function(n){
    if(n.g !== g){ if(g) h += "</div>"; g = n.g; h += '<div class="navg"><p>' + g + "</p>"; }
    var k = KEYS.indexOf(n.v);
    h += '<button class="navb" data-go="' + n.v + '">' + n.t + '<span class="badge" data-badge="' + n.v + '" hidden></span>' + (k > -1 ? '<span class="k">' + (k + 1) + "</span>" : "") + "</button>";
  });
  $("sideNav").innerHTML = h + "</div>";
})();
function titleOf(v){ for(var i = 0; i < NAV.length; i++) if(NAV[i].v === v) return NAV[i].t; return "KAAL"; }
function setBadge(k, n, bad){
  BADGE[k] = n || 0;
  Array.prototype.forEach.call(document.querySelectorAll('[data-badge="' + k + '"]'), function(b){ b.hidden = !n; b.textContent = n > 99 ? "99+" : n; b.className = "badge" + (bad ? " bad" : ""); });
  var more = (BADGE.approvals || 0);
  Array.prototype.forEach.call(document.querySelectorAll('[data-badge="more"]'), function(b){ b.hidden = !more; b.textContent = more; });
}

function start(){
  SIGNED = true;
  $("gate").hidden = true; $("app").hidden = false;
  route();
  startLive();
}
function go(v, params){
  var q = params ? "?" + Object.keys(params).filter(function(k){ return params[k]; }).map(function(k){ return k + "=" + encodeURIComponent(params[k]); }).join("&") : "";
  var h = "#" + v + (q.length > 1 ? q : "");
  if(location.hash === h) route(); else location.hash = h;
}
function route(){
  var h = (location.hash || "#today").slice(1), i = h.indexOf("?"), v = i > -1 ? h.slice(0, i) : h;
  if(!RENDER[v]) v = "today";
  PARAMS = {};
  if(i > -1) h.slice(i + 1).split("&").forEach(function(kv){ var p = kv.split("="); if(p[0]) PARAMS[p[0]] = decodeURIComponent(p[1] || ""); });
  VIEW = v;
  $("title").textContent = titleOf(v);
  document.title = titleOf(v) + " · KAAL";
  Array.prototype.forEach.call(document.querySelectorAll("[data-go]"), function(b){ if(b.getAttribute("data-go") === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
  $("view").innerHTML = '<div class="card empty">Loading…</div>';
  window.scrollTo(0, 0);
  load();
}
addEventListener("hashchange", function(){ if(SIGNED) route(); });
function load(){
  var v = VIEW, f = LOAD[v];
  if(!f) return;
  f(function(html){ if(VIEW === v) $("view").innerHTML = html; if(AFTER[v]) AFTER[v](); });
}
function failed(j){ return '<div class="card empty"><p>' + esc((j && j.why) || "Could not load this just now.") + '</p><button class="btn sm" data-act="refresh">Try again</button></div>'; }
var LOAD = {}, RENDER = {}, AFTER = {};
function both(a, b, done){ var got = {}, n = 2; function one(k){ return function(j){ got[k] = j; if(--n === 0) done(got.a, got.b); }; } a.then(one("a")); b.then(one("b")); }

/* ══ TODAY: the live dashboard ══
   A period (Today, 7, 30, 90 days in India), its numbers against the same
   length before it, the chart, the path to a sale and where sales came
   from; then what needs you, who is here now, the hot leads, the twenty.
   The numbers refresh every thirty seconds while the screen is open;
   Right now every ten. */
var TP_NAME = { today:"Today", "7d":"7 days", "30d":"30 days", "90d":"90 days" };
function tperiod(){ var r = PARAMS.r; if(!TP_NAME[r]){ try{ r = localStorage.getItem("kaal_tp"); }catch(e){} } return TP_NAME[r] ? r : "today"; }
/* Shown the moment the first answer is in, and filled in as the rest
   arrive: the numbers never wait on Razorpay. What the screen showed last
   time is shown at once, then replaced. */
LOAD.today = function(put){
  var r = tperiod(), left = 4, shown = false;
  if(DATA.summary && DATA.summary.r === r){ shown = true; put(RENDER.today()); hot(); }
  function paint(){ if(VIEW !== "today") return; if(!shown){ shown = true; put(RENDER.today()); hot(); } else { var v = $("view"); if(v && !PENDING && $("sheet").hidden) v.innerHTML = RENDER.today(); } }
  function one(k){ return function(j){
    left--;
    if(k === "ov" && j.ok) DATA.overview = j;
    if(k === "dk" && j.ok) DATA.desk = j;
    if(k === "sm" && j.ok) DATA.summary = j;
    if(k === "ins" && j.ok) DATA.tins = j;
    if(!shown && left === 0 && !DATA.summary && !DATA.overview && !DATA.desk){ put(failed(j)); return; }
    if(DATA.summary || left === 0) paint();
  }; }
  api("GET", "/desk/summary?r=" + r).then(one("sm")); api("GET", "/control/api/overview").then(one("ov"));
  api("GET", "/desk/insights?r=" + r).then(one("ins")); api("GET", "/desk/data").then(one("dk"));
};
function hot(){ api("GET", "/desk/visitors?r=7d&f=hot&sort=score").then(function(h){ if(h.ok){ setBadge("visitors", h.total); DATA.hot = h; var e = $("hotCard"); if(e) e.innerHTML = hotCard(h); } }); }
/* The quiet refresh: only the numbers, the chart and the path, in place. */
function refreshToday(){
  if(VIEW !== "today" || !SIGNED || document.visibilityState !== "visible" || !$("sheet").hidden || PENDING) return;
  api("GET", "/desk/summary?r=" + tperiod()).then(function(j){
    if(!j.ok || VIEW !== "today") return;
    DATA.summary = j;
    var a = $("dash"); if(a) a.innerHTML = dashBody();
  });
}
setInterval(refreshToday, 30000);
function needs(){
  var ov = DATA.overview, dk = DATA.desk, out = [];
  if(ov){
    (ov.late || []).forEach(function(o){ out.push({ act:1, t: o.piece + ": " + o.why, b:'<button class="btn sm" data-go="orders">Open orders</button>' }); });
    (ov.courier || []).forEach(function(c){ out.push({ act:1, t:"Courier: " + c.status + " · " + c.awb, d: c.outcome === "unmatched" ? "Matched to no order. Check the tracking number on the order." : "" }); });
    if(ov.approvals) out.push({ act:1, t: plural(ov.approvals, "approval") + " waiting for you", d:"Warranty claims are promised an answer within 48 hours.", b:'<button class="btn sm" data-go="approvals">Open approvals</button>' });
    if(ov.emails && ov.emails.failed) out.push({ act:1, t: plural(ov.emails.failed, "email") + " failed to send", b:'<button class="btn sm" data-go="emails">Open emails</button>' });
    /* Gone on the shop, but no order for it in the registry: a sale from before it, never recorded. */
    if(dk && dk.sold && ov.pieces){
      var st = {}; ov.pieces.forEach(function(p){ st[p.number] = p.status; });
      var gap = dk.sold.filter(function(n){ return st[n] === "available" || st[n] === "held"; });
      if(gap.length) out.push({ act:1, t: (gap.length === 1 ? "No. " : "Nos. ") + gap.map(pad).join(", ") + " sold on the shop, with no order in the registry", d:"Sold before the registry existed. Record each one so its owner can register, see their warranty and transfer it.", b:'<button class="btn sm gold" data-act="pastSale">Record a past sale</button>' });
    }
  }
  if(dk){
    (dk.alerts || []).forEach(function(a){
      if(/^(late|due|address)$/.test(a.kind) && ov) return;     /* the registry's own order stages cover these */
      var b = "";
      if(a.kind === "refund") b = '<button class="btn sm" data-act="release" data-v="sell" data-n="' + a.n + '">Back on sale</button><button class="btn sm ghost" data-act="release" data-v="retire" data-n="' + a.n + '">Keep it retired</button>';
      if(a.kind === "unknown" && a.id) b = '<a class="btn sm" target="_blank" rel="noopener" href="https://dashboard.razorpay.com/app/payments/' + encodeURIComponent(a.id) + '">Open in Razorpay</a>';
      out.push({ act: a.level === "act", t: a.title, d: a.detail, b: b });
    });
  }
  return out;
}
function hotCard(h){
  var rows = (h.rows || []).slice(0, 4);
  if(!h.total) return '<div class="card"><h3>Hot leads</h3><p class="muted small" style="margin:0">Nobody close to buying in the last seven days. When someone opens checkout, gives their details or comes back for a number, they appear here.</p></div>';
  return '<div class="card"><div class="row between"><h3>' + plural(h.total, "hot lead") + ' this week</h3><button class="btn sm" data-go="visitors" data-p="f=hot">See all</button></div>' +
    '<div class="list" style="margin:8px -16px -16px">' + rows.map(function(v){ return vrow(v); }).join("") + "</div></div>";
}
function kdelta(cur, prev, r){
  if(r === "today") return '<span class="faint">Yesterday ' + prev + "</span>";
  if(!prev) return cur ? '<span class="up">new</span> <span class="faint">vs previous ' + TP_NAME[r] + "</span>" : '<span class="faint">none in either period</span>';
  var d = Math.round((cur - prev) / prev * 100);
  return '<span class="' + (d > 0 ? "up" : d < 0 ? "down" : "faint") + '">' + (d > 0 ? "\u25b2 " : d < 0 ? "\u25bc " : "") + Math.abs(d) + '%</span> <span class="faint">vs previous ' + TP_NAME[r] + "</span>";
}
function mini(days, key){
  if(!days || days.length < 2) return "";
  var top = 1; days.forEach(function(x){ top = Math.max(top, x[key] || 0); });
  return '<div class="mini" aria-hidden="true">' + days.map(function(x){ var v = x[key] || 0; return '<i class="' + (v ? "" : "z") + '" style="height:' + (v ? Math.max(10, Math.round(v / top * 100)) : 6) + '%"></i>'; }).join("") + "</div>";
}
function dashBody(){
  var sm = DATA.summary;
  if(!sm) return '<div class="card empty">The numbers could not be read just now. They try again in thirty seconds.</div>';
  var r = sm.r, t = sm.totals || {}, p = sm.prev || {}, days = r === "today" ? null : sm.days;
  function conv(o, v){ return v ? (o / v * 100).toFixed(o / v >= 0.1 ? 0 : 1) + "%" : "\u2013"; }
  function kpi(label, v, pv, sub, key, go){
    return '<div class="kpi' + (go ? " go" : "") + '"' + (go ? ' data-go="' + go + '"' : "") + '><div class="l">' + label + '</div><div class="v">' + v + "</div>" +
      '<div class="d">' + sub + '</div><div class="d">' + kdelta(pv ? pv[0] : t[key] || 0, pv ? pv[1] : p[key] || 0, r) + "</div>" + (key ? mini(days, key) : "") + "</div>";
  }
  var h = '<div class="kpis">' +
    kpi("Visits", (t.visits || 0).toLocaleString("en-IN"), null, (t.visitors || 0).toLocaleString("en-IN") + " " + (t.visitors === 1 ? "visitor" : "visitors") + (r === "today" ? " today" : " (unique each day)"), "visits", "insights") +
    kpi("Add to cart", (t.cart || 0).toLocaleString("en-IN"), null, pct(t.cart || 0, t.visits || 0) + " of visits chose a number", "cart", "visitors") +
    kpi("Checkouts", (t.checkout || 0).toLocaleString("en-IN"), null, pct(t.checkout || 0, t.cart || 0) + " of add to carts", "checkout", "orders") +
    kpi("Orders", (t.orders || 0).toLocaleString("en-IN"), null, (t.returned ? plural(t.returned, "returned or refunded", "returned or refunded") : pct(t.orders || 0, t.checkout || 0) + " of checkouts paid"), "orders", "orders") +
    kpi("Revenue", rupees(t.paise || 0), [t.paise || 0, p.paise || 0], "after refunds and returns", "paise", null) +
    kpi("Conversion", conv(t.orders || 0, t.visitors || 0), [Math.round((t.orders || 0) * 1000 / Math.max(1, t.visitors || 0)), Math.round((p.orders || 0) * 1000 / Math.max(1, p.visitors || 0))], "orders per visitor", null, "insights") + "</div>";
  h += '<p class="note">' + (r === "today" ? "Today so far, India time. " : esc(TP_NAME[r]) + " to today, against the " + esc(TP_NAME[r]) + " before. ") +
    "A visit is counted as it ends, so the last few minutes arrive with it; Right now, below, is live. Add to cart is a visit that chose a number." + (sm.orders === "razorpay" ? " Orders from Razorpay." : "") + "</p>";
  /* the chart */
  var cd = sm.days || [], top = 1, otop = 0;
  cd.forEach(function(x){ top = Math.max(top, x.visits || 0); otop = Math.max(otop, x.orders || 0); });
  h += '<div class="card" style="margin-top:12px"><div class="row between"><h3>' + (r === "today" ? "The last fourteen days" : "Visits and orders, day by day") + '</h3><span class="legend"><i class="lv"></i>Visits <i class="lo"></i>Orders</span></div>' +
    '<div class="chart" role="img" aria-label="Visits and orders each day">' + cd.map(function(x){
      var hv = x.visits ? Math.max(3, Math.round(x.visits / top * 100)) : 1;
      return '<div class="cday' + (x.day === sm.today ? " now" : "") + '" title="' + esc(dayShort(x.day)) + ": " + plural(x.visits || 0, "visit") + ", " + plural(x.cart || 0, "add to cart", "add to carts") + ", " + plural(x.orders || 0, "order") + (x.paise ? ", " + rupees(x.paise) : "") + '">' +
        (x.orders ? '<b class="o">' + x.orders + "</b>" : "") + '<i class="b" style="height:' + hv + '%"></i></div>'; }).join("") + "</div>" +
    '<div class="axis"><span>' + esc(cd.length ? dayShort(cd[0].day) : "") + "</span><span>" + esc(cd.length > 2 ? dayShort(cd[Math.floor(cd.length / 2)].day) : "") + "</span><span>" + (cd.length ? (cd[cd.length - 1].day === sm.today ? "Today" : esc(dayShort(cd[cd.length - 1].day))) : "") + "</span></div></div>";
  /* the path to a sale */
  var steps = [["Visits", t.visits || 0], ["Reached the twenty", t.twenty || 0], ["Added to cart", t.cart || 0], ["Opened checkout", t.checkout || 0], ["Gave their details", t.details || 0], ["Ordered", t.orders || 0]];
  var v0 = Math.max(steps[0][1], 1);
  var path = '<div class="card funnel"><h3 style="margin-bottom:6px">The path to a sale</h3>' + steps.map(function(x, i){
    var drop = i ? steps[i - 1][1] - x[1] : 0;
    return '<div class="st"><span>' + x[0] + '</span><span class="track"><i style="width:' + Math.min(100, Math.max(x[1] ? 1 : 0, Math.round(x[1] / v0 * 100))) + '%"></i></span><span class="val">' + x[1].toLocaleString("en-IN") + (i && steps[0][1] ? "<small>" + pct(x[1], steps[0][1]) + "</small>" : "") + (i && drop > 0 ? '<small class="down" title="Lost at this step">\u2212' + drop + "</small>" : "") + "</span></div>"; }).join("") + "</div>";
  var ins = DATA.tins, src = ins && ins.sources ? ins.sources.slice(0, 6) : [];
  var from = '<div class="card"><div class="row between"><h3>Where they came from</h3><button class="btn sm ghost" data-go="insights" data-p="r=' + esc(r) + '">Insights</button></div>' +
    (src.length ? '<div class="scroll" style="margin:6px -16px -16px"><table><tr><th>Source</th><th class="n">Visitors</th><th class="n">Cart</th><th class="n">Checkout</th><th class="n">Sold</th></tr>' + src.map(function(x){
      return '<tr class="go" data-go="visitors" data-p="f=all&r=' + esc(r) + "&src=" + esc(x.s) + '"><td>' + esc(cleanSrc(x.k)) + '</td><td class="n">' + x.v + '</td><td class="n">' + x.num + '</td><td class="n">' + x.co + '</td><td class="n">' + (x.paid ? '<b class="up">' + x.paid + "</b>" : 0) + "</td></tr>"; }).join("") + "</table></div>"
      : '<p class="muted small" style="margin:6px 0 0">' + (ins ? "Nobody yet in this period." : "The sources could not be read just now.") + "</p>") + "</div>";
  return h + '<div class="grid g2 solo" style="margin-top:12px">' + path + from + "</div>";
}
RENDER.today = function(){
  var ov = DATA.overview || {}, dk = DATA.desk || {}, r = tperiod();
  var sold = dk.sold ? dk.sold.length : (ov.sold || 0), size = dk.edition || ov.size || 20;
  var gone = {}; (dk.sold || []).forEach(function(n){ gone[n] = 1; });
  var cells = (ov.pieces || []).map(function(p){ var st = p.state || p.status; if((st === "available" || !st) && gone[p.number]) st = "sold"; return '<div class="cell ' + esc(st) + '" title="No. ' + pad(p.number) + " · " + esc(p.colorway) + " · " + esc(p.status) + '">' + pad(p.number) + "</div>"; }).join("");
  var n = needs();
  setBadge("orders", (ov.stages ? (ov.stages.placed || 0) + (ov.stages.inspected || 0) + (ov.stages.packed || 0) : 0));
  setBadge("approvals", ov.approvals || 0, true);
  var seg = Object.keys(TP_NAME).map(function(k){ return '<button data-act="tset" data-v="' + k + '" aria-pressed="' + (r === k) + '">' + TP_NAME[k] + "</button>"; }).join("");
  var h = '<div class="row between"><div class="seg" role="group" aria-label="Period">' + seg + '</div><span class="live small"><span class="dot on"></span><span id="dashAt">Live \u00b7 updates every 30 seconds</span></span></div>' +
    '<div id="dash" style="margin-top:12px">' + dashBody() + "</div>";
  if(n.length) h += "<h2>Needs you" + '<span class="count">' + n.length + "</span></h2>" + n.map(function(x){ return '<div class="alert' + (x.act ? " act" : "") + '"><b>' + esc(x.t) + "</b>" + (x.d ? "<p>" + esc(x.d) + "</p>" : "") + (x.b ? '<div class="row">' + x.b + "</div>" : "") + "</div>"; }).join("");
  else h += '<h2>Needs you</h2><div class="calm">&#10003; Nothing needs you right now.</div>';
  h += '<div class="grid g2 solo" style="margin-top:12px"><div id="nowCard">' + nowCard() + '</div><div id="hotCard">' + (DATA.hot ? hotCard(DATA.hot) : '<div class="card empty">Loading leads\u2026</div>') + '</div></div>';
  h += '<div class="grid g2 solo" style="margin-top:12px">' + (cells ? '<div class="card go" data-go="pieces"><div class="row between"><h3>The twenty</h3><span class="muted small">' + sold + " gone \u00b7 " + (size - sold) + ' open</span></div><div class="strip half">' + cells + "</div></div>" : "<div></div>") +
    (ov.stages ? '<div class="card"><div class="row between"><h3>Orders at each stage</h3><button class="btn sm ghost" data-go="orders">Orders</button></div><div class="grid g4" style="margin-top:10px">' + ["placed","inspected","packed","dispatched"].map(function(s){
      return '<div class="stagek go" data-go="orders"><b class="num">' + (ov.stages[s] || 0) + "</b><span>" + s + "</span></div>"; }).join("") + "</div></div>" : "") + "</div>";
  if(ov.returnWindows && ov.returnWindows.length) h += '<h2>Delivered, return window open</h2><div class="card tight"><table>' + ov.returnWindows.map(function(w){ return "<tr><td>" + esc(w.piece) + '</td><td class="n">' + esc(w.delivered) + '</td><td class="n">' + plural(w.daysLeft, "day") + " left</td></tr>"; }).join("") + "</table></div>";
  return h;
};

/* ══ RIGHT NOW: the live view, every ten seconds ══ */
var LV = null, liveT = 0, LAST_PAID = 0;
var WHERE = { film:"Watching the film", story:"Reading the story", twenty:"At the twenty", below:"Below the twenty", details:"Giving their details", pay:"Paying now" };
function nowCard(){
  if(!LV) return '<div class="card"><h3>Right now</h3><p class="muted small" style="margin:0">Connecting…</p></div>';
  if(!LV.live) return '<div class="card"><h3>Right now</h3><p class="muted small" style="margin:0">' + (LV.counting ? "The live view could not be read just now." : "The live view starts once the visitor counter is connected.") + "</p></div>";
  var L = LV.live, here = L.here || [], by = {}, mins = L.minutes || [], top = 1, i;
  for(i = 0; i < here.length; i++){ var w = here[i].w || "film"; by[w] = (by[w] || 0) + 1; }
  for(i = 0; i < mins.length; i++) top = Math.max(top, mins[i]);
  var sales = (L.paid || []).length;
  var h = '<div class="card"><div class="row between"><h3>Right now</h3><span class="live"><span class="dot on"></span>Live</span></div>' +
    '<div style="margin-top:6px"><span class="num" style="font-size:30px">' + here.length + '</span> <span class="muted">' + (here.length === 1 ? "person on the site" : "people on the site") + (sales ? ' · <span class="up">' + plural(sales, "sale") + " this hour</span>" : "") + "</span></div>" +
    '<div class="wherechips">' + ["pay","details","twenty","story","film","below"].filter(function(k){ return by[k]; }).map(function(k){ return "<span><b>" + by[k] + "</b> " + WHERE[k].toLowerCase() + "</span>"; }).join("") + "</div>" +
    '<div class="spark" role="img" aria-label="People on the site each minute, the last half hour">' + mins.map(function(x){ return '<i class="' + (x ? "" : "z") + '" style="height:' + (x ? Math.max(8, Math.round(x / top * 100)) : 4) + '%"></i>'; }).join("") + '</div><div class="axis"><span>30 min ago</span><span>now</span></div>';
  if(here.length) h += '<div class="list" style="margin:12px -16px -16px;border-top:1px solid var(--line)">' + here.slice(0, 6).map(function(v){
    return '<button class="lrow" data-act="visitor" data-k="' + (v.vk || "") + '"' + (v.vk ? "" : " disabled") + '><div class="t"><b>' + (v.vk ? "Visitor " + v.vk : "A visitor") + '</b><span class="faint small">' + took((L.now || Date.now()) - v.since) + '</span></div><div class="m">' +
      esc(srcName(v)) + (devName(v) ? " · " + esc(devName(v)) : "") + " · " + esc(WHERE[v.w] || "On the site") + (v.n ? " · No. " + pad(v.n) : "") + "</div></button>"; }).join("") + "</div>";
  return h + "</div>";
}
function live(){
  if(!SIGNED || document.visibilityState !== "visible") return;
  api("GET", "/desk/live").then(function(j){
    if(!j.ok && !j.live) { $("liveDot").className = "dot"; $("liveN").textContent = "·"; return; }
    LV = j;
    var n = j.live && j.live.here ? j.live.here.length : 0;
    $("liveDot").className = "dot" + (j.live ? " on" : ""); $("liveN").textContent = j.live ? n + " live" : "·";
    var e = $("nowCard"); if(e && VIEW === "today") e.innerHTML = nowCard();
    var p = j.live && j.live.paid && j.live.paid[0];
    if(p && p.ts > LAST_PAID){ if(LAST_PAID){ say("A sale just came in" + (p.no ? ": No. " + p.no : "")); if(VIEW === "today" || VIEW === "orders") load(); } LAST_PAID = p.ts; }
  });
}
function startLive(){ stopLive(); live(); liveT = setInterval(live, 10000); }
function stopLive(){ if(liveT) clearInterval(liveT); liveT = 0; }
document.addEventListener("visibilitychange", function(){ if(SIGNED && document.visibilityState === "visible"){ live(); } });

/* ══ ACTIVITY: everything, as it happens ══
   Every visitor's steps, every sale, every owner's request and everything
   you or the system changed, on one line of time, newest first. While it
   is open it asks again every eight seconds and new lines glow once. */
var AF = [["all","Everything"],["money","Money"],["intent","Intent"],["visits","Arrivals"],["owners","Owners"],["you","You"],["system","System"]];
var AR = { "1h":"Last hour", today:"Today", "24h":"24 hours", "7d":"7 days" };
var ACT_TOP = 0;
function asince(r){ var now = Date.now(); if(r === "1h") return now - 3600000; if(r === "7d") return now - 7 * 86400000; if(r === "24h") return now - 86400000;
  var d = new Date(now + 19800000); d.setUTCHours(0, 0, 0, 0); return d.getTime() - 19800000; }
function aparams(){ return { r: AR[PARAMS.r] ? PARAMS.r : "today", f: PARAMS.f || "all" }; }
LOAD.activity = function(put){
  var p = aparams();
  api("GET", "/control/api/activity?since=" + asince(p.r) + "&f=" + p.f).then(function(j){
    if(!j.ok){ put(failed(j)); return; }
    DATA.activity = j; ACT_TOP = j.rows.length ? j.rows[0].t : Date.now(); put(RENDER.activity(j, 0));
  });
};
function akind(x){
  if(x.src === "you") return "you"; if(x.src === "owners") return "own"; if(x.src === "system") return "sys";
  if(x.e === "paid") return "paid";
  if(/^(checkout|details|pay_failed|pay_closed|details_closed)$/.test(x.e)) return "money";
  if(/^(number|dial|early_dial|caseback_view|gift|deeplink|ctx_cta|list)$/.test(x.e)) return "intent";
  if(x.e === "visit") return "arrive";
  return "browse";
}
function clock(t){ return new Date(t).toLocaleTimeString("en-IN", { timeZone:"Asia/Kolkata", hour:"numeric", minute:"2-digit" }); }
function dayName(t){ return new Date(t).toLocaleDateString("en-IN", { timeZone:"Asia/Kolkata", weekday:"long", day:"numeric", month:"short" }); }
function arow(x, fresh){
  var k = akind(x), who = "";
  if(x.src === "visitor") who = "<b>" + (x.name ? esc(x.name) : "Visitor " + x.k) + "</b>" + (x.name ? " \u00b7 V" + x.k : "") + " \u00b7 " + esc(cleanSrc(x.from || "")) + (x.place ? " \u00b7 " + esc(x.place) : "") + (x.dev ? " \u00b7 " + esc(x.dev) : "") + (x.hot ? " \u00b7 hot " + x.score : "");
  else who = x.src === "you" ? "You" : x.src === "owners" ? "An owner" : "The system";
  var tag = x.src === "visitor" && x.k ? 'button class="arow k-' + k + (x.hot ? " hot" : "") + (fresh ? " fresh" : "") + '" data-act="visitor" data-k="' + x.k + '"' : 'div class="arow k-' + k + (fresh ? " fresh" : "") + '"';
  return "<" + tag + '><span class="at">' + clock(x.t) + '</span><span><div class="tx">' + esc(x.txt) + '</div><div class="m">' + who + "</div></span></" + tag.split(" ")[0] + ">";
}
function alist(rows, top){
  if(!rows.length) return '<div class="card empty">Nothing yet in this window. It fills as people arrive.</div>';
  var h = "", day = "";
  rows.forEach(function(x){ var d = dayName(x.t); if(d !== day){ day = d; h += '<p class="aday">' + esc(d) + "</p>"; } h += arow(x, top && x.t > top); });
  return '<div class="alist">' + h + "</div>";
}
RENDER.activity = function(j, top){
  var p = aparams(), rows = j.rows || [], c = { arrive:0, intent:0, money:0, paid:0 }, people = {};
  rows.forEach(function(x){ var k = akind(x); if(c[k] != null) c[k]++; if(x.k) people[x.k] = 1; });
  var seg = Object.keys(AR).map(function(k){ return '<button data-go="activity" data-p="r=' + k + "&f=" + p.f + '" aria-pressed="' + (p.r === k) + '">' + AR[k] + "</button>"; }).join("");
  var chips = AF.map(function(a){ return '<button class="chip" data-go="activity" data-p="r=' + p.r + "&f=" + a[0] + '" aria-pressed="' + (p.f === a[0]) + '">' + a[1] + "</button>"; }).join("");
  return '<div class="row between"><div class="seg" role="group" aria-label="Window">' + seg + '</div><span class="live small"><span class="dot on"></span>Live \u00b7 every 8 seconds</span></div>' +
    '<div class="chips" style="margin-top:10px">' + chips + "</div>" +
    '<div class="astat"><span><b>' + Object.keys(people).length + "</b> " + (Object.keys(people).length === 1 ? "person" : "people") + "</span><span><b>" + c.arrive + "</b> arrivals</span><span><b>" + c.intent + "</b> chose or turned over a watch</span><span><b>" + c.money + "</b> at checkout</span><span><b>" + c.paid + '</b> paid</span></div>' +
    '<div id="alist">' + alist(rows, top) + "</div>" + (rows.length >= 300 ? '<p class="note">The latest 300 lines. Narrow it with the filters above.</p>' : "");
};
setInterval(function(){
  if(VIEW !== "activity" || !SIGNED || document.visibilityState !== "visible" || !$("sheet").hidden) return;
  var p = aparams();
  api("GET", "/control/api/activity?since=" + asince(p.r) + "&f=" + p.f).then(function(j){
    if(!j.ok || VIEW !== "activity") return;
    var top = ACT_TOP; DATA.activity = j; ACT_TOP = j.rows.length ? j.rows[0].t : ACT_TOP;
    if(ACT_TOP > top){ var v = $("view"); if(v) v.innerHTML = RENDER.activity(j, top); }
  });
}, 8000);

/* ══ FOLLOW-UPS: the one note to someone who nearly bought ══
   Who writes it (Claude for that one person, checked line by line, or the
   standard note), what is waiting for you in review mode, and every note
   that went, word for word. */
var FU_MODES = [["auto","Claude writes and sends"],["review","Claude drafts, I approve"],["standard","The standard note only"]];
LOAD.followups = function(put){ api("GET", "/control/api/followups").then(function(j){ if(!j.ok){ put(failed(j)); return; } DATA.fu = j; setBadge("followups", j.queue.length); put(RENDER.followups(j)); }); };
RENDER.followups = function(j){
  var seg = FU_MODES.map(function(m){ return '<button data-act="fuMode" data-v="' + m[0] + '" aria-pressed="' + (j.mode === m[0]) + '">' + m[1] + "</button>"; }).join("");
  var h = '<div class="card"><h3>Who writes the one note</h3><p class="muted small" style="margin:0 0 12px">When someone reaches checkout and stops, one note goes to them, once, ever, three hours or more later, between 10 am and 8 pm. ' +
    "Claude writes it for that one person: from whether their number is still open, the same dial's other numbers, how many are left, and how they came to it. The offer is only the truth: the piece is unclaimed and there is one of it, seven days to send it back, two years' warranty, free delivery, help if paying went wrong. No discount, no deadline. " +
    "Every draft is checked before it can go (no invented numbers, none of the words the house never uses, no links, no dashes); one that fails sends the standard note instead.</p>" +
    '<div class="seg" role="group" aria-label="Who writes the note">' + seg + "</div>" +
    '<p class="note" style="margin-bottom:0">' + (j.connected ? "Claude is connected (" + esc(j.model) + ")." : "Claude is not connected yet, so the standard note goes. To connect it: GitHub, Settings, Secrets and variables, Actions, New repository secret, name ANTHROPIC_API_KEY, paste the key from console.anthropic.com, then Actions, setup-worker, Run workflow (mode live).") +
    (j.on ? "" : " The nearly-bought email is switched off in wrangler.toml (ABANDON_EMAIL), so nothing goes at all.") + "</p>" +
    '<div class="row" style="margin-top:12px"><button class="btn sm" data-act="fuSample"' + (j.connected ? "" : " disabled") + ">Write a sample now</button><span class=\"muted small\">For the most recent unfinished checkout. Nothing is sent.</span></div></div>";
  if(j.queue.length) h += "<h2>Waiting for you<span class=\"count\">" + j.queue.length + "</span></h2>" + j.queue.map(function(q){
    return '<div class="card"><div class="ohead"><b>' + esc(q.name || q.email) + '</b><span class="muted small">' + esc(q.email) + '</span><span class="sp"></span>' + (q.n ? '<span class="pill gold">No. ' + pad(q.n) + "</span>" : "") + "</div>" +
      '<p class="small faint" style="margin:6px 0 0">' + esc(q.stage || "") + " \u00b7 " + esc(q.draft.angle.replace("_", " ")) + ": " + esc(q.draft.why) + "</p>" +
      '<label for="fs_' + q.id + '">Subject</label><input id="fs_' + q.id + '" value="' + esc(q.draft.subject) + '">' +
      '<label for="fb_' + q.id + '">The note (the greeting, link, signature and P.S. are added)</label><textarea id="fb_' + q.id + '" style="min-height:220px">' + esc(q.draft.paragraphs.join("\n\n")) + "</textarea>" +
      '<div class="oact"><button class="btn go" data-act="fuSend" data-id="' + q.id + '">Send it</button><button class="btn ghost" data-act="fuSkip" data-id="' + q.id + '">Skip (no note, ever)</button></div></div>';
  }).join("");
  h += "<h2>Every note that went</h2>" + (j.log.length ? '<div class="card tight list">' + j.log.map(function(x, i){
    return '<button class="lrow" data-act="fuOpen" data-i="' + i + '"><div class="t"><b>' + esc(x.name || x.email || "") + (x.n ? ' <span class="muted">No. ' + pad(x.n) + "</span>" : "") + '</b><span class="pill' + (x.status === "sent" ? " ok" : x.status === "waiting" ? " gold" : x.status === "failed" ? " bad" : "") + '">' + esc(x.status) + "</span></div>" +
      '<div class="m">' + esc(when(x.at)) + " \u00b7 " + (/^claude/.test(x.how) ? "written by Claude" + (x.angle ? ", " + esc(x.angle.replace("_", " ")) : "") : "standard note") + " \u00b7 " + esc(x.subject || "") + "</div></button>"; }).join("") + "</div>"
    : '<div class="card empty">None yet. They appear here, word for word, as they go.</div>');
  return h;
};

/* ══ ORDERS ══ */
var NAMES = { inspected:"Inspected", packed:"Packed", dispatched:"Dispatched", delivered:"Delivered" };
var COURIERS = ["Shiprocket","Delhivery","Blue Dart","DTDC","India Post","Ekart","Xpressbees","Shadowfax"];
LOAD.orders = function(put){
  both(api("GET", "/control/api/orders"), api("GET", "/desk/data"), function(or, dk){
    if(!or.ok){ put(failed(or)); return; }
    DATA.orders = or; DATA.desk = dk.ok ? dk : DATA.desk;
    put(RENDER.orders());
  });
};
function ofilter(o, f){
  if(f === "todo") return ["placed","inspected","packed","dispatched"].indexOf(o.status) > -1;
  if(f === "delivered") return o.status === "delivered";
  if(f === "done") return ["registered","returned","cancelled"].indexOf(o.status) > -1;
  return true;
}
RENDER.orders = function(){
  var f = PARAMS.f || "todo", all = DATA.orders.orders || [], dk = DATA.desk || {};
  var counts = { todo:0, delivered:0, done:0, all: all.length };
  all.forEach(function(o){ ["todo","delivered","done"].forEach(function(k){ if(ofilter(o, k)) counts[k]++; }); });
  var nearly = dk.unfinished || [];
  function chip(k, t){ return '<button class="chip" data-go="orders" data-p="f=' + k + '" aria-pressed="' + (f === k) + '">' + t + (counts[k] != null ? " · " + counts[k] : "") + "</button>"; }
  var h = '<div class="row between"><div class="chips">' + chip("todo", "To ship") + chip("delivered", "Delivered, not registered") + chip("done", "Finished") + chip("all", "All") +
    '<button class="chip" data-go="orders" data-p="f=nearly" aria-pressed="' + (f === "nearly") + '">Nearly bought · ' + nearly.length + "</button></div>" +
    '<div class="row"><button class="btn sm" data-act="import">Bring in from Razorpay</button><button class="btn sm" data-act="pastSale">Record a past sale</button></div></div>';
  if(f === "nearly") return h + '<div style="margin-top:12px">' + nearlyList(nearly, dk) + "</div>";
  var list = all.filter(function(o){ return ofilter(o, f); });
  if(!list.length) return h + '<div class="card empty" style="margin-top:12px">' + (f === "todo" ? "Nothing waiting to ship." : "None here.") + "</div>";
  return h + '<div style="margin-top:12px">' + list.map(orderCard).join("") + "</div>";
};
function orderCard(o){
  var idx = ["placed","inspected","packed","dispatched","delivered"].indexOf(o.status), dk = DATA.desk || {};
  var bars = [0,1,2,3,4].map(function(i){ return "<i" + (i <= idx || o.status === "registered" ? ' class="on"' : "") + "></i>"; }).join("");
  var next = o.next ? '<button class="btn go" data-act="next" data-id="' + o.id + '" data-to="' + o.next + '">Mark ' + NAMES[o.next] + "</button>" : "";
  var prev = o.next ? '<button class="btn ghost sm" data-act="preview" data-id="' + o.id + '" data-to="' + o.next + '">Preview email</button>' : "";
  var ret = o.returnOpen ? '<button class="btn warn sm" data-act="returned" data-id="' + o.id + '">Mark returned</button>' : "";
  var refund = !o.refund_id && o.status !== "registered" && !/^manual:/.test(o.razorpay_payment_id || "") ? '<button class="btn warn sm" data-act="refund" data-id="' + o.id + '" data-n="' + pad(o.number) + '">Refund</button>' : "";
  var link = o.status === "delivered" && o.email ? '<button class="btn sm" data-act="link" data-id="' + o.id + '" data-mode="send">Send registration link</button><button class="btn ghost sm" data-act="link" data-id="' + o.id + '" data-mode="regenerate">New link, cancel old</button>' : "";
  var j = o.razorpay_order_id && dk.journeys && dk.journeys[o.razorpay_order_id];
  var addr = [o.address_line1, o.address_line2, o.city, o.state, o.pincode].filter(Boolean).join(", ");
  return '<div class="card"><div class="ohead"><b>No. ' + pad(o.number) + '</b><span class="muted">' + esc(o.colorway) + '</span><span class="sp"></span><span class="pill' + (o.status === "cancelled" || o.status === "returned" ? " bad" : o.status === "registered" ? " ok" : " gold") + '">' + esc(o.status) + (o.cancel_reason ? " · " + esc(o.cancel_reason) : "") + "</span></div>" +
    '<div class="stages">' + bars + "</div>" +
    '<div><b style="font-weight:500">' + esc(o.buyer_name || "") + '</b> <span class="muted small">' + esc(o.email || "") + " " + esc(o.phone || "") + "</span></div>" +
    (addr ? '<div class="small muted">' + esc(addr) + "</div>" : "") +
    (o.gift ? '<div class="small" style="margin-top:4px"><span class="pill gold">gift</span> ' + esc(o.gift_note || "") + "</div>" : "") +
    '<div class="small faint" style="margin-top:4px">Paid ' + esc(when(o.paid_at)) + " · " + rupees(o.amount_paise) + (o.tracking_number ? " · " + esc(o.courier) + " " + esc(o.tracking_number) : "") + (o.delivered_on ? " · delivered " + esc(o.delivered_on) : "") + (o.refund_id ? " · refunded " + esc(o.refund_id) : "") + "</div>" +
    '<div class="oact">' + next + contactBtns(o.email, o.phone) + "</div>" +
    '<div class="oact">' + prev + '<button class="btn ghost sm" data-act="correct" data-id="' + o.id + '">Change without email</button>' + link + ret + refund +
    (j ? '<button class="btn ghost sm" data-act="visitor" data-k="' + j.k + '">Their journey · ' + esc(srcName(j)) + "</button>" : "") + "</div></div>";
}
function nearlyList(u, dk){
  if(!dk.razorpay) return '<div class="card empty">Needs the Razorpay keys on the worker.</div>';
  if(!u.length) return '<div class="card empty">Every checkout opened today and yesterday was paid, or none were opened.</div>';
  return '<p class="muted small" style="margin:0 0 10px">Checkouts opened today or yesterday that did not end in a payment. One follow-up email goes on its own when there is an email; WhatsApp is yours to send.</p>' +
    u.map(function(x){
      var w = waNum(x.contact);
      return '<div class="card"><div class="ohead"><b>No. ' + pad(x.n) + "</b>" + (x.dial ? '<span class="muted">' + esc(x.dial) + "</span>" : "") + '<span class="sp"></span><span class="faint small">' + esc(x.at) + "</span></div>" +
        (x.name ? '<div style="margin-top:6px"><b style="font-weight:500">' + esc(x.name) + "</b>" + (x.city ? ' <span class="muted small">' + esc(x.city) + "</span>" : "") + "</div>" : "") +
        '<div class="small muted">' + esc(x.stage) + (x.followed ? " · follow-up sent " + esc(x.followed) : "") + "</div>" +
        '<div class="oact">' + (x.wa && w ? '<a class="btn sm gold" href="https://wa.me/' + w + "?text=" + encodeURIComponent(x.wa) + '" target="_blank" rel="noopener">WhatsApp, note written</a>' + (x.contact ? '<a class="btn sm" href="tel:' + esc(x.contact) + '">Call</a>' : "") : contactBtns(x.email, x.contact)) +
        (x.email ? '<button class="btn ghost sm" data-act="stop" data-email="' + esc(x.email) + '" data-v="' + (x.stopped ? "undo" : "stop") + '">' + (x.stopped ? "Emails stopped · undo" : "Stop emails") + "</button>" : "") +
        (x.orderId && dk.journeys && dk.journeys[x.orderId] ? '<button class="btn ghost sm" data-act="visitor" data-k="' + dk.journeys[x.orderId].k + '">Their journey</button>' : "") + "</div></div>";
    }).join("");
}

/* The one-tap stage, with the ten second Undo. */
var PENDING = null;
function order(id){ return ((DATA.orders || {}).orders || []).filter(function(o){ return o.id === id; })[0]; }
function nextStage(id, to){
  var o = order(id);
  if(to === "dispatched"){
    sheet("No. " + pad(o.number) + " dispatched", '<label for="cr">Courier</label><select id="cr">' + COURIERS.map(function(c){ return "<option>" + c + "</option>"; }).join("") + "</select>" +
      '<label for="tn">Tracking number</label><input id="tn" autocomplete="off"><label for="tu">Tracking link</label><input id="tu" type="url" placeholder="https://" autocomplete="off">' +
      '<p class="err" id="sheetErr"></p><div class="row" style="margin-top:12px"><button class="btn go" data-act="dispatchGo" data-id="' + id + '">Mark dispatched</button><button class="btn ghost" data-act="previewD" data-id="' + id + '">Preview email</button></div>');
    return;
  }
  if(to === "delivered"){
    sheet("No. " + pad(o.number) + " delivered", '<label for="dd">Delivered on</label><input id="dd" type="date" value="' + esc(DATA.orders.today) + '" max="' + esc(DATA.orders.today) + '">' +
      '<p class="note">This starts the warranty and the seven day return window. The owner is emailed the registration link at once.</p>' +
      '<p class="err" id="sheetErr"></p><button class="btn go" style="margin-top:12px" data-act="deliverGo" data-id="' + id + '">Mark delivered</button>');
    return;
  }
  hold(id, { to: to }, "No. " + pad(o.number) + " marked " + NAMES[to] + ". The email goes in");
}
function hold(id, payload, label){
  if(PENDING) commit();
  var t = $("toast"), left = 10;
  t.className = "toast"; t.hidden = false;
  t.innerHTML = '<div class="sp"><span>' + esc(label) + ' <span class="num" id="tc">10</span>s.</span><div class="tbar" id="tb"></div></div><button class="btn" data-act="undo">Undo</button>';
  requestAnimationFrame(function(){ var b = $("tb"); if(b) b.style.transform = "scaleX(0)"; });
  PENDING = { id:id, payload:payload, timer: setInterval(function(){ left--; var c = $("tc"); if(c) c.textContent = left; if(left <= 0) commit(); }, 1000) };
}
function undo(){ if(!PENDING) return; clearInterval(PENDING.timer); PENDING = null; $("toast").hidden = true; say("Undone. Nothing was changed or sent."); }
function commit(keepalive){
  if(!PENDING) return; var p = PENDING; PENDING = null; clearInterval(p.timer); $("toast").hidden = true;
  fetch("/control/api/orders/" + p.id + "/stage", { method:"POST", credentials:"same-origin", keepalive: !!keepalive, headers:{ "X-KAAL":"1", "Content-Type":"application/json" }, body: JSON.stringify(p.payload) })
    .then(function(r){ return r.json(); }).then(function(j){
      if(!j.ok){ say(j.why || "That did not save. Nothing was sent.", true); load(); return; }
      say(j.letter === "queued" ? "Saved. The email is on its way." : "Saved."); load();
    }).catch(function(){ say("That did not reach the server. Nothing was sent; try again.", true); });
}
addEventListener("pagehide", function(){ if(PENDING) commit(true); });

/* ══ VISITORS AND LEADS ══ */
var VROWS = [], VTOTAL = 0;
var FILTERS = [["hot","Hot leads"],["warm","Warm"],["all","Everyone"],["bought","Bought"],["checkout","Opened checkout"],["details","Gave details"],["back","Came back"]];
var NARROW = { src:"Source", cmp:"Campaign", ad:"Ad", region:"State", city:"City", os:"Phone", br:"Browser", dev:"Device" };
function vparams(off){
  var p = { r: PARAMS.r || "7d", f: PARAMS.f || "hot", q: PARAMS.q || "", sort: PARAMS.sort || ((PARAMS.f || "hot") === "hot" || PARAMS.f === "warm" ? "score" : ""), off: off || 0 };
  Object.keys(NARROW).forEach(function(k){ if(PARAMS[k]) p[k] = PARAMS[k]; });
  return Object.keys(p).filter(function(k){ return p[k] !== "" && p[k] != null; }).map(function(k){ return k + "=" + encodeURIComponent(p[k]); }).join("&");
}
LOAD.visitors = function(put){
  api("GET", "/desk/visitors?" + vparams(0)).then(function(j){
    if(!j.ok && !j.on){ put(failed(j)); return; }
    VROWS = j.rows || []; VTOTAL = j.total || 0;
    if(PARAMS.k) setTimeout(function(){ openVisitor(+PARAMS.k); }, 0);
    put(RENDER.visitors(j));
  });
};
function vrow(v){
  var bits = [esc(srcName(v))];
  if(v.cmp) bits.push("ad: " + esc(v.cmp) + (v.ad ? " / " + esc(v.ad) : ""));
  if(place(v)) bits.push(esc(place(v)));
  if(devName(v)) bits.push(esc(devName(v)) + (v.br && v.br.indexOf("app") < 0 ? ", " + esc(v.br) : ""));
  bits.push(plural(v.visits, "visit") + (v.time >= 5000 ? ", " + took(v.time) : ""));
  var p = [];
  (v.numbers || []).forEach(function(n){ p.push('<span class="pill gold">No. ' + esc(n) + "</span>"); });
  (v.dials || []).forEach(function(d){ p.push('<span class="pill">' + esc(d) + "</span>"); });
  if(v.checkout) p.push('<span class="pill gold">Opened checkout</span>');
  if(v.details) p.push('<span class="pill gold">Gave details</span>');
  (v.paid || []).forEach(function(n){ p.push('<span class="pill ok">Paid · No. ' + esc(n) + "</span>"); });
  return '<button class="lrow" data-act="visitor" data-k="' + v.k + '"><div class="vr">' + scoreTag(v) + '<div class="body"><div class="t"><b>Visitor ' + v.k + (v.name ? " · " + esc(v.name) : "") + '</b><span class="faint small">' + seenAt(v.last) + '</span></div><div class="m">' + bits.join(" · ") + "</div>" +
    (p.length ? '<div class="pills">' + p.join("") + "</div>" : "") + "</div></div></button>";
}
RENDER.visitors = function(j){
  var r = PARAMS.r || "7d", f = PARAMS.f || "hot";
  function seg(k, t){ return '<button data-act="vset" data-k="r" data-v="' + k + '" aria-pressed="' + (r === k) + '">' + t + "</button>"; }
  var narrowed = Object.keys(NARROW).filter(function(k){ return PARAMS[k]; }).map(function(k){ return '<button class="chip x" data-act="vset" data-k="' + k + '" data-v="">' + NARROW[k] + ": " + esc(PARAMS[k]) + " &times;</button>"; }).join("");
  var h = '<div class="row between"><div class="seg" role="group" aria-label="Period">' + seg("today", "Today") + seg("7d", "7 days") + seg("30d", "30 days") + seg("90d", "90 days") + "</div>" +
    '<input id="vq" type="search" placeholder="Name, phone, email, city, campaign or visitor number" value="' + esc(PARAMS.q || "") + '" aria-label="Search visitors" style="flex:1;min-width:220px;max-width:420px"></div>' +
    '<div class="chips" style="margin-top:10px">' + FILTERS.map(function(x){ return '<button class="chip" data-act="vset" data-k="f" data-v="' + x[0] + '" aria-pressed="' + (f === x[0]) + '">' + x[1] + "</button>"; }).join("") + narrowed + "</div>";
  if(!j.on) return h + '<div class="card empty" style="margin-top:12px">Visitor histories start once the visitor counter is connected (Health).</div>';
  h += '<p class="muted small" style="margin:12px 0 8px">' + plural(VTOTAL, "visitor") + (f === "hot" ? " close to buying who have not yet. Score out of 100 from what they did: 50 and over is hot." : "") + "</p>";
  if(!VROWS.length) return h + '<div class="card empty">' + (PARAMS.q ? "No visitor matches that." : f === "hot" ? "Nobody hot in this period. Widen the period, or see Everyone." : "Nobody here in this period.") + "</div>";
  return h + '<div class="card tight list" id="vlist">' + VROWS.map(vrow).join("") + "</div>" +
    (VTOTAL > VROWS.length ? '<div class="row" style="margin-top:10px"><button class="btn sm" data-act="vmore">Show more (' + (VTOTAL - VROWS.length) + " left)</button></div>" : "") +
    '<div class="row" style="margin-top:16px"><a class="btn sm ghost" href="/desk/visitors.csv?r=' + esc(r) + '">Spreadsheet: one row per visitor</a><a class="btn sm ghost" href="/desk/steps.csv?r=' + esc(r) + '">Spreadsheet: every step</a></div>';
};
AFTER.visitors = function(){
  var q = $("vq"), t = 0; if(!q) return;
  q.addEventListener("input", function(){ clearTimeout(t); t = setTimeout(function(){ var p = copyParams(); p.q = q.value.trim(); go("visitors", p); }, 450); });
};
function copyParams(){ var p = {}; Object.keys(PARAMS).forEach(function(k){ if(k !== "k") p[k] = PARAMS[k]; }); return p; }
function openVisitor(k){
  if(!k) return;
  sheet("Visitor " + k, '<div class="empty">Loading…</div>');
  api("GET", "/desk/visitor?k=" + k).then(function(j){
    if($("sheet").hidden) return;
    if(!j.ok){ $("sheetB").innerHTML = '<div class="empty">This visitor is no longer kept (ninety days after they were last seen, or deleted on request).</div>'; return; }
    var v = j.v, s = v.paid && v.paid.length ? 100 : v.score || 0;
    $("sheetT").textContent = "Visitor " + v.k + (v.name ? " · " + v.name : "");
    var h = '<div class="row between"><div>' + scoreTag(v) + ' <span class="muted small">' + (s >= 100 ? "Bought" : s >= 50 ? "Hot: close to buying" : s >= 25 ? "Warm" : "Browsing") + '</span></div><span class="faint small">First seen ' + dayAt(v.first) + ", last " + seenAt(v.last) + '</span></div><div class="meter"><i style="width:' + s + '%"></i></div>';
    if(v.name || v.phone || v.email) h += '<div class="card" style="margin-top:14px"><b>' + esc(v.name || "Gave contact details") + "</b>" + (v.city ? ' <span class="muted small">' + esc(v.city) + "</span>" : "") +
      '<div class="muted small">' + [esc(v.phone), esc(v.email)].filter(Boolean).join(" · ") + '</div><div class="oact">' + contactBtns(v.email, v.phone) + "</div></div>";
    h += '<div class="facts">' +
      "<div><span>Came from</span><b>" + esc(srcName(v)) + "</b></div>" +
      "<div><span>Ad</span><b>" + (v.cmp ? esc(v.cmp) + (v.ad ? " / " + esc(v.ad) : "") : '<span class="faint">none tagged</span>') + "</b></div>" +
      "<div><span>Roughly where</span><b>" + (place(v) ? esc(place(v)) : '<span class="faint">not known</span>') + "</b></div>" +
      "<div><span>On</span><b>" + esc([devName(v), v.br].filter(Boolean).join(", ") || "not known") + "</b></div>" +
      "<div><span>Visits</span><b>" + v.visits + "</b></div>" +
      "<div><span>Time on the site</span><b>" + stay(v.time) + "</b></div>" +
      "<div><span>Landed on</span><b>" + esc(PAGESN[v.landed] || v.landed) + "</b></div>" +
      "<div><span>Looked at</span><b>" + (v.numbers.length ? "No. " + v.numbers.map(esc).join(", ") : "") + (v.dials.length ? (v.numbers.length ? "; " : "") + v.dials.map(esc).join(", ") : "") + (!v.numbers.length && !v.dials.length ? '<span class="faint">no number yet</span>' : "") + "</b></div></div>";
    var visit = 0, open = false;
    (v.steps || []).forEach(function(e){
      if(e.e === "early_dial") return;
      if(e.e === "visit"){ if(open) h += "</ul>"; visit++; open = true; h += '<p class="tl-v">Visit ' + visit + " · " + dayAt(e.t) + '</p><ul class="tl">'; }
      else if(!open){ open = true; h += '<ul class="tl">'; }
      var cls = e.e === "paid" ? "p" : (e.e === "number" || e.e === "checkout" || e.e === "details") ? "k" : "";
      h += '<li class="' + cls + '"><span class="tm">' + clock(e.t) + "</span><span>" + esc(e.txt || e.e) + "</span></li>";
    });
    if(open) h += "</ul>";
    h += '<div class="row" style="margin-top:22px;padding-top:14px;border-top:1px solid var(--line)"><button class="btn sm warn" data-act="forget" data-k="' + v.k + '">Delete this visitor</button><span class="faint tiny">For when someone asks. Their orders stay in Razorpay.</span></div>';
    $("sheetB").innerHTML = h;
  });
}

/* ══ INSIGHTS ══ */
LOAD.insights = function(put){
  api("GET", "/desk/insights?r=" + (PARAMS.r || "30d")).then(function(j){
    if(!j.ok){ put(j.on === false ? '<div class="card empty">Insights start once the visitor counter is connected (Health).</div>' : failed(j)); return; }
    DATA.insights = j; put(RENDER.insights(j));
  });
};
function brows(rows, label, narrow, val){
  if(!rows || !rows.length) return '<p class="muted small" style="margin:0">Nothing yet in this period.</p>';
  var top = 1; rows.forEach(function(x){ top = Math.max(top, x.v); });
  return '<div class="bars">' + rows.map(function(x){
    var l = label(x), n = narrow ? narrow(x) : null;
    return '<div class="brow' + (n ? " go" : "") + '"' + (n ? ' data-go="visitors" data-p="' + esc(n) + '"' : "") + ' title="' + esc(l) + '"><span class="lab">' + esc(l) + '</span><span class="track"><i style="width:' + Math.max(2, Math.round(x.v / top * 100)) + '%"></i></span><span class="val">' + (val ? val(x) : x.v) + "</span></div>"; }).join("") + "</div>";
}
function conv(x){ return x.v + (x.paid ? ' · <span class="up">' + x.paid + " sold</span>" : x.co ? " · " + x.co + " checkout" : ""); }
RENDER.insights = function(j){
  var r = PARAMS.r || "30d", t = j.totals || {}, v = t.v || 0, rp = "r=" + r;
  function seg(k, l){ return '<button data-act="iset" data-v="' + k + '" aria-pressed="' + (r === k) + '">' + l + "</button>"; }
  var h = '<div class="row between"><div class="seg" role="group" aria-label="Period">' + seg("today", "Today") + seg("7d", "7 days") + seg("30d", "30 days") + seg("90d", "90 days") + '</div><span class="muted small">' + plural(v, "visitor") + " seen in this period</span></div>";
  if(j.pending) h += '<p class="note">Still working through ' + plural(j.pending, "older visitor") + ". The numbers fill in over the next few reloads.</p>";
  h += '<div class="grid g4" style="margin-top:14px">' +
    '<div class="kpi"><div class="v">' + v + '</div><div class="l">Visitors</div><div class="d">' + (t.back || 0) + " came back</div></div>" +
    '<div class="kpi"><div class="v">' + pct(t.co || 0, v) + '</div><div class="l">Opened checkout</div><div class="d">' + plural(t.co || 0, "person", "people") + "</div></div>" +
    '<div class="kpi"><div class="v">' + pct(t.paid || 0, v) + '</div><div class="l">Bought</div><div class="d">' + plural(t.paid || 0, "buyer") + "</div></div>" +
    '<div class="kpi go" data-go="visitors" data-p="f=hot&' + rp + '"><div class="v">' + (t.hot || 0) + '</div><div class="l">Hot leads</div><div class="d">' + (t.warm || 0) + " warm · " + stay((t.tsec || 0) * 1000) + " average stay</div></div></div>";
  var steps = [["Arrived", v], ["Reached the twenty", t.view || 0], ["Chose a dial", t.dial || 0], ["Chose a number", t.num || 0], ["Turned to the caseback", t.cas || 0], ["Opened checkout", t.co || 0], ["Gave their details", t.det || 0], ["Paid", t.paid || 0]];
  h += '<h2>Where people stop</h2><div class="card funnel">' + steps.map(function(s, i){
    var drop = i ? steps[i - 1][1] - s[1] : 0;
    return '<div class="st"><span>' + s[0] + '</span><span class="track"><i style="width:' + (v ? Math.max(1, Math.round(s[1] / v * 100)) : 0) + '%"></i></span><span class="val">' + s[1] + "<small>" + pct(s[1], v) + "</small>" + (i && drop > 0 ? '<small class="down">−' + drop + "</small>" : "") + "</span></div>"; }).join("") + "</div>";
  var src = j.sources || [], tot = function(x){ return x.v; };
  h += '<h2>Where they come from</h2><div class="card tight scroll"><table><tr><th>Source</th><th class="n">Visitors</th><th class="n">Chose a no.</th><th class="n">Checkout</th><th class="n">Sold</th><th class="n">Hot</th><th class="n">Visit to sale</th></tr>' +
    (src.length ? src.map(function(x){ return '<tr class="go" data-go="visitors" data-p="f=all&' + rp + "&src=" + esc(x.s) + '"><td>' + esc(cleanSrc(x.k)) + '</td><td class="n">' + x.v + '</td><td class="n">' + x.num + '</td><td class="n">' + x.co + '</td><td class="n">' + (x.paid ? '<b class="up">' + x.paid + "</b>" : 0) + '</td><td class="n">' + x.hot + '</td><td class="n">' + pct(x.paid, x.v) + "</td></tr>"; }).join("")
      : '<tr><td colspan="7" class="muted">Nobody yet in this period.</td></tr>') + "</table></div>";
  var cm = j.campaigns || [];
  h += '<h2>Which ad</h2>' + (cm.length ? '<div class="card tight scroll"><table><tr><th>Campaign</th><th>Ad</th><th class="n">Visitors</th><th class="n">Checkout</th><th class="n">Sold</th><th class="n">Hot</th></tr>' +
    cm.map(function(x){ return '<tr class="go" data-go="visitors" data-p="f=all&' + rp + "&cmp=" + esc(x.cmp) + (x.ad ? "&ad=" + esc(x.ad) : "") + '"><td>' + esc(x.cmp) + '</td><td class="muted">' + esc(x.ad || "–") + '</td><td class="n">' + x.v + '</td><td class="n">' + x.co + '</td><td class="n">' + (x.paid ? '<b class="up">' + x.paid + "</b>" : 0) + '</td><td class="n">' + x.hot + "</td></tr>"; }).join("") + "</table></div>"
    : '<div class="card"><p style="margin:0">No ad has been tagged yet, so every Meta visit reads as Instagram or Facebook. To see each campaign and ad here, add this to every ad in Meta Ads Manager (Ad, Destination, URL parameters):</p>' +
      '<div class="copy" style="margin-top:10px" id="utm">utm_source=meta&amp;utm_medium={{placement}}&amp;utm_campaign={{campaign.name}}&amp;utm_content={{ad.name}}</div><div class="row" style="margin-top:10px"><button class="btn sm" data-act="copy" data-text="utm_source=meta&amp;utm_medium={{placement}}&amp;utm_campaign={{campaign.name}}&amp;utm_content={{ad.name}}">Copy</button></div></div>');
  h += '<div class="grid g2 solo"><div><h2>Which states</h2><div class="card">' + brows(j.regions, function(x){ return x.region + (x.country && x.country !== "IN" ? ", " + x.country : ""); }, function(x){ return "f=all&" + rp + "&region=" + x.region; }, conv) + "</div></div>" +
    '<div><h2>Which cities</h2><div class="card">' + brows(j.cities, function(x){ return x.place; }, function(x){ return "f=all&" + rp + "&city=" + x.place; }, conv) + "</div></div></div>";
  h += '<div class="grid g2 solo"><div><h2>Which phones</h2><div class="card">' + brows(j.os, function(x){ return x.os; }, function(x){ return "f=all&" + rp + "&os=" + x.os; }, conv) + "</div></div>" +
    '<div><h2>Which browsers</h2><div class="card">' + brows(j.browsers, function(x){ return x.br; }, function(x){ return "f=all&" + rp + "&br=" + x.br; }, conv) + "</div></div></div>";
  var hours = []; for(var i = 0; i < 24; i++) hours.push({ v:0, paid:0 });
  (j.hours || []).forEach(function(x){ if(hours[x.h]) hours[x.h] = x; });
  var hv = 1, peak = 0; hours.forEach(function(x, i){ if(x.v > hv){ hv = x.v; peak = i; } });
  var days = [1,2,3,4,5,6,0].map(function(d){ var f = (j.weekdays || []).filter(function(x){ return x.d === d; })[0]; return { d:d, v: f ? f.v : 0, paid: f ? f.paid : 0 }; });
  var dv = 1; days.forEach(function(x){ dv = Math.max(dv, x.v); });
  h += '<div class="grid g2 solo"><div><h2>Which hours (India time)</h2><div class="card"><div class="cols" role="img" aria-label="Visitors by hour of first arrival">' + hours.map(function(x, i){ return '<i class="' + (x.v ? (i === peak ? "peak" : "") : "z") + '" style="height:' + (x.v ? Math.max(4, Math.round(x.v / hv * 100)) : 3) + '%" title="' + i + ":00, " + plural(x.v, "visitor") + (x.paid ? ", " + x.paid + " sold" : "") + '"></i>'; }).join("") +
    '</div><div class="axis"><span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>11pm</span></div><p class="note">' + (hv > 1 || (j.hours || []).length ? "Busiest around " + ((peak % 12) || 12) + (peak >= 12 ? "pm" : "am") + ". Schedule ads and posts just before it." : "") + "</p></div></div>" +
    '<div><h2>Which days</h2><div class="card">' + brows(days, function(x){ return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][x.d]; }, null, function(x){ return x.v + (x.paid ? ' · <span class="up">' + x.paid + " sold</span>" : ""); }) + "</div></div></div>";
  var nums = {}; (j.numbers || []).forEach(function(x){ nums[+x.k] = x; });
  var gone = {}; ((DATA.desk || {}).sold || []).forEach(function(n){ gone[n] = 1; });
  var nv = 1; Object.keys(nums).forEach(function(k){ nv = Math.max(nv, nums[k].v); });
  var heat = ""; for(var n = 1; n <= 20; n++){ var x = nums[n] || { v:0, paid:0 }, a = x.v ? 0.12 + 0.6 * x.v / nv : 0;
    heat += '<div class="' + (gone[n] ? "gone" : "") + '" style="background:rgba(198,161,91,' + a.toFixed(2) + ')" title="No. ' + pad(n) + ": " + plural(x.v, "visitor") + (gone[n] ? ", gone" : "") + '"><b>' + pad(n) + "</b><small>" + x.v + "</small></div>"; }
  h += '<h2>What pulls them</h2><div class="grid g2 solo"><div class="card"><h3>Numbers looked at</h3><p class="muted small" style="margin:0 0 10px">Brighter is more interest. A white ring is gone.</p><div class="heat">' + heat + "</div></div>" +
    '<div class="card"><h3>Dials chosen</h3>' + brows(j.dials, function(x){ return x.k; }, null, function(x){ return x.v + (x.paid ? ' · <span class="up">' + x.paid + " sold</span>" : ""); }) +
    '<h3 style="margin-top:18px">Story read</h3>' + brows((j.acts || []).slice(0, 8), function(x){ return x.name; }, null, null) + "</div></div>";
  var tb = ["under 30s","30s to 2 min","2 to 5 min","5 to 15 min","over 15 min"], tm = [0,1,2,3,4].map(function(b){ var f = (j.time || []).filter(function(x){ return x.b === b; })[0]; return { b:b, v: f ? f.v : 0, paid: f ? f.paid : 0 }; });
  h += '<h2>How long they stay</h2><div class="card">' + brows(tm, function(x){ return tb[x.b]; }, null, function(x){ return x.v + (x.paid ? ' · <span class="up">' + x.paid + " sold</span>" : ""); }) + "</div>";
  return h;
};

/* ══ AI SEARCH ══ */
LOAD.ai = function(put){
  both(api("GET", "/desk/data"), api("GET", "/desk/insights?r=30d"), function(dk, ins){
    DATA.desk = dk.ok ? dk : DATA.desk; put(RENDER.ai(dk.ok ? dk : {}, ins.ok ? ins : {}));
  });
};
RENDER.ai = function(dk, ins){
  var sold = dk.sold || [], left = dk.left != null ? dk.left : 20 - sold.length, dials = dk.dials || {}, by = {};
  for(var n = 1; n <= (dk.edition || 20); n++){ var d = dials[n] || "Ivory"; by[d] = by[d] || { open:[], made:0 }; by[d].made++; if(sold.indexOf(n) < 0) by[d].open.push(n); }
  var ai = (ins.sources || []).filter(function(x){ return /chatgpt|perplexity|bing|copilot|gemini|claude|duckduckgo|google/i.test(x.k); });
  var q = encodeURIComponent("How many KAAL Series 01 watches are left?");
  return '<div class="card"><h3>What answer engines are told right now</h3><p class="muted small" style="margin:0 0 12px">Every sale rewrites, in the same commit: the counts and grid on the shop page, its structured data (each number in or out of stock, how many left), llms.txt\'s Live status and edition.json. Bing is told at once (IndexNow), which is what ChatGPT search reads.</p>' +
    '<div class="grid g3"><div class="kpi"><div class="v">' + left + '</div><div class="l">Available</div></div><div class="kpi"><div class="v">' + sold.length + '</div><div class="l">No longer available</div></div><div class="kpi"><div class="v">' + (left ? "On sale" : "Retired") + '</div><div class="l">Status</div></div></div>' +
    '<div class="bars" style="margin-top:14px">' + Object.keys(by).map(function(k){ return '<div class="brow"><span class="lab">' + esc(k) + '</span><span class="track"><i class="ok" style="width:' + Math.round(by[k].open.length / by[k].made * 100) + '%"></i></span><span class="val">' + by[k].open.length + " of " + by[k].made + (by[k].open.length ? " · No. " + by[k].open.map(pad).join(", ") : "") + "</span></div>"; }).join("") + "</div></div>" +
    '<h2>Check it yourself</h2><div class="card"><div class="oact" style="margin-top:0">' +
    '<a class="btn sm" target="_blank" rel="noopener" href="https://thekaal.co/edition.json">edition.json</a><a class="btn sm" target="_blank" rel="noopener" href="https://thekaal.co/llms.txt">llms.txt</a>' +
    '<a class="btn sm" target="_blank" rel="noopener" href="https://search.google.com/test/rich-results?url=https%3A%2F%2Fthekaal.co%2F">Google rich results test</a><a class="btn sm" target="_blank" rel="noopener" href="https://validator.schema.org/#url=https%3A%2F%2Fthekaal.co%2F">Schema validator</a></div>' +
    '<p class="note">Ask the engines the question a buyer asks:</p><div class="oact"><a class="btn sm" target="_blank" rel="noopener" href="https://chatgpt.com/?q=' + q + '">Ask ChatGPT</a><a class="btn sm" target="_blank" rel="noopener" href="https://www.perplexity.ai/search?q=' + q + '">Ask Perplexity</a><a class="btn sm" target="_blank" rel="noopener" href="https://www.bing.com/search?q=' + q + '">Ask Bing</a><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/search?q=' + q + '">Ask Google</a></div></div>' +
    '<h2>Visitors sent by search and AI, 30 days</h2><div class="card">' + (ai.length ? brows(ai, function(x){ return cleanSrc(x.k); }, function(x){ return "f=all&r=30d&src=" + x.s; }, conv) : '<p class="muted small" style="margin:0">None yet. When ChatGPT, Perplexity, Bing or Google send someone, they show here with what they did.</p>') + "</div>";
};

/* ══ APPROVALS, PIECES, OWNERS, LIST, EMAILS, SETTINGS, AUDIT, HEALTH ══ */
var TYPENAME = { warranty:"Warranty claim", stolen:"Stolen report", contact:"Contact change", service:"Paid service", recovery:"Recovery" };
LOAD.approvals = function(put){ api("GET", "/control/api/approvals").then(function(j){ if(!j.ok){ put(failed(j)); return; } DATA.approvals = j; setBadge("approvals", j.requests.length + j.transfers.filter(function(x){ return x.status === "accepted"; }).length, true); put(RENDER.approvals(j)); }); };
RENDER.approvals = function(j){
  function media(x){ return (x.media || []).map(function(k, i){ return '<a class="btn ghost sm" target="_blank" rel="noopener" href="/control/api/media?k=' + encodeURIComponent(k) + '">File ' + (i + 1) + "</a>"; }).join(" "); }
  function btn(kind, id, d, label, cls){ return '<button class="btn sm ' + (cls || "ghost") + '" data-act="decide" data-kind="' + kind + '" data-id="' + id + '" data-do="' + d + '">' + label + "</button>"; }
  function acts(x){
    var id = x.id;
    if(x.type === "warranty") return x.status === "approved" ? btn("req", id, "serviced", "Mark serviced", "go") : btn("req", id, "approve", "Approve", "go") + btn("req", id, "info", "Ask for more") + btn("req", id, "decline", "Decline", "warn");
    if(x.type === "stolen") return x.status === "approved" ? btn("req", id, "clear", "Clear the flag") : btn("req", id, "confirm", "Confirm: flag it", "go") + btn("req", id, "dismiss", "Dismiss");
    if(x.type === "recovery") return btn("req", id, "verify", "Verify: move their sign-in", "go") + btn("req", id, "decline", "Decline", "warn");
    if(x.type === "contact") return btn("req", id, "done", "Done (changed in Owners)", "go");
    return btn("req", id, "close", "Close");
  }
  var r = j.requests.map(function(x){
    return '<div class="card"><div class="ohead"><b>No. ' + pad(x.number) + '</b><span class="pill gold">' + esc(TYPENAME[x.type] || x.type) + '</span><span class="pill' + (x.status === "approved" ? " ok" : "") + '">' + esc(x.status.replace("_", " ")) + '</span><span class="sp"></span><span class="faint small">' + esc(when(x.created_at)) + "</span></div>" +
      '<div style="margin-top:6px">' + esc(x.name || "") + ' <span class="muted small">' + esc(x.email || "") + " " + esc(x.phone || "") + "</span></div>" +
      '<p class="small" style="white-space:pre-wrap">' + esc(x.description || "") + "</p>" + (x.media.length ? '<div class="row">' + media(x) + "</div>" : "") +
      '<div class="oact">' + acts(x) + contactBtns(x.email, x.phone) + "</div></div>";
  }).join("");
  var t = j.transfers.map(function(x){
    return '<div class="card"><div class="ohead"><b>No. ' + pad(x.number) + '</b><span class="pill gold">Transfer</span><span class="pill">' + esc(x.status === "accepted" ? "accepted, waiting for you" : "code out, not accepted yet") + '</span><span class="sp"></span><span class="faint small">' + esc(when(x.created_at)) + "</span></div>" +
      '<div class="small" style="margin-top:6px">From ' + esc(x.from_name || "") + ' <span class="muted">' + esc(x.from_email) + "</span></div>" +
      (x.to_email ? '<div class="small">To ' + esc(x.to_name || "") + ' <span class="muted">' + esc(x.to_email) + "</span></div>" : '<div class="small muted">Nobody has accepted yet. The code expires ' + esc(when(x.expires_at)) + ".</div>") +
      (x.status === "accepted" ? '<div class="oact">' + btn("tr", x.id, "approve", "Approve", "go") + btn("tr", x.id, "reject", "Reject", "warn") + "</div>" : "") + "</div>";
  }).join("");
  return (r + t || '<div class="calm">&#10003; Nothing waiting.</div>') + '<p class="note">A claim is promised an answer within 48 hours. Every decision emails the owner and is written to the audit log.</p>';
};

LOAD.pieces = function(put){ both(api("GET", "/control/api/pieces"), api("GET", "/desk/insights?r=90d"), function(j, ins){ if(!j.ok){ put(failed(j)); return; } DATA.pieces = j; DATA.pinterest = ins.ok ? ins.numbers : []; put(RENDER.pieces(j)); }); };
RENDER.pieces = function(j){
  var interest = {}; (DATA.pinterest || []).forEach(function(x){ interest[+x.k] = x.v; });
  return '<p class="muted small" style="margin:0 0 12px">Tap a number for its photograph, status and notes. Interest is how many visitors chose or turned it over in 90 days.</p><div class="card tight list">' + j.pieces.map(function(p){
    return '<button class="lrow" data-act="piece" data-id="' + esc(p.id) + '"><div class="t"><b class="num">No. ' + pad(p.number) + ' <span class="muted" style="font-family:var(--sans);font-weight:400">' + esc(p.colorway) + "</span></b><span>" +
      (p.photo_url ? '<span class="pill ok">photo</span> ' : '<span class="pill">no photo</span> ') + '<span class="pill' + (/stolen/.test(p.status) ? " bad" : p.status === "available" ? "" : " gold") + '">' + esc(p.status.replace("_", " ")) + "</span></span></div>" +
      '<div class="m">' + (interest[p.number] ? plural(interest[p.number], "visitor") + " interested" : "No recorded interest yet") + (p.notes ? " · " + esc(p.notes.slice(0, 60)) : "") + "</div></button>";
  }).join("") + "</div>";
};
/* On sale, or kept back: one tap, and the registry, the live page and the
   site's own file (with what answer engines read) all change together. */
function saleBox(p){
  var sold = ["placed","delivered","registered"].indexOf(p.status) > -1;
  if(sold) return '<div class="saleBox"><div class="big">Sold, with an order</div><p class="muted small" style="margin:6px 0 0">To sell it again, refund it or mark it returned in Orders first.</p></div>';
  var on = p.status === "available" || p.status === "held";
  /* Free in the registry, yet the shop shows it gone: either it was sold
     before the registry (record that sale), or a release never reached the
     shop (put it on sale). Only the owner knows which, so both are offered. */
  if(on && (DATA.pieces.shopSold || []).indexOf(p.number) > -1) return '<div class="saleBox"><div class="big">Shown as gone on the shop</div><p class="muted small" style="margin:6px 0 10px">The registry has no order for No. ' + pad(p.number) + ', but the shop and the site file show it gone. If it was sold before the registry, record that sale. If it is still yours to sell, put it on sale.</p>' +
    '<div class="row"><button class="btn" data-act="pastSale">Record a past sale</button><button class="btn go" data-act="sale" data-n="' + p.number + '" data-v="1" data-sure="1">Put it on sale</button></div></div>';
  return '<div class="saleBox"><div class="row between"><div><div class="big">' + (on ? "On sale" : p.status === "withheld" ? "Kept back" : esc(p.status.replace("_", " "))) + '</div><p class="muted small" style="margin:4px 0 0">' +
    (on ? "Shown as open on the shop. Anyone can buy it." : "Shown as gone on the shop. Nobody can buy it.") + "</p></div>" +
    (on ? '<button class="btn warn" data-act="sale" data-n="' + p.number + '" data-v="0">Keep it back</button>' : '<button class="btn go" data-act="sale" data-n="' + p.number + '" data-v="1">Put it on sale</button>') +
    '</div><p class="note" style="margin-bottom:0">Changes the shop within seconds, and the site file, llms.txt and edition.json in one commit within a minute.</p></div>';
}
function saleGo(n, on, why){
  api("POST", "/control/api/pieces/" + n + "/sale", { on: on, reason: why || "" }).then(function(j){
    if(!j.ok){ say(j.why || "Not changed.", true); return; }
    closeSheet();
    var site = j.site === "ok" || j.site === "already" ? " The site file is updated too." : j.site === "skipped" ? " (Staging: the live site is untouched.)" : " The site file could not be written just now; the shop already shows it. Tap again later to retry the file.";
    say("No. " + pad(n) + (on ? " is on sale." : " is kept back.") + site, !(j.site === "ok" || j.site === "already" || j.site === "skipped"));
    if(VIEW === "pieces" || VIEW === "today") load();
  });
}
function pieceSheet(id){
  var p = DATA.pieces.pieces.filter(function(x){ return x.id === id; })[0];
  sheet("No. " + pad(p.number) + " · " + p.colorway, saleBox(p) +
    (p.photo_url ? '<img src="' + esc(p.photo_url) + '" alt="No. ' + pad(p.number) + '" style="width:100%;max-width:360px;border-radius:10px">' : '<p class="muted">No photograph of this piece yet.</p>') +
    '<label for="ph">Photograph of this exact watch (JPEG, PNG or WebP, up to 3 MB)</label><input id="ph" type="file" accept="image/jpeg,image/png,image/webp">' +
    '<div class="row" style="margin-top:8px"><button class="btn" data-act="photo" data-id="' + esc(id) + '">Upload</button></div>' +
    '<label for="ps">Status</label><select id="ps">' + DATA.pieces.statuses.filter(function(s){ return s !== "held"; }).map(function(s){ return "<option" + (s === p.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
    '<label for="pr">Reason (needed to change the status; it is logged)</label><input id="pr">' +
    '<label for="pc">Colourway</label><input id="pc" value="' + esc(p.colorway) + '">' +
    '<label for="pn">Private notes</label><textarea id="pn">' + esc(p.notes || "") + "</textarea>" +
    '<p class="err" id="sheetErr"></p><button class="btn go" data-act="pieceSave" data-id="' + esc(id) + '">Save</button>');
}

/* Every owner, live: who holds which number, and each warranty counting
   down to the second. Tap one for their own page, exactly as they see it. */
var OWNOFF = 0, OWNT = 0;
LOAD.owners = function(put){
  both(api("GET", "/control/api/owners?q=" + encodeURIComponent(PARAMS.q || "")), api("GET", "/control/api/owners/live"), function(j, lv){
    if(!j.ok){ put(failed(j)); return; }
    if(lv.ok) OWNOFF = lv.now - Date.now();
    put(RENDER.owners(j, lv.ok ? lv.owners : []));
  });
};
function dayLong(day){ if(!day) return ""; var d = new Date(String(day).slice(0, 10) + "T12:00:00Z"); return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric", timeZone:"UTC" }); }
function wleft(endMs){
  var s = Math.max(0, Math.floor((endMs - (Date.now() + OWNOFF)) / 1000));
  return { d: Math.floor(s / 86400), t: pad(Math.floor(s % 86400 / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60), done: s === 0 };
}
function wclock(w){
  if(!w) return '<span class="muted small">Warranty starts on delivery</span>';
  var l = wleft(w.endMs), used = Math.min(100, Math.max(0, Math.round((Date.now() + OWNOFF - w.startMs) / (w.endMs - w.startMs) * 100)));
  if(l.done) return '<span class="muted small">Warranty concluded ' + esc(dayLong(w.endDay)) + "</span>";
  return '<span class="wclk" data-end="' + w.endMs + '"><b class="num">' + l.d + '</b> days <span class="num t">' + l.t + '</span></span><span class="wbar" aria-hidden="true"><i style="width:' + used + '%"></i></span>';
}
RENDER.owners = function(j, live){
  var board = live.length ? '<div class="obd">' + live.map(function(o){
    return '<button class="ocard" data-act="owner" data-id="' + o.id + '"><div class="row between"><b class="num" style="font-family:var(--serif);font-size:26px;font-weight:400">No. ' + pad(o.n) + '</b><span class="pill gold">Owner ' + roman(o.ownerNo) + "</span></div>" +
      '<div style="margin-top:4px"><b style="font-weight:500">' + esc(o.name || o.email) + '</b> <span class="muted small">' + esc(o.city || "") + "</span></div>" +
      '<div class="small faint">' + esc(o.colorway) + " \u00b7 since " + esc(when(o.since)) + (o.openRequests ? ' \u00b7 <span style="color:var(--goldLit)">' + plural(o.openRequests, "open request") + "</span>" : "") + "</div>" +
      '<div class="ow">' + wclock(o.warranty) + "</div>" +
      '<div class="small faint">On the shop: ' + (o.initialsPublic ? "initials" : "a private collector") + (o.cityPublic ? ", city" : "") + "</div></button>"; }).join("") + "</div>" : "";
  return (board ? "<h2 style=\"margin-top:0\">Every owner, live</h2>" + board : "") +
    '<h2>Search</h2><input id="oq" type="search" placeholder="Search by name, email or phone" value="' + esc(PARAMS.q || "") + '" aria-label="Search owners">' +
    (j.owners.length ? '<div class="card tight list" style="margin-top:12px">' + j.owners.map(function(w){ return '<button class="lrow" data-act="owner" data-id="' + w.id + '"><div class="t"><b>' + esc(w.name || w.email) + "</b><span>" + (w.role === "admin" ? '<span class="pill gold">admin</span> ' : "") + '<span class="muted small">' + esc(w.pieces || "") + '</span></span></div><div class="m">' + esc(w.email) + "</div></button>"; }).join("") + "</div>"
      : '<div class="card empty" style="margin-top:12px">No owners yet. They appear when they register their piece.</div>');
};
function roman(n){ var r = [[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]], o = "", x = Math.max(1, n | 0); r.forEach(function(p){ while(x >= p[0]){ o += p[1]; x -= p[0]; } }); return o; }
/* The clocks step once a second while Owners, or an owner's page, is open. */
setInterval(function(){
  if(!SIGNED || document.visibilityState !== "visible" || (VIEW !== "owners" && $("sheet").hidden)) return;
  Array.prototype.forEach.call(document.querySelectorAll(".wclk"), function(e){ var l = wleft(+e.getAttribute("data-end")); var b = e.querySelector("b"), t = e.querySelector(".t"); if(b) b.textContent = l.d; if(t) t.textContent = l.t; });
}, 1000);
AFTER.owners = function(){ var q = $("oq"); if(q) q.addEventListener("change", function(){ go("owners", { q: q.value.trim() }); }); };
function dossierHtml(d){
  if(!d || !d.ok) return '<p class="muted small">Their own page could not be read just now.</p>';
  if(d.now) OWNOFF = d.now - Date.now();
  if(!d.pieces.length) return '<p class="muted">No piece in their name yet.</p>';
  return d.pieces.map(function(p){
    var rq = (p.requests || []).map(function(r){ return '<span class="pill gold">' + esc(TYPENAME[r.type] || r.type) + " \u00b7 " + esc(r.status.replace("_", " ")) + "</span>"; }).join(" ");
    return '<div class="card dz"><div class="row between"><b style="font-family:var(--serif);font-size:30px;font-weight:400" class="num">No. ' + pad(p.n) + ' <span class="muted" style="font-size:16px">of ' + p.size + '</span></b><span class="pill gold">Owner ' + roman(p.ownerNo) + "</span></div>" +
      '<div class="small faint">' + esc(p.series) + " \u00b7 " + esc(p.colorway) + (p.stolen ? ' \u00b7 <span style="color:var(--bad)">reported stolen</span>' : "") + "</div>" +
      '<div class="ow" style="margin:12px 0 8px">' + wclock(p.warranty) + "</div>" +
      '<table class="small"><tr><td class="faint">Delivered</td><td class="n">' + esc(p.deliveredOn ? dayLong(p.deliveredOn) : "\u2013") + '</td></tr><tr><td class="faint">Registered</td><td class="n">' + esc(when(p.registeredOn)) + "</td></tr>" +
      (p.warranty ? '<tr><td class="faint">Covered until</td><td class="n">' + esc(dayLong(p.warranty.endDay)) + "</td></tr>" : "") +
      '<tr><td class="faint">Owners so far</td><td class="n">' + p.chain.map(function(c){ return "Owner " + roman(c.ownerNo) + " " + c.from + "\u2013" + (c.to || "now"); }).join(", ") + "</td></tr>" +
      '<tr><td class="faint">Service visits</td><td class="n">' + (p.service || []).length + "</td></tr>" +
      (p.transfer ? '<tr><td class="faint">Transfer</td><td class="n">' + esc(p.transfer.status) + "</td></tr>" : "") + "</table>" +
      (rq ? '<div class="pills">' + rq + "</div>" : "") + "</div>";
  }).join("") + '<p class="note">On the shop, a tap on their number shows: ' + (d.owner.showName ? esc(d.owner.initials) : "a private collector") + (d.owner.showCity && d.owner.city ? ", " + esc(d.owner.city) : "") + ".</p>";
}
function ownerSheet(id){
  both(api("GET", "/control/api/owners/" + id), api("GET", "/control/api/owners/" + id + "/dossier"), function(j, dz){
    if(!j.ok){ say("Could not load that owner.", true); return; }
    var w = j.owner;
    sheet(w.name || w.email,
      "<h2 style=\"margin-top:0\">Their page, as they see it</h2>" + dossierHtml(dz) +
      '<p class="muted small">' + plural(j.sessions, "signed-in device") + ". Joined " + esc(when(w.created_at)) + ". City public: " + (w.show_city_publicly ? "yes" : "no") + '.</p><div class="oact" style="margin-top:0">' + contactBtns(w.email, w.phone) + "</div>" +
      "<h2>Ownership chain</h2>" + (j.chain.length ? '<div class="card tight scroll"><table>' + j.chain.map(function(c){ return "<tr><td>" + esc(c.piece_id) + "</td><td>Owner " + c.owner_no + "</td><td>" + esc(c.email) + '</td><td class="n">' + esc((c.from_at || "").slice(0, 10)) + " to " + esc(c.to_at ? c.to_at.slice(0, 10) : "now") + "</td></tr>"; }).join("") + "</table></div>" : '<p class="muted">No pieces yet.</p>') +
      "<h2>Contact details, on the owner's request</h2>" +
      '<label for="on">Name</label><input id="on" value="' + esc(w.name || "") + '"><label for="oe">Email (signs them out everywhere)</label><input id="oe" type="email" value="' + esc(w.email) + '">' +
      '<label for="op">Phone</label><input id="op" value="' + esc(w.phone || "") + '"><div class="grid g2"><div><label for="oc">City</label><input id="oc" value="' + esc(w.city || "") + '"></div><div><label for="os">State</label><input id="os" value="' + esc(w.state || "") + '"></div></div>' +
      '<p class="err" id="sheetErr"></p><div class="oact"><button class="btn go" data-act="ownerSave" data-id="' + w.id + '">Save</button><button class="btn warn" data-act="revoke" data-id="' + w.id + '">Sign out every device</button></div>');
  });
}

LOAD.list = function(put){ api("GET", "/desk/data").then(function(j){ if(!j.ok){ put(failed(j)); return; } DATA.desk = j; put(RENDER.list(j)); }); };
RENDER.list = function(d){
  var L = d.leads || { total:0, today:0, recent:[] };
  return '<div class="grid g3"><div class="kpi"><div class="v">' + L.total + '</div><div class="l">On the list</div></div><div class="kpi"><div class="v">' + L.today + '</div><div class="l">Joined today</div></div><div class="kpi"><div class="v" style="font-size:18px;padding-top:6px"><a href="/desk/leads.csv">Download CSV</a></div><div class="l">Everyone, with source</div></div></div>' +
    '<p class="note">One note goes to them while Series 01 is open, and one email when Series 02 is drawn. Nothing else.</p>' +
    (L.recent.length ? '<div class="card tight list" style="margin-top:12px">' + L.recent.map(function(l){ return '<div class="lrow"><div class="t"><a href="mailto:' + esc(l.email) + '">' + esc(l.email) + '</a><span class="faint small">' + esc(l.at) + '</span></div><div class="m">' + esc(l.source || "") +
      ' <button class="btn ghost sm" style="margin-left:8px" data-act="stop" data-email="' + esc(l.email) + '" data-v="' + (l.stopped ? "undo" : "stop") + '">' + (l.stopped ? "Emails stopped · undo" : "Stop emails") + "</button></div></div>"; }).join("") + "</div>" : '<div class="card empty">No one on the list yet.</div>');
};

LOAD.emails = function(put){ api("GET", "/control/api/emails").then(function(j){ if(!j.ok){ put(failed(j)); return; } put(RENDER.emails(j)); }); };
RENDER.emails = function(j){
  var failedN = j.emails.filter(function(e){ return e.status === "failed"; }).length;
  return "<h2>Outbox" + (failedN ? '<span class="count">' + failedN + " failed</span>" : "") + "</h2>" + (j.emails.length ? '<div class="card tight scroll"><table>' + j.emails.map(function(e){
      return '<tr><td class="small faint" style="white-space:nowrap">' + esc(when(e.created_at)) + "</td><td>" + esc(e.subject) + '<div class="muted small">' + esc(e.to_email) + (e.last_error ? " · " + esc(e.last_error) : "") + '</div></td><td class="n"><span class="pill ' + (e.status === "sent" ? "ok" : e.status === "failed" ? "bad" : "gold") + '">' + esc(e.status) + "</span>" +
        (e.status !== "sent" ? ' <button class="btn ghost sm" data-act="retry" data-id="' + e.id + '">Retry</button>' : "") + "</td></tr>"; }).join("") + "</table></div>" : '<div class="card empty">Nothing sent yet.</div>') +
    "<h2>Templates</h2>" + '<div class="card tight list">' + j.templates.map(function(t){ return '<div class="lrow"><div class="t"><span>' + esc(t) + '</span><span class="row"><button class="btn ghost sm" data-act="tpl" data-t="' + esc(t) + '">Preview</button><button class="btn sm" data-act="test" data-t="' + esc(t) + '">Send me a test</button></span></div></div>'; }).join("") + "</div>";
};

LOAD.settings = function(put){ both(api("GET", "/control/api/settings"), api("GET", "/control/api/sessions"), function(j, ss){ if(!j.ok){ put(failed(j)); return; } put(RENDER.settings(j, ss.ok ? ss.sessions : [])); }); };
RENDER.settings = function(j, sessions){
  var s = j.settings, se = j.series[0] || {};
  return '<h2>Phone alerts</h2><div class="card" id="pushCard"><p class="muted small" style="margin:0">Checking this device\u2026</p></div>' +
    "<h2>Security</h2>" + '<div class="card"><p style="margin:0 0 10px">This command centre opens with the passcode, for thirty days on each device. A sign-in on a device it has not seen before emails you. Change the passcode in GitHub, Settings, Secrets and variables, Actions, DESK_PASSCODE; it takes effect with the next deploy.</p>' +
    (sessions.length ? '<div class="card tight" style="margin:10px 0"><table><tr><th>Signed in</th><th>Device</th><th class="n">Until</th></tr>' + sessions.map(function(x){ return "<tr><td>" + esc(when(x.since)) + "</td><td>" + esc(x.device) + (x.here ? ' <span class="pill ok">this one</span>' : "") + '</td><td class="n">' + esc(when(x.until)) + "</td></tr>"; }).join("") + "</table></div>" : "") +
    '<button class="btn warn" data-act="revokeAll">Sign out every device</button></div>' +
    "<h2>The shop</h2>" + '<div class="card"><div class="check"><input type="checkbox" id="s1"' + (s.stage_emails === "1" ? " checked" : "") + '><label for="s1">Every stage change emails the buyer</label></div>' +
    '<div class="check"><input type="checkbox" id="s2"' + (s.transfers_need_approval === "1" ? " checked" : "") + '><label for="s2">Transfers wait for my approval</label></div>' +
    '<label for="s3">Sender name</label><input id="s3" value="' + esc(s.sender_name) + '"><p class="note">Sends from ' + esc(j.sender) + ". Admin: " + esc(j.admin) + ".</p>" +
    '<label for="s4">Warranty terms (your own note; the public terms are on legal.html)</label><textarea id="s4">' + esc(s.warranty_terms) + "</textarea>" +
    '<label for="s7">Setting guide video link (https; shown to owners on their page)</label><input id="s7" type="url" placeholder="https://" value="' + esc(s.guide_video_url || "") + '">' +
    '<div class="grid g2"><div><label for="s5">Return days</label><input id="s5" type="number" min="7" max="30" value="' + esc(se.return_days) + '"></div><div><label for="s6">Warranty months</label><input id="s6" type="number" min="12" max="60" value="' + esc(se.warranty_months) + '"></div></div>' +
    '<p class="err" id="setErr"></p><button class="btn go" data-act="saveSettings" data-code="' + esc(se.code) + '">Save settings</button></div>' +
    "<h2>Blocked buyers</h2>" + (j.blocked.length ? '<div class="card tight"><table>' + j.blocked.map(function(b){ return "<tr><td>" + esc(b.email || "") + "<br>" + esc(b.phone || "") + '</td><td class="muted small">' + esc(b.reason) + '</td><td class="n"><button class="btn ghost sm" data-act="unblock" data-id="' + b.id + '">Remove</button></td></tr>'; }).join("") + "</table></div>" : "") +
    '<div class="card"><div class="grid g2"><div><label for="b1">Email</label><input id="b1" type="email"></div><div><label for="b2">Phone</label><input id="b2" inputmode="tel"></div></div><label for="b3">Reason</label><input id="b3"><p class="err" id="blkErr"></p><button class="btn" data-act="block">Block</button></div>';
};

/* Phone alerts: this device's subscription, the kinds, a test. */
var PUSH = null;
function b64uToU8(x){ x = String(x).replace(/-/g, "+").replace(/_/g, "/"); while(x.length % 4) x += "="; var b = atob(x), u = new Uint8Array(b.length); for(var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function pushSupport(){ return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window; }
function standalone(){ return (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true; }
function isIOS(){ return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); }
function mySub(){ if(!pushSupport()) return Promise.resolve(null); return navigator.serviceWorker.getRegistration("/control").then(function(r){ return r ? r.pushManager.getSubscription() : null; }).catch(function(){ return null; }); }
AFTER.settings = function(){
  api("GET", "/control/api/push/state").then(function(j){
    if(!j.ok){ var c0 = $("pushCard"); if(c0) c0.innerHTML = '<p class="muted small" style="margin:0">' + esc(j.why || "Alerts could not be read.") + "</p>"; return; }
    PUSH = j;
    mySub().then(function(sub){
      var c = $("pushCard"); if(!c) return;
      var on = !!(sub && j.endpoints.indexOf(sub.endpoint) > -1), h = "";
      if(on) h += '<div class="row between"><div><b style="color:var(--ok)">On, on this device</b><p class="muted small" style="margin:2px 0 0">A sale arrives within seconds, even with this closed.</p></div><div class="row"><button class="btn sm" data-act="pushTest">Send a test</button><button class="btn sm ghost" data-act="pushOff" data-e="' + esc(sub.endpoint) + '">Turn off here</button></div></div>';
      else if(!pushSupport() && isIOS()) h += '<p style="margin:0"><b>On iPhone, three taps first.</b> In Safari: Share, then Add to Home Screen. Open KAAL from the Home Screen, sign in, and come back here.</p>';
      else if(!pushSupport()) h += '<p class="muted" style="margin:0">This browser cannot show alerts. Chrome on Android, or Safari from the Home Screen on iPhone, can.</p>';
      else h += '<div class="row between"><div><b>Off on this device</b><p class="muted small" style="margin:2px 0 0">Turn it on to hear of every sale the moment it is paid.</p></div><button class="btn go" data-act="pushOn">Turn on phone alerts</button></div>';
      h += '<div style="margin-top:12px">' + Object.keys(j.kinds).map(function(k){ return '<div class="check"><input type="checkbox" class="pk" id="pk_' + k + '" data-k="' + k + '"' + (j.prefs[k] ? " checked" : "") + (k === "sale" ? " disabled" : "") + '><label for="pk_' + k + '">' + esc(j.kinds[k]) + (k === "sale" ? " (always)" : "") + "</label></div>"; }).join("") + "</div>";
      if(j.devices.length) h += '<p class="note" style="margin-bottom:0">' + plural(j.devices.length, "device") + " receive alerts: " + j.devices.map(function(d){ return esc(d.device || "a browser"); }).join(", ") + ".</p>";
      c.innerHTML = h;
      Array.prototype.forEach.call(c.querySelectorAll(".pk"), function(x){ x.addEventListener("change", function(){
        var prefs = {}; Array.prototype.forEach.call(c.querySelectorAll(".pk"), function(y){ prefs[y.getAttribute("data-k")] = y.checked; });
        api("POST", "/control/api/push/prefs", { prefs: prefs }).then(function(r){ say(r.ok ? "Saved." : "Not saved.", !r.ok); });
      }); });
    });
  });
};
function pushOn(){
  if(!pushSupport()){ say(isIOS() && !standalone() ? "On iPhone: Share, Add to Home Screen, open KAAL from there, then turn alerts on." : "This browser cannot show alerts.", true); return; }
  if(!PUSH || !PUSH.key){ say("Reload this screen and try again.", true); return; }
  Notification.requestPermission().then(function(perm){
    if(perm !== "granted"){ say("Alerts are blocked for this site. Allow notifications in the browser's site settings, then try again.", true); return null; }
    return navigator.serviceWorker.register("/control/sw.js", { scope:"/control" }).then(function(){ return navigator.serviceWorker.ready; }).then(function(reg){
      return reg.pushManager.getSubscription().then(function(old){ return old || reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64uToU8(PUSH.key) }); });
    }).then(function(sub){ return api("POST", "/control/api/push/subscribe", { sub: sub.toJSON() }); }).then(function(j){
      if(!j.ok){ say(j.why || "Not turned on.", true); return; }
      say("Phone alerts are on. Sending a test\u2026"); api("POST", "/control/api/push/test", {}); load();
    });
  }).catch(function(e){ say("Could not turn alerts on: " + ((e && e.message) || "the browser refused"), true); });
}
function pushOff(endpoint){
  mySub().then(function(sub){ if(sub) sub.unsubscribe().catch(function(){}); return api("POST", "/control/api/push/unsubscribe", { endpoint: endpoint }); }).then(function(){ say("Alerts are off on this device."); load(); });
}

LOAD.audit = function(put){ api("GET", "/control/api/audit").then(function(j){ if(!j.ok){ put(failed(j)); return; } put(RENDER.audit(j)); }); };
RENDER.audit = function(j){
  return '<div class="card"><h3>Export</h3><div class="oact"><a class="btn sm" href="/control/api/export/orders.csv">Orders</a><a class="btn sm" href="/control/api/export/owners.csv">Owners</a><a class="btn sm" href="/control/api/export/pieces.csv">Pieces</a><a class="btn sm" href="/desk/orders.csv">Razorpay orders, with addresses</a><a class="btn sm" href="/desk/visitors.csv?r=90d">Visitors</a><a class="btn sm" href="/desk/leads.csv">Series 02 list</a><a class="btn sm go" href="/control/api/backup">Backup now</a></div></div>' +
    '<h2>Every admin action</h2><div class="card tight scroll"><table>' + j.audit.map(function(a){ return '<tr><td class="small faint" style="white-space:nowrap">' + esc(when(a.at)) + '</td><td class="small">' + esc(a.action) + '<div class="muted">' + esc(a.target || "") + " · " + esc(a.actor) + '</div></td><td class="small muted" style="word-break:break-word">' + esc((a.after || "").slice(0, 160)) + "</td></tr>"; }).join("") + "</table></div>";
};

LOAD.health = function(put){ both(api("GET", "/control/api/overview"), api("GET", "/desk/data"), function(ov, dk){ var seen = {}, all = [];
  ((ov.ok && ov.health) || []).concat((dk.ok && dk.health) || []).forEach(function(h){ if(!seen[h.label]){ seen[h.label] = 1; all.push(h); } });
  if(!all.length){ put(failed(ov)); return; }
  put('<div class="card tight list">' + all.map(function(h){ return '<div class="lrow"><div class="t"><b>' + esc(h.label) + '</b><span class="pill ' + (h.ok ? "ok" : "bad") + '">' + (h.ok ? "ok" : "check") + '</span></div><div class="m">' + esc(h.detail) + "</div></div>"; }).join("") + "</div>"); }); };

/* ══ THE COMMAND BAR: say it in words ══
   "Put 9 on sale", "keep 12 back", "show hot leads", "visitor 14", "how
   many are left". Words that change something are read back for a yes
   first; nothing changes until you press Do it. */
var CMD = null;
var CMD_EX = ["Put No. 09 on sale", "Keep No. 12 back", "How many are left?", "Show hot leads", "Who is on the site?", "Orders to ship", "Visitor 1", "Turn on phone alerts"];
function cmdSheet(){
  CMD = null;
  sheet("Tell it what to do", '<label for="cmdIn">In your own words</label><input id="cmdIn" autocomplete="off" placeholder="e.g. put 9 back on sale">' +
    '<div class="cmdex">' + CMD_EX.map(function(x){ return '<button type="button" data-act="cmdEx">' + esc(x) + "</button>"; }).join("") + '</div><div id="cmdOut" style="margin-top:14px"></div>');
  setTimeout(function(){ var i = $("cmdIn"); if(i) i.focus(); }, 30);
  var i = $("cmdIn"); if(i) i.addEventListener("input", function(){ CMD = null; $("cmdOut").innerHTML = ""; });
}
function cmdParse(t){
  t = String(t || "").toLowerCase().replace(/[\u2019']/g, "").trim();
  var nm = /(?:no\.?|number|num|#|piece|watch)?\s*(\d{1,2})\b/.exec(t), n = nm ? +nm[1] : 0;
  var vm = /\b(?:visitor|v)\s*#?(\d{1,6})\b/.exec(t);
  if(vm) return { go:"visitor", k: +vm[1], say: "Opening visitor " + vm[1] + "." };
  if(n >= 1 && n <= 20){
    if(/\b(unsold|not sold|on sale|back on sale|for sale|available|release|relist|re-list|sell it|sell no|reopen|open it|make it open|un-?hold|unhold|free it|list it)\b/.test(t) && !/\b(keep|hold back|withhold|off sale|take .*off)\b/.test(t))
      return { act:"sale", n:n, on:true, say: "Put No. " + pad(n) + " on sale: the shop shows it open, anyone can buy it, and the site file and llms.txt are updated." };
    if(/\b(keep|hold|withhold|off sale|take .*off|reserve|not for sale|unavailable|mark .*sold|sold out|remove)\b/.test(t))
      return { act:"sale", n:n, on:false, say: "Keep No. " + pad(n) + " back: the shop shows it gone and nobody can buy it." };
    if(/\b(order|ship|dispatch|deliver)/.test(t)) return { go:"orders", say: "Opening orders." };
    return { go:"piece", n:n, say: "Opening No. " + pad(n) + "." };
  }
  if(/\b(left|remain|stock|how many|available)\b/.test(t)) return { ans:"left" };
  if(/\b(hot|lead)/.test(t)) return { go:"visitors", p:{ f:"hot" }, say:"Opening hot leads." };
  if(/\b(who is|whos|on the site|live|right now|activity|happening|feed)\b/.test(t)) return { go:"activity", p:{ r:"1h" }, say:"Opening the live activity." };
  if(/\b(ship|order|dispatch|deliver)/.test(t)) return { go:"orders", say:"Opening orders to ship." };
  if(/\b(alert|notif|push|phone)/.test(t)) return { go:"settings", say:"Opening Settings: phone alerts are at the top." };
  if(/\b(claim|warranty|approv|request)/.test(t)) return { go:"approvals", say:"Opening approvals." };
  if(/\b(source|campaign|ad|insight|where.*from)/.test(t)) return { go:"insights", say:"Opening insights." };
  if(/\b(owner)/.test(t)) return { go:"owners", say:"Opening owners." };
  if(/\b(follow|nearly|abandon|lead email)/.test(t)) return { go:"followups", say:"Opening follow-ups." };
  if(/\b(email)/.test(t)) return { go:"emails", say:"Opening emails." };
  if(/\b(sale|sold|revenue|today|visits|dashboard)/.test(t)) return { go:"today", say:"Opening today." };
  return null;
}
function cmdRun(){
  var c = cmdParse($("cmdIn").value), o = $("cmdOut");
  if(!c){ o.innerHTML = '<p class="muted">I did not follow that. Try one of the examples above: a number and what to do with it, or a screen.</p>'; return; }
  if(c.ans === "left"){
    var dk = DATA.desk || {}, ov = DATA.overview || {}, sold = dk.sold || [];
    if(!dk.sold && ov.pieces) sold = ov.pieces.filter(function(p){ return p.state !== "available" && p.state !== "held"; }).map(function(p){ return p.number; });
    var open = []; for(var i = 1; i <= (dk.edition || 20); i++) if(sold.indexOf(i) < 0) open.push(i);
    o.innerHTML = '<div class="saleBox"><div class="big">' + open.length + " of " + (dk.edition || 20) + ' are open</div><p class="muted small" style="margin:6px 0 0">' + (open.length ? "Nos. " + open.map(pad).join(", ") : "All twenty are gone.") + "</p></div>"; return;
  }
  if(c.act){ CMD = c; o.innerHTML = '<div class="saleBox"><p style="margin:0 0 12px">' + esc(c.say) + '</p><div class="row"><button class="btn go" data-act="cmdGo">Do it</button><button class="btn ghost" data-act="close">Cancel</button></div></div>'; return; }
  CMD = c; cmdDo();
}
function cmdDo(){
  var c = CMD; if(!c) { cmdRun(); return; } CMD = null;
  if(c.act === "sale"){ saleGo(c.n, c.on, (c.on ? "put on sale" : "kept back") + " by command: " + String($("cmdIn") ? $("cmdIn").value : "").slice(0, 80)); return; }
  closeSheet();
  if(c.go === "visitor"){ openVisitor(c.k); return; }
  if(c.go === "piece"){ go("pieces"); var tries = 0, t = setInterval(function(){ tries++; if(DATA.pieces && VIEW === "pieces"){ clearInterval(t); pieceSheet("S01-" + pad(c.n)); } else if(tries > 40) clearInterval(t); }, 100); return; }
  go(c.go, c.p);
}

/* ══ the sheet ══ */
var FROM = null;
function sheet(title, html){ FROM = document.activeElement; $("sheetT").textContent = title; $("sheetB").innerHTML = html; $("sheet").hidden = false; document.body.style.overflow = "hidden"; var f = $("sheet").querySelector('[data-act="close"]'); if(f) f.focus(); }
function closeSheet(){ if($("sheet").hidden) return; $("sheet").hidden = true; $("sheetB").innerHTML = ""; document.body.style.overflow = ""; if(FROM && FROM.focus && document.body.contains(FROM)) FROM.focus(); }
function frame(src){ sheet("Preview", '<iframe src="' + esc(src) + '" title="Email preview"></iframe><p><a href="' + esc(src) + '&format=text" target="_blank" rel="noopener">The plain-text version</a></p>'); }
function moreSheet(){
  sheet("Everything", '<div class="more">' + NAV.filter(function(n){ return ["today","orders","visitors","insights"].indexOf(n.v) < 0; }).map(function(n){ return '<button class="btn" data-go="' + n.v + '">' + n.t + (BADGE[n.v] ? ' <span class="badge">' + BADGE[n.v] + "</span>" : "") + "</button>"; }).join("") +
    '<button class="btn warn" id="out2" data-act="signout">Sign out</button></div>');
}
function decideSheet(kind, id, d){
  function goBtn(label, cls){ return '<p class="err" id="sheetErr"></p><button class="btn ' + (cls || "go") + '" style="margin-top:12px" data-act="decideGo" data-kind="' + kind + '" data-id="' + id + '" data-do="' + d + '">' + label + "</button>"; }
  function area(f, label, hint){ return '<label for="d_' + f + '">' + label + '</label><textarea id="d_' + f + '"></textarea>' + (hint ? '<p class="note">' + hint + "</p>" : ""); }
  var x = (DATA.approvals && DATA.approvals.requests || []).filter(function(q){ return q.id === id; })[0];
  if(kind === "tr"){ sheet(d === "approve" ? "Approve this transfer" : "Reject this transfer", '<p class="muted small">' + (d === "approve" ? "The old ownership closes today and the new owner becomes the next Owner. The warranty does not move. Both are emailed." : "It stays with its current owner. Both are emailed.") + '</p><label for="d_note">A note for the log (optional)</label><input id="d_note">' + goBtn(d === "approve" ? "Approve the transfer" : "Reject the transfer", d === "approve" ? "go" : "warn")); return; }
  if(d === "approve") sheet("Approve the claim", area("pickup", "Pickup details, emailed to the owner", "Who collects it and when. For example: a courier collects it on 28 October between 10 and 1. Keep it in its box.") + goBtn("Approve and email them"));
  else if(d === "info") sheet("Ask for more", area("message", "What you need from them", "Emailed as it is written.") + goBtn("Send the question"));
  else if(d === "decline") sheet("Decline", area("reason", "The reason, said kindly and plainly", "They are sent it, with the offer of a paid service.") + goBtn("Decline and email them", "warn"));
  else if(d === "serviced") sheet("Mark serviced", '<label for="d_work_done">What was done (private)</label><input id="d_work_done" placeholder="Replaced the movement, serial 4471">' +
    '<label for="d_public_line">A line for the public registry (optional)</label><input id="d_public_line" placeholder="Movement replaced under warranty"><label for="d_date">Date</label><input id="d_date" type="date">' +
    '<label for="d_courier">Courier back to the owner (optional)</label><input id="d_courier"><label for="d_tracking">Tracking number (optional)</label><input id="d_tracking">' + goBtn("Save, and email that it is on its way back"));
  else if(d === "confirm") sheet("Confirm it is stolen", '<p class="muted small">' + (x ? "No. " + pad(x.number) : "The piece") + " is shown as stolen in the public registry, open transfers are cancelled, and the owner is emailed. You can clear it later.</p>" + goBtn("Confirm and flag it", "warn"));
  else if(d === "dismiss") sheet("Dismiss the report", '<p class="muted small">Nothing changes on the piece, and nobody is emailed.</p>' + goBtn("Dismiss", "warn"));
  else if(d === "clear") sheet("Clear the flag", '<p class="muted small">The piece reads as sold again, transfers are allowed, and the owner is emailed.</p>' + goBtn("Clear it"));
  else if(d === "verify"){ var guess = x && /^Contact: (\S+)/.exec(x.description || "");
    sheet("Verify and move their sign-in", '<p class="muted small">Check the order record, a caseback photograph and the letter first. Then their sign-in moves to the address below, every earlier sign-in closes, and the new address is emailed.</p><label for="d_email">The address their sign-in moves to</label><input id="d_email" type="email" value="' + esc(guess ? guess[1] : "") + '">' + goBtn("Verify and move it")); }
  else sheet("Close this", '<label for="d_note">A note (optional)</label><input id="d_note">' + goBtn("Close it"));
}
function shortcuts(){ sheet("Shortcuts", '<div class="card tight"><table>' + KEYS.map(function(v, i){ return '<tr><td class="num">' + (i + 1) + "</td><td>" + titleOf(v) + "</td></tr>"; }).join("") +
  '<tr><td class="num">/</td><td>Search (visitors, owners)</td></tr><tr><td class="num">r</td><td>Refresh</td></tr><tr><td class="num">u</td><td>Undo a stage before it sends</td></tr><tr><td class="num">Esc</td><td>Close, or undo</td></tr></table></div>'); }

/* ══ every tap ══ */
document.addEventListener("click", function(e){
  var el = e.target.closest ? e.target.closest("[data-act],[data-go]") : null;
  if(!el) return;
  if(el.hasAttribute("data-go")){
    e.preventDefault(); closeSheet();
    var p = {}; (el.getAttribute("data-p") || "").split("&").forEach(function(kv){ var x = kv.split("="); if(x[0]) p[x[0]] = x[1] || ""; });
    go(el.getAttribute("data-go"), p); return;
  }
  var a = el.getAttribute("data-act"), id = +el.getAttribute("data-id") || el.getAttribute("data-id");
  if(a === "close") closeSheet();
  else if(a === "refresh"){ load(); live(); }
  else if(a === "more") moreSheet();
  else if(a === "signout") api("POST", "/auth/logout", {}).then(function(){ closeSheet(); gate("pass"); });
  else if(a === "undo") undo();
  else if(a === "copy") copy(el.getAttribute("data-text").replace(/&amp;/g, "&"));
  else if(a === "visitor"){ e.preventDefault(); openVisitor(+el.getAttribute("data-k")); }
  else if(a === "vset"){ var vp = copyParams(); vp[el.getAttribute("data-k")] = el.getAttribute("data-v"); if(el.getAttribute("data-k") === "f") vp.sort = ""; go("visitors", vp); }
  else if(a === "vmore"){ el.disabled = true; api("GET", "/desk/visitors?" + vparams(VROWS.length)).then(function(j){ VROWS = VROWS.concat(j.rows || []); $("view").innerHTML = RENDER.visitors(j); AFTER.visitors(); }); }
  else if(a === "iset") go("insights", { r: el.getAttribute("data-v") });
  else if(a === "tset"){ var tv = el.getAttribute("data-v"); try{ localStorage.setItem("kaal_tp", tv); }catch(e){} go("today", { r: tv }); }
  else if(a === "forget"){ var fk = +el.getAttribute("data-k"); if(!confirm("Delete everything kept about Visitor " + fk + "? Their history, and their name and contact on it, go for good.")) return;
    api("POST", "/desk/forget", { k: fk }).then(function(j){ if(j.ok){ closeSheet(); say("Visitor " + fk + " deleted"); load(); } else say("Not deleted.", true); }); }
  else if(a === "release"){ var rn = +el.getAttribute("data-n"), what = el.getAttribute("data-v");
    if(what === "sell" && !confirm("Put No. " + pad(rn) + " back on sale? Anyone can buy it on thekaal.co within a minute.")) return;
    el.disabled = true; api("POST", "/desk/release", { n: rn, action: what }).then(function(j){ say(j.ok ? (what === "sell" ? "No. " + pad(rn) + " is back on sale" : "No. " + pad(rn) + " stays retired") : "Not changed (" + (j.reason || j._status) + ")", !j.ok); load(); }); }
  else if(a === "stop"){ var se = el.getAttribute("data-email"), un = el.getAttribute("data-v") === "undo";
    if(!un && !confirm("Stop every email the shop sends on its own to " + se + "? Order emails still go if they buy.")) return;
    el.disabled = true; api("POST", "/desk/stop", { email: se, undo: un }).then(function(j){ say(j.ok ? (un ? "Emails to " + se + " can go again" : "No more emails to " + se) : "Not changed.", !j.ok); load(); }); }
  else if(a === "next") nextStage(id, el.getAttribute("data-to"));
  else if(a === "preview") frame("/control/preview?t=" + encodeURIComponent(el.getAttribute("data-to")) + "&o=" + id);
  else if(a === "previewD") frame("/control/preview?t=dispatched&o=" + id + "&courier=" + encodeURIComponent($("cr").value) + "&tracking=" + encodeURIComponent($("tn").value) + "&url=" + encodeURIComponent($("tu").value));
  else if(a === "dispatchGo"){ var cr = $("cr").value, tn = $("tn").value.trim(), tu = $("tu").value.trim();
    if(!tn || !/^https:\/\/\S+$/.test(tu)){ $("sheetErr").textContent = "The tracking number, and a tracking link that starts with https://."; return; }
    closeSheet(); hold(id, { to:"dispatched", courier:cr, tracking:tn, url:tu }, "No. " + pad(order(id).number) + " marked Dispatched. The email goes in"); }
  else if(a === "deliverGo"){ var dd = $("dd").value; if(!dd){ $("sheetErr").textContent = "Choose the day it was delivered."; return; } closeSheet(); hold(id, { to:"delivered", day:dd }, "No. " + pad(order(id).number) + " marked Delivered on " + dd + ". Saving in"); }
  else if(a === "correct"){ var o = order(id);
    sheet("Change No. " + pad(o.number) + " without email", '<label for="cs">Status</label><select id="cs">' + ["placed","inspected","packed","dispatched","delivered","registered","returned","cancelled"].map(function(s){ return "<option" + (s === o.status ? " selected" : "") + ">" + s + "</option>"; }).join("") + "</select>" +
      '<label for="cd">Delivered on (only when changing to delivered)</label><input id="cd" type="date" value="' + esc(o.delivered_on || DATA.orders.today) + '" max="' + esc(DATA.orders.today) + '">' +
      '<label for="cw">Reason (logged)</label><input id="cw"><p class="note">For corrections. No email is sent.</p><p class="err" id="sheetErr"></p><button class="btn go" style="margin-top:12px" data-act="correctGo" data-id="' + id + '">Change</button>'); }
  else if(a === "correctGo"){ var w = $("cw").value.trim(); if(w.length < 3){ $("sheetErr").textContent = "Say why, in a few words."; return; }
    var to = $("cs").value, pay = { to:to, silent:true, reason:w }; if(to === "delivered") pay.day = $("cd").value; closeSheet(); hold(id, pay, "Changing to " + to + ", no email. Saving in"); }
  else if(a === "import"){ el.disabled = true; say("Asking Razorpay. This takes a few seconds.");
    api("POST", "/control/api/import", {}).then(function(j){ say(j.ok ? "Brought in: " + (j.imported || []).length + " new, " + (j.already || []).length + " already here." : "Razorpay did not answer. Try again in a minute.", !j.ok); load(); }); }
  else if(a === "pastSale"){
    sheet("Record a past sale", '<p class="muted small">For a watch sold before this registry. No email is sent. It cannot be refunded from here.</p>' +
      '<label for="ms">Number</label><input id="ms" inputmode="numeric" placeholder="01">' +
      '<label for="mn">Buyer name</label><input id="mn" autocomplete="off"><label for="me">Buyer email (how they will sign in to the registry)</label><input id="me" type="email" autocomplete="off">' +
      '<label for="mp">Phone</label><input id="mp" inputmode="tel" autocomplete="off"><label for="ma">Address</label><input id="ma" autocomplete="off">' +
      '<div class="grid g2"><div><label for="mc">City</label><input id="mc"></div><div><label for="mt">State</label><input id="mt"></div></div><label for="mz">PIN</label><input id="mz" inputmode="numeric" maxlength="6">' +
      '<div class="grid g2"><div><label for="mpd">Paid on</label><input id="mpd" type="date" max="' + esc((DATA.orders || {}).today || "") + '"></div><div><label for="mdd">Delivered on (if it has arrived)</label><input id="mdd" type="date" max="' + esc((DATA.orders || {}).today || "") + '"></div></div>' +
      '<label for="mr">Amount paid, rupees (leave empty for the series price)</label><input id="mr" inputmode="decimal">' +
      '<p class="err" id="sheetErr"></p><button class="btn go" style="margin-top:12px" data-act="pastSaleGo">Record it</button>'); }
  else if(a === "pastSaleGo") api("POST", "/control/api/orders/manual", { n:$("ms").value, name:$("mn").value, email:$("me").value, phone:$("mp").value, line1:$("ma").value, city:$("mc").value, state:$("mt").value,
      pin:$("mz").value, paid_on:$("mpd").value, delivered_on:$("mdd").value, amount_rupees:$("mr").value }).then(function(j){ if(j.ok){ closeSheet(); say("Recorded."); load(); } else $("sheetErr").textContent = j.why || "Not recorded."; });
  else if(a === "link"){ var mode = el.getAttribute("data-mode"), o2 = order(id);
    if(mode === "regenerate" && !confirm("Cancel every earlier registration link for No. " + pad(o2.number) + " and email a new one to " + (o2.email || "the buyer") + "?")) return;
    api("POST", "/control/api/orders/" + id + "/link", { mode:mode }).then(function(j){ say(j.ok ? "A registration link is on its way to " + j.to + "." : (j.why || "Not sent."), !j.ok); load(); }); }
  else if(a === "returned"){ var rr = prompt("Mark No. " + pad(order(id).number) + " returned? The buyer will never be sold to again. Reason:"); if(rr === null) return;
    api("POST", "/control/api/orders/" + id + "/returned", { reason:rr }).then(function(j){ say(j.ok ? "Marked returned. Refund it next if you have not." : (j.why || "Not changed."), !j.ok); load(); }); }
  else if(a === "refund"){ var nn = el.getAttribute("data-n"), cc = prompt("Refund the full amount through Razorpay? This cannot be undone. Type " + nn + " to confirm."); if(cc === null) return;
    api("POST", "/control/api/orders/" + id + "/refund", { confirm:cc, reason: order(id).status === "returned" ? "return" : "cancel" }).then(function(j){ say(j.ok ? "Refunded: " + j.refund : (j.why || "Not refunded."), !j.ok); load(); }); }
  else if(a === "piece") pieceSheet(el.getAttribute("data-id"));
  else if(a === "sale"){ var sn = +el.getAttribute("data-n"), son = el.getAttribute("data-v") === "1";
    if(!son && !confirm("Keep No. " + pad(sn) + " back? The shop will show it as gone and nobody can buy it.")) return;
    if(son && el.getAttribute("data-sure") && !confirm("Put No. " + pad(sn) + " on sale? Only if nobody has bought it: anyone can buy it the moment it shows.")) return;
    saleGo(sn, son, son ? "put on sale from the command centre" : "kept back from the command centre"); }
  else if(a === "cmd") cmdSheet();
  else if(a === "fuMode") api("POST", "/control/api/followups/mode", { mode: el.getAttribute("data-v") }).then(function(j){ say(j.ok ? "Saved." : (j.why || "Not saved."), !j.ok); load(); });
  else if(a === "fuSample"){ el.disabled = true; el.textContent = "Writing\u2026";
    api("POST", "/control/api/followups/sample", {}).then(function(j){ el.disabled = false; el.textContent = "Write a sample now";
      if(!j.draft && !j.standard){ say(j.why || "Could not write one just now.", true); return; }
      sheet("A sample, for " + (j.for || "a recent checkout"), (j.ok ? '<p class="note" style="margin-top:0">' + esc(j.draft.angle.replace("_", " ")) + ": " + esc(j.draft.why) + '</p><div class="card" style="white-space:pre-wrap;font-size:15px;line-height:1.6">' + esc(j.claude) + "</div>"
        : '<p class="err">' + esc(j.why) + "</p>") + "<h2>The standard note, for comparison</h2>" + '<div class="card" style="white-space:pre-wrap;font-size:14px;line-height:1.6;color:var(--mute)">' + esc(j.standard) + "</div>"); }); }
  else if(a === "fuSend"){ var fid = el.getAttribute("data-id"); if(!confirm("Send this note now?")) return;
    api("POST", "/control/api/followups/" + fid + "/send", { subject: $("fs_" + fid).value, body: $("fb_" + fid).value }).then(function(j){ say(j.ok ? "Sent." : (j.why || "Not sent."), !j.ok); load(); }); }
  else if(a === "fuSkip"){ var sid = el.getAttribute("data-id"); if(!confirm("Skip? This person will never get the note.")) return;
    api("POST", "/control/api/followups/" + sid + "/skip", {}).then(function(j){ say(j.ok ? "Skipped." : (j.why || "Not changed."), !j.ok); load(); }); }
  else if(a === "fuOpen"){ var x = DATA.fu.log[+el.getAttribute("data-i")]; sheet(x.subject || "Follow-up", '<p class="muted small" style="margin-top:0">' + esc(when(x.at)) + " \u00b7 " + esc(x.email || "") + " \u00b7 " + esc(x.how || "") + "</p>" + (x.why ? '<p class="note">' + esc(x.why) + "</p>" : "") + '<div class="card" style="white-space:pre-wrap;font-size:15px;line-height:1.6">' + esc(x.text || "") + "</div>"); }
  else if(a === "cmdEx"){ $("cmdIn").value = el.textContent; cmdRun(); }
  else if(a === "cmdGo") cmdDo();
  else if(a === "pushOn") pushOn();
  else if(a === "pushOff") pushOff(el.getAttribute("data-e"));
  else if(a === "pushTest") api("POST", "/control/api/push/test", {}).then(function(j){ say(j.ok ? "Sent to " + plural(j.sent, "device") + ". It should arrive in a few seconds." : (j.why || "Not sent."), !j.ok); });
  else if(a === "photo"){ var f = $("ph").files[0]; if(!f){ $("sheetErr").textContent = "Choose a photograph first."; return; }
    api("POST", "/control/api/pieces/" + el.getAttribute("data-id") + "/photo", undefined, f).then(function(j){ if(j.ok){ closeSheet(); say("Photograph saved."); load(); } else $("sheetErr").textContent = j.why || "Not saved."; }); }
  else if(a === "pieceSave"){ var pid = el.getAttribute("data-id"), p0 = DATA.pieces.pieces.filter(function(x){ return x.id === pid; })[0], b = { colorway:$("pc").value, notes:$("pn").value };
    if($("ps").value !== p0.status){ b.status = $("ps").value; b.reason = $("pr").value; }
    api("POST", "/control/api/pieces/" + pid, b).then(function(j){ if(j.ok){ closeSheet(); say("Saved."); load(); } else $("sheetErr").textContent = j.why || "Not saved."; }); }
  else if(a === "owner") ownerSheet(id);
  else if(a === "ownerSave") api("POST", "/control/api/owners/" + id, { name:$("on").value, email:$("oe").value, phone:$("op").value, city:$("oc").value, state:$("os").value }).then(function(j){ if(j.ok){ closeSheet(); say("Saved."); load(); } else $("sheetErr").textContent = j.why || "Not saved."; });
  else if(a === "revoke"){ if(!confirm("Sign this owner out on every device?")) return; api("POST", "/control/api/owners/" + id + "/revoke", {}).then(function(j){ say(j.ok ? "Signed out on " + plural(j.revoked, "device") + "." : "Not changed.", !j.ok); }); }
  else if(a === "revokeAll"){ if(!confirm("Sign out of the command centre on every device, this one included? You will need the passcode again.")) return;
    api("POST", "/control/api/sessions/revoke", {}).then(function(j){ if(j.ok) gate("pass", "Signed out on " + plural(j.revoked, "device") + ". Open it again with your passcode."); else say("Not changed.", true); }); }
  else if(a === "tpl") frame("/control/preview?t=" + encodeURIComponent(el.getAttribute("data-t")));
  else if(a === "test") api("POST", "/control/api/emails/test", { template: el.getAttribute("data-t") }).then(function(j){ say(j.ok ? "A test is on its way to " + j.to + "." : "Not sent.", !j.ok); setTimeout(load, 1500); });
  else if(a === "retry") api("POST", "/control/api/emails/" + id + "/retry", {}).then(function(j){ say(j.ok ? "Queued again." : "Not queued.", !j.ok); setTimeout(load, 1500); });
  else if(a === "saveSettings") api("POST", "/control/api/settings", { settings:{ stage_emails: $("s1").checked ? "1" : "0", transfers_need_approval: $("s2").checked ? "1" : "0", sender_name: $("s3").value, warranty_terms: $("s4").value, guide_video_url: $("s7").value.trim() },
    series:{ code: el.getAttribute("data-code"), return_days: $("s5").value, warranty_months: $("s6").value } }).then(function(j){ if(j.ok){ say(j.changed.length ? "Saved." : "Nothing changed."); load(); } else $("setErr").textContent = j.why || "Not saved."; });
  else if(a === "decide") decideSheet(el.getAttribute("data-kind"), id, el.getAttribute("data-do"));
  else if(a === "decideGo"){ var bd = { action: el.getAttribute("data-do") };
    ["pickup","message","reason","work_done","public_line","date","courier","tracking","email","note"].forEach(function(k){ var nd = $("d_" + k); if(nd) bd[k] = nd.value; });
    api("POST", "/control/api/" + (el.getAttribute("data-kind") === "tr" ? "transfers" : "requests") + "/" + id + "/decide", bd).then(function(j){ if(j.ok){ closeSheet(); say("Done. The owner has been emailed where it applies."); load(); } else $("sheetErr").textContent = j.why || "Not changed."; }); }
  else if(a === "block") api("POST", "/control/api/blocked", { email:$("b1").value, phone:$("b2").value, reason:$("b3").value }).then(function(j){ if(j.ok){ say("Blocked."); load(); } else $("blkErr").textContent = j.why || "Not saved."; });
  else if(a === "unblock"){ if(!confirm("Remove this block?")) return; api("POST", "/control/api/blocked", { remove:id }).then(function(){ load(); }); }
});
$("sheet").addEventListener("click", function(e){ if(e.target === $("sheet")) closeSheet(); });
document.addEventListener("keydown", function(e){
  var typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || "");
  if(e.key === "Escape"){ if(!$("sheet").hidden) closeSheet(); else undo(); return; }
  if(SIGNED && (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")){ e.preventDefault(); cmdSheet(); return; }
  if(typing && e.key === "Enter" && e.target && e.target.id === "cmdIn"){ e.preventDefault(); if(CMD) cmdDo(); else cmdRun(); return; }
  if(typing || !SIGNED || e.metaKey || e.ctrlKey || e.altKey) return;
  var v = KEYS[+e.key - 1];
  if(v){ go(v); return; }
  if(e.key === "u") undo();
  else if(e.key === "r"){ load(); live(); }
  else if(e.key === "?") shortcuts();
  else if(e.key === "k"){ e.preventDefault(); cmdSheet(); }
  else if(e.key === "/"){ var q = $("vq") || $("oq"); if(q){ e.preventDefault(); q.focus(); } else { e.preventDefault(); go("visitors", { f:"all" }); } }
});

/* ══ first question: am I signed in? ══ */
api("POST", "/auth/me", {}).then(function(j){
  if(j.ok && j.role === "admin" && j.mfa) start();
  else if(j.ok && j.role === "admin") gate(j.enrolled ? "totp" : "enroll");
  else gate("pass");
});
})();
</script>
</body></html>`;
}
