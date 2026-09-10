# The eight files, and the film

Everything on the page is wired to the exact names below. Upload them and
the site is finished. Nothing else has to change.

GitHub web works fine for this: **Add file → Upload files → Commit**.

---

## The eight photographs → `assets/img/`

Save each one with **exactly** this name. Format: `.webp` if you can export
it, otherwise rename a `.jpg` to keep the name and change the extension in
`index.html` with one find and replace.

| # | The shot you sent | Save as |
|---|---|---|
| 1 | Silver white dial, shot down onto a broken concrete slab, hard daylight | `stone-day.webp` |
| 2 | Silver white dial, three quarter view on a pale concrete block, grey wall | `stone-studio.webp` |
| 3 | Green dial upright on dark slate, green mist, shaft of light | `jade-wide.webp` |
| 4 | Green dial, closer three quarter macro, same mist | `jade-close.webp` |
| 5 | Black dial with gold indices, macro, water beads on a wet black surface | `onyx-rain.webp` |
| 6 | Brass gold dial in warm smoke and golden bokeh | `ember-smoke.webp` |
| 7 | Brass gold dial, whole watch with the bracelet curve, candlelight on stone | `hero-still.webp` |
| 8 | All four on wet black slate, seen from above | `four.webp` |

Number 7 is doing the most work: it is the hero image that carries the whole
first screen on every phone, and on any desktop before the film arrives. If
one of them is worth a careful export, it is that one.

**Size:** longest edge 1600px is plenty. The page never draws a photograph
wider than about 1180 CSS pixels, so anything beyond 1600 is bytes your buyer
pays for and never sees.

Until they land the page does not break. Each missing picture renders as a
designed panel reading "photograph pending", so you can put the site live
today and drop the images in after.

---

## The film → `assets/video/hero.mp4`

Right now `index.html` points at your Cloudinary URL, so the film already
works without you doing anything.

**Self hosting it is still the better call**, for three reasons: the page
stops depending on a free tier CDN staying un-throttled in the middle of a
paid ad campaign, the file is fetched from the same origin as the page so
the browser never has to ask permission for it, and you can re-encode it for
scrubbing, which the Cloudinary copy is almost certainly not.

Scroll video is seeked constantly rather than played. A normal export puts a
keyframe every couple of seconds, and every seek then has to decode forward
from the last one, which is exactly what makes a scroll video feel sticky.
Keyframes every few frames fixes it:

```bash
ffmpeg -i your-original.mp4 -an \
  -vf "scale=1440:-2" \
  -c:v libx264 -profile:v high -pix_fmt yuv420p \
  -g 5 -keyint_min 5 -sc_threshold 0 \
  -crf 25 -movflags +faststart \
  hero.mp4
```

`-an` drops the audio, which is never played and is pure weight.
`-g 5` is the keyframe interval, and the whole point.
`+faststart` moves the index to the front so playback can begin early.

Aim for **under 6 MB**. Then upload it as `assets/video/hero.mp4` and change
one line near the bottom of `index.html`:

```js
film: "assets/video/hero.mp4",
```

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
