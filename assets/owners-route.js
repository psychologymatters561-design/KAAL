/* The owners' pages are addressed the way the emails write them: thekaal.co/track,
   /claim, /owners, /registry and /claim/transfer, with no ".html". GitHub Pages
   serves those on its own; if it ever did not, this page (which it serves for any
   path it cannot find) sends the visitor on to the file, keeping the question mark
   and everything after it, so a link in an email never lands on "not here". */
(function () {
  var p = location.pathname.replace(/\/+$/, "");
  var to = { "/track": "/track.html", "/claim": "/claim.html", "/owners": "/owners.html", "/registry": "/registry.html", "/claim/transfer": "/claim/transfer.html" }[p];
  if (to) location.replace(to + location.search + location.hash);
})();
