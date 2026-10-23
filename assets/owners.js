/* ══════════════════════════════════════════════════════════════════
   Shared by the owners' pages (track, claim, owners, registry).

   Everything the pages show is put on the page as text, never as
   markup, so nothing a server sends can become script. The worker's
   address is the one in the shop's own config (index.html, KAAL.api);
   tools/check.mjs fails the build if the two ever disagree.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var API = "https://kaal-edition.kaal-edition-hq.workers.dev";
  var K = (window.KAALO = {});
  K.API = API;

  /* A call to the worker. Resolves to the parsed answer with _status added;
     a network failure resolves to { ok:false, reason:"network" }. The
     owner's session, when there is one, rides as a bearer token. */
  K.token = function (v) {
    try { if (v === undefined) return window.localStorage.getItem("kaal_o") || ""; if (v) window.localStorage.setItem("kaal_o", v); else window.localStorage.removeItem("kaal_o"); } catch (e) { /* a private window: signed in for this page only */ K._t = v === undefined ? K._t || "" : v; return K._t || ""; }
    return "";
  };
  K.api = function (method, path, body, opts) {
    var h = { "X-KAAL": "1" };
    if (body !== undefined && !(body instanceof Blob)) h["Content-Type"] = "application/json";
    var t = (opts && opts.token === false) ? "" : K.token();
    if (t) h.Authorization = "Bearer " + t;
    var init = { method: method, headers: h, mode: "cors", cache: "no-store" };
    if (body instanceof Blob) { init.body = body; h["Content-Type"] = body.type || "application/octet-stream"; } else if (body !== undefined) init.body = JSON.stringify(body);
    return fetch(API + path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { j._status = r.status; return j; });
    }, function () { return { ok: false, reason: "network", _status: 0 }; });
  };

  K.el = function (tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined && text !== null) e.textContent = text; return e; };
  K.$ = function (id) { return document.getElementById(id); };
  K.clear = function (n) { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  K.pad = function (n) { return n < 10 ? "0" + n : String(n); };
  K.roman = function (n) {
    var r = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]], o = "", x = Math.max(1, n | 0);
    r.forEach(function (p) { while (x >= p[0]) { o += p[1]; x -= p[0]; } });
    return o;
  };
  var IST = { timeZone: "Asia/Kolkata" };
  K.day = function (iso) {   /* 23 Oct 2026 */
    if (!iso) return "";
    var d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00+05:30") : new Date(iso);
    return isNaN(d) ? "" : new Intl.DateTimeFormat("en-GB", Object.assign({ day: "numeric", month: "short", year: "numeric" }, IST)).format(d);
  };
  K.time = function (iso) {  /* 11:43 am */
    var d = new Date(iso);
    return isNaN(d) ? "" : new Intl.DateTimeFormat("en-GB", Object.assign({ hour: "numeric", minute: "2-digit", hour12: true }, IST)).format(d).replace(/\s?([ap]m)/i, " $1").toLowerCase();
  };
  K.stamp = function (iso) { return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? K.day(iso) : K.day(iso) + ", " + K.time(iso) + " IST"; };
  K.params = function () { var o = {}; new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); return o; };

  /* The caseback plate, for a piece with no photograph yet. */
  K.plate = function (n) { var p = K.el("div", "plate"); p.setAttribute("role", "img"); p.setAttribute("aria-label", "Caseback engraved Limited edition No. " + K.pad(n)); p.appendChild(K.el("span", "", "LIMITED\nEDITION\nNO. " + K.pad(n))); return p; };
  /* The piece's face: its own photograph if there is one, else the plate. */
  K.face = function (piece) {
    if (piece && piece.photo && /^https:\/\//.test(piece.photo)) { var i = K.el("img", "photo"); i.src = piece.photo; i.alt = "No. " + K.pad(piece.n) + ", photographed"; i.width = 352; i.height = 352; return i; }
    return K.plate(piece ? piece.n : 0);
  };
  K.why = { network: "We could not reach KAAL just now. Check your connection and try again.", rate: "Too many tries from here. Please wait a few minutes.", error: "Something failed on our side. Nothing was changed; please try again." };
})();
