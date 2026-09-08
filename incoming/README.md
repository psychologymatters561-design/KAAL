# Drop your files here

Upload straight into this folder on github.com (Add file → Upload files →
Commit). Anything landing here reaches me on the next fetch.

## 1. Photographs of the actual watches

`incoming/photos/`. Any filenames, any format. I will crop, resize, convert to
WebP at four widths and wire them in.

This is the one real bottleneck. The site currently carries no product
photograph because the images that were here before were AI generated and did
not depict your watches — see `assets/_unverified/README.md`. A phone on a
windowsill beats a generated image every time, because it is true.

What the page has a place for, in priority order:

1. **The hero.** One watch, isolated, plain background. Green reads best
   against the black page and it opens the numbering at 01.
2. **The four dials, matched.** Same angle, same distance, same light, one
   after another without moving the camera. If the framing drifts the set
   stops reading as one case with four faces, which is the whole claim.
3. **The caseback, closed.** Macro, square on.
4. **The engraving.** `LIMITED EDITION NO. XX` on a real numbered piece, close
   enough to read.
5. **The box.** Closed, with the tag catching light.

Shoot at 1600px on the long edge or larger. Window light, no flash. Tell me
which watch is the hero.

## 2. The scroll sequence, only if you want it

`incoming/seq/`. 24 to 48 stills of the *same* watch, turntable or slow pan,
the watch staying put in frame while the rotation or the light moves. Name them
so they sort: `01.jpg`, `02.jpg`.

Optional. The camera move works without it.

## 3. Generated imagery, if you go that route

You have decided to use generated product imagery. Fine — it is your brand and
your call. The method matters enormously, so here is the one that does not
repeat the last failure.

The old set died on invented text: day rings reading `THON TUE TRU SAT`, dials
carrying a wordmark the generator hallucinated. The fix is to never let the
generator write anything.

- Prompt every dial, caseback and box tag **blank**. No text, no numerals, no
  logo, no date window. Just material, form and light.
- Composite the real type afterward in Fraunces and Inter — the wordmark, the
  `NO. XX`, the `SERIES 01`. Real fonts, correct spelling, every time.
- Keep the physical spec honest: two-tone steel and gold bracelet, one case
  across four dials, quartz. Never a gear train, never an exposed movement,
  never water.

The line that still cannot be crossed: whatever a buyer sees before paying has
to match what arrives in the box. A dramatic, dark, partial rendering of your
actual design is defensible. A dial with markings your watches do not have is
not, and that is a refund and a public post from someone who is five percent of
your customer base.

Drop generated files in `incoming/photos/` like any other image and say which
is the hero.

## 4. What stays off the page regardless

Do not send me a spec sheet to publish. The following stay off as a standing
rule, not a preference:

- **Water resistance.** No claim, in any wording, ever. There is no warranty
  behind it and the phrasing invites someone to test it.
- **The movement supplier or calibre number.** The brand describes what the
  piece does, never whose component is inside it.
- **Anything mechanical.** It is quartz. No gear trains, no escapements, no
  exposed movement theatrics.

If you want to correct or extend what the footer says about the piece, write it
in `incoming/specs.md` in your own words and I will match it against these
rules before anything reaches the page.
