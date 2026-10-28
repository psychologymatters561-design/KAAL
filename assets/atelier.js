/* ══════════════════════════════════════════════════════════════════
   The room around the owners' pages.

   Two quiet things, and nothing else moves unless a state changed:
   dust drifting in a warm light (one fixed layer behind everything, at a
   whisper, paused when the tab is hidden), and each part of a page
   arriving once as it comes into view. Anyone who asked their device for
   less motion gets neither: the page is simply there.
   ══════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var root = document.documentElement;
  root.classList.add("js");
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var K = window.KAALO || (window.KAALO = {});

  /* Arrivals: anything marked .rv rises into place the first time it is seen. */
  var io = !reduce && "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -6% 0px", threshold: 0.06 }) : null;
  K.reveal = function (scope) {
    var list = (scope || document).querySelectorAll(".rv:not(.in)");
    for (var i = 0; i < list.length; i++) {
      list[i].style.setProperty("--d", (i % 6) * 80 + "ms");
      if (io) io.observe(list[i]); else list[i].classList.add("in");
    }
  };
  if (document.readyState !== "loading") K.reveal(); else document.addEventListener("DOMContentLoaded", function () { K.reveal(); });

  /* Dust in the light. Thirty motes, each under two pixels, never brighter
     than a fifth; they rise a little and sway, the way it does in a beam. */
  if (reduce || !window.requestAnimationFrame) return;
  var c = document.createElement("canvas"), x = c.getContext && c.getContext("2d");
  if (!x) return;
  c.className = "dust"; c.setAttribute("aria-hidden", "true");
  (document.body || root).insertBefore(c, (document.body || root).firstChild);
  var W = 0, H = 0, R = 1, motes = [], raf = 0, last = 0;
  function size() {
    R = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
    c.width = Math.round(W * R); c.height = Math.round(H * R); x.setTransform(R, 0, 0, R, 0, 0);
  }
  function mote(fresh) {
    return { x: Math.random() * W, y: fresh ? H + 10 : Math.random() * H, r: 0.5 + Math.random() * 1.2, a: 0.04 + Math.random() * 0.16,
      v: 4 + Math.random() * 9, s: Math.random() * Math.PI * 2, w: 0.2 + Math.random() * 0.5 };
  }
  size();
  for (var i = 0; i < 30; i++) motes.push(mote(false));
  function frame(t) {
    raf = requestAnimationFrame(frame);
    var dt = Math.min(0.05, (t - (last || t)) / 1000); last = t;
    x.clearRect(0, 0, W, H);
    for (var i = 0; i < motes.length; i++) {
      var m = motes[i];
      m.y -= m.v * dt; m.s += m.w * dt; m.x += Math.sin(m.s) * 6 * dt;
      if (m.y < -10) motes[i] = m = mote(true);
      /* Brighter near the top, where the light falls. */
      var lit = m.a * (0.45 + 0.55 * (1 - m.y / H));
      x.beginPath(); x.arc(m.x, m.y, m.r, 0, 6.2832);
      x.fillStyle = "rgba(224,190,124," + lit.toFixed(3) + ")"; x.fill();
    }
  }
  raf = requestAnimationFrame(frame);
  window.addEventListener("resize", size, { passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  });
})();
