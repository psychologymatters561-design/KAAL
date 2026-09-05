# Drop your files here

Upload straight into this folder on github.com (Add file → Upload files →
Commit). I read the repo, so anything landing here reaches me on my next fetch.

## 1. The product photos

Any filenames, any format (jpg, png, heic, webp). Put them in
`incoming/photos/`. I will crop, resize, convert to WebP at four widths and
wire them into the page. Tell me which watch is the hero.

## 2. The scroll sequence

This is the frame by frame scrub you asked for. Put a set of stills of the SAME
watch in `incoming/seq/`, shot as a turntable or a slow pan.

- 24 to 48 frames is the sweet spot. Fewer than 24 stutters, more than 48 costs
  loading time and nobody sees the difference.
- The watch should stay in the same place in frame. Only the rotation, the
  light, or the camera moves.
- Name them so they sort in order: `01.jpg`, `02.jpg` ... or `frame-01.jpg`.
  Anything that sorts correctly is fine, I will renumber.
- Shoot them at 1600px on the long edge or larger. I compress from there.

The engine is already built and tested. It preloads every frame behind a
loading ring, draws to a canvas, plays forward as the visitor scrolls down and
backward as they scroll up, eases so a fast flick glides instead of snapping,
loads every second frame on phones to halve the bytes, and falls back to a
designed still if anything at all goes wrong. It switches on the moment
`sequence.count` in index.html is set to the number of frames you upload.

## 3. The spec sheet

Nothing goes back on the page without this, in your words:

- Movement (quartz, and which calibre if you know it)
- Battery life
- Case size in mm, and case material
- Crystal (mineral, sapphire, acrylic)
- Water resistance, if any
- Warranty terms
- What is actually in the box

Write it in `incoming/specs.md`, or just type it in chat. Either works.
