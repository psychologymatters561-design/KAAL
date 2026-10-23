# Vendored, on purpose

`qrcode-generator.cjs` is Kazuhiko Arase's "QR Code Generator for JavaScript"
(MIT, copyright 2009; the licence is in the file's own header), version 1.4.4,
unchanged. It is used only by `tools/make-letters.mjs`, on the owner's own
machine or a build machine, to draw the QR code on each Letter of Provenance.
It is never shipped to the site or the worker.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
