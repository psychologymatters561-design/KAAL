/* ══════════════════════════════════════════════════════════════════
   WHO HOLDS IT. A number that has gone opens, on a tap, a small card about
   the piece and the person it belongs to now: their place in its line
   (Owner I, II…), since when, and, only if they said yes, their initials,
   masked (A•••• D••••) and their city. Everyone else is "a private
   collector". Never a name, an email, a phone or a street.

   It reads the public registry (the worker's /registry/data, the same
   safe view thekaal.co/registry reads), once, on the first tap. The sold
   cells stay exactly as they are (disabled, so they can never be bought);
   a quiet button laid over each one is what opens the card. Nothing here
   touches choosing a number or paying.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var grid = document.getElementById("grid");
  if (!grid || !window.fetch) return;
  var API = (window.KAAL && window.KAAL.api) || "https://kaal-edition.kaal-edition-hq.workers.dev";
  var REG = null, LOADING = null, CARD = null, FROM = null;
  var pad = function (n) { return n < 10 ? "0" + n : String(n); };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var ROMAN = [[10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  function roman(n) { var o = "", x = Math.max(1, n | 0); ROMAN.forEach(function (p) { while (x >= p[0]) { o += p[1]; x -= p[0]; } }); return o; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  var css = "#grid li{position:relative}" +
    ".whose{position:absolute;inset:0;width:100%;height:100%;background:transparent;border:0;padding:0;margin:0;cursor:pointer;border-radius:2px;-webkit-tap-highlight-color:transparent}" +
    ".whose:hover{box-shadow:inset 0 0 0 1px rgba(198,161,91,.45)}.whose:focus-visible{outline:2px solid var(--gold,#C6A15B);outline-offset:2px}" +
    ".oc{position:fixed;z-index:2147483001;text-decoration:none;width:min(19.5rem,calc(100vw - 2rem));background:linear-gradient(180deg,#14130f,#0d0e0c);color:var(--bone,#EDE8DF);" +
    "border:1px solid rgba(198,161,91,.32);border-radius:4px;padding:1.25rem 1.3rem 1.1rem;box-shadow:0 30px 70px -20px rgba(0,0,0,.9),0 0 0 1px rgba(0,0,0,.4);" +
    "opacity:0;transform:translate3d(0,10px,0) scale(.98);transform-origin:50% 100%;transition:opacity .32s cubic-bezier(.16,1,.3,1),transform .42s cubic-bezier(.16,1,.3,1)}" +
    ".oc.on{opacity:1;transform:none}" +
    ".oc .oc-e{font:400 .625rem/1.4 var(--body,system-ui);letter-spacing:.3em;text-transform:uppercase;color:var(--faint,#9D968A);margin:0 0 .7rem}" +
    ".oc .oc-h{font-family:var(--display,Georgia,serif);font-size:1.7rem;line-height:1.05;margin:0}" +
    ".oc .oc-h em{font-style:italic;color:var(--gold-lit,#E0BE7C)}" +
    ".oc p{text-decoration:none;border:0}.oc .oc-who{font-family:var(--display,Georgia,serif);font-size:1.15rem;letter-spacing:.08em;margin:.55rem 0 0;color:var(--bone,#EDE8DF)}" +
    ".oc .oc-who.priv{font-style:italic;letter-spacing:0;color:var(--mute,#B3AC9F)}" +
    ".oc .oc-m{font-size:.8125rem;color:var(--mute,#B3AC9F);margin:.35rem 0 0}" +
    ".oc .oc-ln{height:1px;background:linear-gradient(90deg,var(--gold,#C6A15B),rgba(198,161,91,0));margin:1rem 0 .8rem;transform:scaleX(0);transform-origin:0 50%;transition:transform .9s cubic-bezier(.16,1,.3,1) .12s}" +
    ".oc.on .oc-ln{transform:none}" +
    ".oc .oc-f{font-size:.75rem;letter-spacing:.04em;color:var(--faint,#9D968A);margin:0}" +
    ".oc .oc-x{position:absolute;top:.55rem;right:.55rem;width:2.4rem;height:2.4rem;border:0;background:none;color:var(--faint,#9D968A);font-size:1.15rem;cursor:pointer;border-radius:50%}" +
    ".oc .oc-x:hover{color:var(--bone,#EDE8DF)}" +
    ".oc-veil{position:fixed;inset:0;z-index:2147483000;background:rgba(8,9,8,.42);opacity:0;transition:opacity .3s ease}.oc-veil.on{opacity:1}" +
    "@media (max-width:560px){.oc{left:1rem!important;right:1rem;bottom:max(1rem,env(safe-area-inset-bottom));top:auto!important;width:auto;transform:translate3d(0,24px,0)}}" +
    "@media (prefers-reduced-motion:reduce){.oc,.oc .ln,.oc-veil{transition:none}}";
  var st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  /* A quiet button over every cell that has gone, kept in step with the grid. */
  function sync() {
    var cells = grid.querySelectorAll(".pick");
    for (var i = 0; i < cells.length; i++) {
      var b = cells[i], li = b.parentNode, o = li && li.querySelector(".whose");
      if (b.disabled && !o) {
        o = el("button", "whose"); o.type = "button"; o.setAttribute("data-n", b.getAttribute("data-n"));
        o.setAttribute("aria-label", "Who holds No. " + pad(+b.getAttribute("data-n")));
        o.setAttribute("aria-haspopup", "dialog");
        li.appendChild(o);
      } else if (!b.disabled && o) li.removeChild(o);
    }
  }
  sync();
  new MutationObserver(sync).observe(grid, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });

  function registry() {
    if (REG && Date.now() - REG.at < 60000) return Promise.resolve(REG.j);
    if (LOADING) return LOADING;
    LOADING = fetch(API + "/registry/data", { mode: "cors", credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { LOADING = null; if (j && j.ok) REG = { at: Date.now(), j: j }; return j; }, function () { LOADING = null; return null; });
    return LOADING;
  }
  function dialName(n) { var k = window.KAAL && KAAL.dials && KAAL.dials[n]; return k ? k.charAt(0).toUpperCase() + k.slice(1) : ""; }

  function close(back) {
    if (!CARD) return;
    var c = CARD.card, v = CARD.veil; CARD = null;
    c.classList.remove("on"); v.classList.remove("on");
    setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); if (v.parentNode) v.parentNode.removeChild(v); }, reduce ? 0 : 340);
    if (back !== false && FROM && FROM.focus) FROM.focus();
  }
  function open(btn) {
    close(false);
    FROM = btn;
    var n = +btn.getAttribute("data-n");
    var veil = el("div", "oc-veil"), card = el("div", "oc");
    card.setAttribute("role", "dialog"); card.setAttribute("aria-label", "No. " + pad(n)); card.tabIndex = -1;
    var x = el("button", "oc-x", "×"); x.type = "button"; x.setAttribute("aria-label", "Close");
    card.appendChild(x);
    card.appendChild(el("p", "oc-e", "No. " + pad(n) + (dialName(n) ? " · " + dialName(n) : "")));
    var body = el("div"); body.appendChild(el("p", "oc-m", "One moment.")); card.appendChild(body);
    document.body.appendChild(veil); document.body.appendChild(card);
    place(card, btn);
    CARD = { card: card, veil: veil };
    requestAnimationFrame(function () { veil.classList.add("on"); card.classList.add("on"); });
    x.addEventListener("click", function () { close(); });
    veil.addEventListener("click", function () { close(); });
    card.focus();
    registry().then(function (j) {
      if (!CARD || CARD.card !== card) return;
      while (body.firstChild) body.removeChild(body.firstChild);
      var p = j && j.pieces ? j.pieces.filter(function (q) { return q.n === n; })[0] : null;
      fill(body, p, n);
      place(card, btn);
    });
  }
  function fill(body, p, n) {
    var h = el("p", "oc-h"), w, m = [];
    if (!p) { h.textContent = "Placed"; body.appendChild(h); body.appendChild(el("p", "oc-m", "It belongs to somebody now.")); }
    else if (p.state === "stolen") { h.textContent = "Reported stolen"; body.appendChild(h); body.appendChild(el("p", "oc-m", "If it is offered to you, write to connect@thekaal.co.")); }
    else if (p.state !== "sold") { h.textContent = "Not offered"; body.appendChild(h); body.appendChild(el("p", "oc-m", "Held back by KAAL for now.")); }
    else if (!p.owner) { h.textContent = "Placed"; body.appendChild(h); body.appendChild(el("p", "oc-m", "On its way to its first owner.")); }
    else {
      h.appendChild(document.createTextNode("Held by ")); h.appendChild(el("em", "", "Owner " + roman(p.owner.no)));
      body.appendChild(h);
      w = p.owner.initials ? el("p", "oc-who", p.owner.initials) : el("p", "oc-who priv", "A private collector");
      body.appendChild(w);
      if (p.owner.since) m.push("Since " + p.owner.since);
      if (p.owner.city) m.push(p.owner.city);
      if (m.length) body.appendChild(el("p", "oc-m", m.join(" · ")));
    }
    body.appendChild(el("div", "oc-ln"));
    body.appendChild(el("p", "oc-f", "One of twenty. Never remade."));
  }
  /* Above the cell on a wide screen, centred on it and kept on screen; a sheet from the bottom on a phone. */
  function place(card, btn) {
    if (window.innerWidth <= 560) return;
    var r = btn.getBoundingClientRect(), cw = card.offsetWidth, ch = card.offsetHeight;
    var left = Math.max(16, Math.min(window.innerWidth - cw - 16, r.left + r.width / 2 - cw / 2));
    var top = r.top - ch - 12;
    if (top < 16) { top = r.bottom + 12; card.style.transformOrigin = "50% 0"; }
    card.style.left = left + "px"; card.style.top = top + "px";
  }

  grid.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".whose");
    if (!b) return;
    e.preventDefault();
    open(b);
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && CARD) close(); });
  window.addEventListener("scroll", function () { if (CARD && window.innerWidth > 560) close(false); }, { passive: true });
  window.addEventListener("resize", function () { if (CARD) close(false); });
})();
