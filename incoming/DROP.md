# Photographs: none pending

Every picture on the page now exists. The three that were waiting
(`stone-day.webp`, `stone-studio.webp`, `four.webp`) are no longer referenced:

| # | Was waiting for | Now shows |
|---|---|---|
| 1 | Silver white dial on broken concrete (act 01) | `film-desk.webp`: a real frame of the film, the emerald watch on the desk by the lamp (frame 192, 1080×1350) |
| 2 | Silver white dial on a concrete block (act 02) | The four dials side by side on slate, from the four product cut-outs (`watch-*.webp`) |
| 8 | All four on wet black slate (act 06) | `watch-ivory.webp` alone on a pale stone ground |
| 3–6 | ✅ Delivered | `jade-wide`, `jade-close`, `onyx-rain`, `ember-smoke` |
| 7 | ✅ Hero | frame 000 of the baked film |

**If you shoot the originals later,** save them under the old names in
`assets/img/` and ask for them to be put back in place of the stand-ins; it is
three `src` changes in `index.html`.

**Size:** longest edge 1600px is plenty. The page never draws a photograph
wider than about 1180 CSS pixels.

`KAAL.frames` (the Cloudinary stills) is still the safety net under the four
delivered photographs: if one ever fails to load, a frame of the film stands
in. It is never requested while the real photo loads.

---

## The film — already baked, no Cloudinary left

This used to say to self-host `assets/video/hero.mp4` and point `index.html`
at it. That plan is done and gone one step further: the hero does not run a
video file at all anymore, self-hosted or not.

`tools/bake-hero-seq.sh` cuts the film into three sequences of still frames —
the film's own 9:16 for phones, a 1080 square plate for tablets and desktops,
and a lighter plate for slow links — encodes each as WEBP, and
commits them to `assets/img/hero-seq/`. The page paints those to a canvas as
you scroll. There is no `<video>` element, no seek, no decoder in the loop,
and — the point of this note — no request to Cloudinary. `KAAL.film`, the
config line that used to name the Cloudinary URL the frames were cut from,
has been removed from `index.html`; nothing in the page or the bake script
ever read it.

The only Cloudinary dependency left anywhere on the site is `KAAL.frames`,
the safety net under the three photographs still missing above — and each of
those stops touching Cloudinary the moment its real photo lands at the right
filename.

**If you ever get a new or re-shot film**, re-bake it:

```bash
tools/bake-hero-seq.sh path/to/new-film.mp4
```

That overwrites everything under `assets/img/hero-seq/`. Commit the result,
and paste the `filmCuts` line it prints into the config if the cuts moved.
The current master lives at `incoming/film/kaal_commercial.mp4`.

---

## The share card is already done

`assets/img/og.jpg` has been regenerated. The old one showed the earlier AI
imagery; the new one is typographic, carries the wordmark, the four dials and
the line, and claims nothing the product cannot back.

It is what appears when somebody pastes the link into WhatsApp, which is how
this will actually travel in India, so it was worth doing properly rather than
leaving as a to-do.

If you ever change the price or the line, the source is `docs/og-card.html`.
Open it in a browser at 1200x630 and screenshot it, or re-render it headless.
