# Five files are waiting in your Higgsfield account

They were generated in this session and they are paid for. I could not put
them into the repository myself: this session's network policy allows GitHub
and the package registries and nothing else, so every Higgsfield download URL
(`d8j0ntlcm91z4.cloudfront.net`) is refused before the request leaves the
machine. That is a wall around me, not a problem with the files.

So this is a five-minute job for you, once.

## What to do

Open Higgsfield, find these five in your generations, download them, then
upload them into this repository with **exactly** the filenames in the last
column. GitHub web works: **Add file → Upload files → Commit**.

### The pull-back — pick ONE of the two

Two variants of the same shot, 2560×1440, six seconds. Camera dollies back
from one black-dial watch to all four on slate. Both ends are anchored to
photographs you already have — the start frame is a crop of
`assets/img/lineup-1200.webp` and the end frame is that same file — so the
watch cannot drift into something you do not sell. **Watch both. Pick the one
where the bracelet links stay honest through the middle of the move.**

| | job | save as |
|---|---|---|
| variant A | `3d76081f-3d9c-45a5-aac0-88d056346028` | `incoming/seq/pullback.mp4` |
| variant B | `a313ce0d-86fe-47d7-950a-a2d2b5372e11` | `incoming/seq/pullback.mp4` |

Only upload one. Same filename either way.

### The four 4K stills

Upscales of the photographs already on the page, at 3840 on the long edge.

| job | that is the | save as |
|---|---|---|
| `dadec6b1-058b-4c74-8cbe-109ef8aa34ed` | four on slate, the closing shot | `incoming/photos/lineup-4k.png` |
| `87768469-87ad-46b4-91fc-503a81970d13` | four standing, scene 3's still | `incoming/photos/approach-4k.png` |
| `2f0d3886-f9db-465b-8022-b42e74e2453e` | three-quarter row, scene 7 | `incoming/photos/trio-4k.png` |
| `388e3f8b-acd7-4efd-b36a-482e57107157` | green and gold macro, scene 5 | `incoming/photos/whitedial-4k.png` |

A fifth upscale, `green-1200.webp`, was never started — the plan hit a four
concurrent job ceiling and by then the download wall made a fifth pointless.
Two credits, any time you want it.

## What happens when they land

Say the word and I will, in one pass:

- cut the video into a 40-frame WebP sequence and replace `assets/seq/`,
  which lengthens the pull-back in scene 3 and sharpens it from 1100 px to
  1600 px wide
- derive 480 / 768 / 1200 / **1900** WebP widths from each 4K still and add
  the 1900 to every `srcset`
- raise `PLATE_MAX_CSS_W` in `index.html` from 1240, which is the one line
  currently holding the plates back. It is set where it is because a 1200 px
  photograph cannot fill more than that without going soft. With 4K sources
  behind it the plate can run the full width of a 2560 px monitor and stay
  sharp.

Nothing else changes. The filenames above are the drop-in points.

## Before you look at them, one thing worth saying plainly

The upscaler sharpens whatever it is given, and what it was given includes
the day rings that read `THON TUE TRU SAT`. At 1200 px that text is small
enough to pass as texture. At 3840 px it is legible. You have chosen twice
now to ship this imagery and that is your brand and your call, but look at
the four stills at full size before you commit them, because a buyer who is
five percent of your customer base will see them at that size too.
