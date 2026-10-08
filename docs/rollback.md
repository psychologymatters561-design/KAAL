# Going back: one piece, or everything

There are three ways back, from smallest to largest. None of them touches a
sale, a payment or the sold list.

---

## 1. Turn one piece off (a one-line change)

Every feature added in October 2026 has its own switch in `index.html`,
inside the config near the top of the script, under `features:`.
Change `true` to `false`, commit, and that piece is gone on the next load.
Nothing else moves, and the page underneath still works.

| Switch | What turns off | What the page does instead |
|---|---|---|
| `early` | The "Which one is yours?" act after the film | The film runs straight into act 01 |
| `ctx` | "Emerald · 4 of 6 remain → Choose yours" under each dial act | No link; the dial acts end on their photograph |
| `caseback` | Choosing a number turns the piece to its engraved back | The piece stays on its face |
| `list` | Both Series 02 email forms (Stillness act and footer) | The words stay; there is no form |
| `depth` | The parallax planes and the pinned dial photographs | Everything scrolls flat, at one speed |
| `light` | The light you move across the green dial photograph | A plain photograph |
| `sheen` | The light sweep across the buttons and dial discs | Plain buttons |
| `wipe` | The wipe that reveals the four dial headlines | They fade up like every other line |
| `morph` | One dial picture turning into the next | The older crossfade |
| `sharp` | Phones swapping in a full-resolution frame when the film rests | The film stays at its scrolling resolution |
| `world3d` | The live light-and-dust world behind the page | The colour wash that was there before |
| `reviews` | Owners' reviews | No reviews section |
| `details` | The "Where should No. 07 go?" form before payment (name, phone, email, address) | Razorpay opens straight away, and the address is asked for on the thank-you page after payment, as before |

The GitHub web editor is enough: open `index.html`, press `.` or the pencil,
search for `features:`, change the word, commit to `main`.

## 2. Try it before you commit it

Add `?off=` to the address with any switch names, separated by commas:

```
https://thekaal.co/?off=depth
https://thekaal.co/?off=world3d,depth,early
```

Only your own screen changes, and only for that visit. Nobody else sees it.
Use this to decide what to switch off before you change anything.

## 3. The whole site, exactly as it was on 2 October 2026

Before any of this work went live, the live site was saved, untouched, as
the branch **`live-snapshot-2026-10-02`** (commit `68f523a`). It is a full
copy: page, film, photographs, worker.

**Restoring it, from a terminal:**

```bash
git checkout main && git pull
git checkout live-snapshot-2026-10-02 -- .
```

**Stop before committing.** Two things on `main` are newer than the snapshot
and have to be kept:

1. **The sold list.** Open `index.html`, find `sold:` and put back the
   numbers that are sold *today*. The snapshot only knows the ones sold
   before 2 October. Getting this wrong offers a sold number for sale again.
   `git diff index.html | grep sold` shows both lines.
2. **The payment return.** Keep `claimed.html` and `worker/` as they are on
   `main`, so buyers still get their receipt and you still get the email:

   ```bash
   git checkout HEAD -- claimed.html worker/ wrangler.toml
   ```

Then commit and push:

```bash
git commit -m "Restore the site as it was on 2 October 2026"
git push
```

GitHub Pages republishes in about a minute.

**Restoring only one file** works the same way, with the file's name in
place of the dot. For example, to bring back the old order page alone:

```bash
git checkout live-snapshot-2026-10-02 -- claimed.html
```

## What a switch cannot undo

These changed the page itself rather than adding to it, so they come back
only through section 3 (or by asking for that one file to be restored):

- **The hero film.** It now plays all 17 seconds, every frame, 9:16 on
  phones and a 1080 square on tablets and desktops. The old cut is in the
  snapshot under `assets/img/hero-seq/`.
- **Copy.** The lines that read like instructions ("Eighteen seconds, with
  sound." and others) are rewritten; the full list is in the pull request.
- **The three photographs that never arrived.** Acts 01, 02 and 06 show a
  frame of the film, the four dials on slate, and the ivory dial on stone.
- **The order page and payment return.** `claimed.html`, the worker's
  `/callback`, `/receipt` and `/shipping`. Rolling these back brings back
  the bug where a buyer pays and is never shown a receipt. Don't, unless
  something is broken there.
