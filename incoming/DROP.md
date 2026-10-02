# The three remaining photographs

Everything on the page is wired to the exact names below. Upload them and
the site is finished. Nothing else has to change.

GitHub web works fine for this: **Add file → Upload files → Commit**.

---

## The photographs → `assets/img/`

Save each one with **exactly** this name. Format: `.webp` if you can export
it, otherwise rename a `.jpg` to keep the name and change the extension in
`index.html` with one find and replace.

| # | The shot you sent | Save as |
|---|---|---|
| 1 | Silver white dial, shot down onto a broken concrete slab, hard daylight | `stone-day.webp` |
| 2 | Silver white dial, three quarter view on a pale concrete block, grey wall | `stone-studio.webp` |
| 3 | ✅ Delivered: green dial, whole watch on green velvet | `jade-wide.webp` |
| 4 | ✅ Delivered: green dial macro on green velvet | `jade-close.webp` |
| 5 | ✅ Delivered: black dial macro on black stone, warm light streak | `onyx-rain.webp` |
| 6 | ✅ Delivered: champagne dial on sandstone, raking sunlight | `ember-smoke.webp` |
| 7 | ✅ Delivered: frame 000 of the baked film is the poster — no separate photo needed | `hero-seq/tall/000.webp`, `hero-seq/plate/000.webp` |
| 8 | All four on wet black slate, seen from above | `four.webp` |

Three left: `stone-day.webp`, `stone-studio.webp`, `four.webp`.

**Size:** longest edge 1600px is plenty. The page never draws a photograph
wider than about 1180 CSS pixels, so anything beyond 1600 is bytes your buyer
pays for and never sees.

Until they land the page does not break, and it is not empty either. Each
missing picture falls back to a still cut out of your own film by Cloudinary,
at a set percentage of its duration, and only falls back to a designed panel
if that cannot be reached. The site is live now on that basis.

Those frames are a safety net, not the plan. A frame of a moving product video
is never as good as a photograph composed to be one, and I have not been able
to see them: this session cannot reach Cloudinary, so I wired the frames but
have never looked at them. **Open the site and look.** If any frame is blurred
or mid-motion, change its percentage in `KAAL.frames` usage on that picture
(the `data-frame` attribute), or set `frames: ""` to go back to panels.

The moment a real photograph exists at its filename below, it wins outright
and its frame is never requested again.

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
