/* /registry: the twenty, read live from the worker's public view. A page
   that is open updates itself each minute; nothing here is deployed when a
   piece sells. Text only: nothing the server sends can become markup. */
(function () {
  "use strict";
  var K = window.KAALO, $ = K.$, DATA = null, SEL = 0, timer = 0, MINE = null;
  var LABEL = { available: "Available", held: "Being claimed", sold: "Sold", stolen: "Stolen", unavailable: "Not offered", retired: "Retired" };

  function ownerLine(p) {
    if (p.state === "sold" && !p.owner) return "Sold";
    if (p.owner) return "Owner " + K.roman(p.owner.no);
    return LABEL[p.state] || "";
  }

  function grid() {
    var g = K.clear($("grid"));
    DATA.pieces.forEach(function (p) {
      var li = K.el("li"), b = K.el("button", p.state); b.type = "button"; b.setAttribute("aria-pressed", p.n === SEL ? "true" : "false");
      b.appendChild(K.el("b", "", K.pad(p.n)));
      b.appendChild(K.el("small", "", p.state === "sold" ? ownerLine(p) : LABEL[p.state] || ""));
      b.setAttribute("aria-label", "No. " + K.pad(p.n) + ", " + p.colorway + ", " + (LABEL[p.state] || p.state).toLowerCase() + (p.owner ? ", Owner " + K.roman(p.owner.no) : ""));
      b.addEventListener("click", function () { SEL = p.n; history.replaceState(null, "", "?n=" + K.pad(p.n)); grid(); panel(true); });
      li.appendChild(b); g.appendChild(li);
    });
  }

  function panel(focus) {
    var host = $("panel");
    var p = DATA.pieces.filter(function (x) { return x.n === SEL; })[0];
    if (!p) { host.hidden = true; return; }
    K.clear(host); host.hidden = false;
    var top = K.el("div", "piece");
    top.appendChild(K.face({ n: p.n, photo: p.photo }));
    var no = K.el("p", "no"); no.appendChild(document.createTextNode("No. " + K.pad(p.n) + " ")); no.appendChild(K.el("small", "", "of " + DATA.series.size)); top.appendChild(no);
    top.appendChild(K.el("p", "sub", DATA.series.name + " · " + p.colorway));
    host.appendChild(top);

    var dl = K.el("dl", "kv");
    function row(k, v) { var d = K.el("div"); d.appendChild(K.el("dt", "", k)); d.appendChild(K.el("dd", "", v)); dl.appendChild(d); }
    row("Status", LABEL[p.state] || p.state);
    if (p.owner) {
      row("Owner", "Owner " + K.roman(p.owner.no) + (p.owner.since ? " · since " + p.owner.since : ""));
      row("City", p.owner.city || "Owner’s city withheld");
    } else if (p.state === "sold") row("Owner", "Waiting to be registered");
    host.appendChild(dl);
    /* The QR code on the letter in the box lands here. If No. NN is with the
       person holding it, they can ask for their registration link: it goes
       only to the email on the order, and the answer never says whether the
       email matched. Kept across the minute's refresh, so typing survives. */
    if (p.state === "sold" && !p.owner) host.appendChild(mine(p.n));

    if (p.state === "stolen") host.appendChild(K.el("div", "banner bad", "This piece has been reported stolen. If you are offered it, please write to connect@thekaal.co before you buy."));
    if (p.state === "held") host.appendChild(K.el("p", "muted", "Somebody is paying for this number right now. If they do not finish, it returns to the twenty in a few minutes."));
    if (p.state === "available") {
      var a = K.el("a", "btn", "Choose No. " + K.pad(p.n)); a.href = "/"; host.appendChild(a);
    }
    if (p.service.length) {
      host.appendChild(K.el("h3", "", "Service"));
      var ul = K.el("ol", "chain");
      p.service.forEach(function (s) { var li = K.el("li"); li.appendChild(K.el("span", "who", s.line)); li.appendChild(K.el("span", "yr", K.day(s.date))); ul.appendChild(li); });
      host.appendChild(ul);
    }
    document.title = "KAAL · No. " + K.pad(p.n) + " · The registry";
    if (focus) host.focus({ preventScroll: false });
  }

  function mine(n) {
    if (MINE && MINE.n === n) return MINE.el;
    var f = K.el("form", "card mine"); f.noValidate = true;
    f.appendChild(K.el("h3", "", "Is No. " + K.pad(n) + " with you?"));
    f.appendChild(K.el("p", "muted", "Enter the email you ordered with. If it is No. " + K.pad(n) + "’s and the piece has been delivered, the link that writes your name beside it goes to that inbox."));
    var lb = K.el("label", "", "The email you ordered with"); lb.htmlFor = "mineEmail"; f.appendChild(lb);
    var inp = K.el("input"); inp.type = "email"; inp.id = "mineEmail"; inp.autocomplete = "email"; inp.inputMode = "email"; inp.required = true; f.appendChild(inp);
    var go = K.el("button", "btn", "Email me the link"); go.type = "submit"; go.id = "mineGo"; go.style.marginTop = "1rem"; f.appendChild(go);
    var msg = K.el("p", "okmsg"); msg.id = "mineMsg"; msg.setAttribute("role", "status"); f.appendChild(msg);
    f.addEventListener("submit", function (e) {
      e.preventDefault(); msg.className = "okmsg"; msg.textContent = "";
      var v = inp.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { msg.className = "err"; msg.textContent = "That does not look like an email address."; inp.focus(); return; }
      go.disabled = true;
      K.api("POST", "/track/email-link", { ref: K.pad(n), email: v }, { token: false }).then(function (r) {
        go.disabled = false;
        if (r && r.ok) { msg.textContent = "Thank you. If that is the email on No. " + K.pad(n) + "’s order, the link is on its way there now."; return; }
        msg.className = "err"; msg.textContent = r && r.reason === "rate" ? (K.why.rate || "Too many tries. Please wait a minute.") : "That did not go through. Please try again in a moment.";
      });
    });
    MINE = { n: n, el: f };
    return f;
  }

  function load(first) {
    K.api("GET", "/registry/data", undefined, { token: false }).then(function (j) {
      $("loading").hidden = true;
      if (!j.ok) { if (first) { $("loading").hidden = false; $("loading").textContent = "The registry could not be reached just now. Please try again in a moment."; } return; }
      DATA = j;
      $("retired").hidden = !j.series.retired; $("legend").hidden = false;
      var want = parseInt(K.params().n, 10);
      if (first && want >= 1 && want <= j.series.size) SEL = want;
      grid(); panel(false);
    });
  }
  load(true);
  timer = setInterval(function () { if (document.visibilityState === "visible") load(false); }, 60000);
})();
