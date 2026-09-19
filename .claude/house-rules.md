# KAAL house rules

Read by every command in `.claude/commands/`. It lives outside that directory
on purpose: any `.md` inside `commands/` becomes a slash command, and this is
reference, not a command.

## What this codebase is

`index.html` — 1,400-odd lines, the entire storefront. Inline CSS, inline
vanilla JS in one IIFE. `claimed.html` and `legal.html` are satellites.
`worker/kaal-sold-sync.js` is a Cloudflare Worker that rewrites the `sold`
array in `index.html` on a Razorpay webhook. Static hosting: GitHub Pages,
custom domain `thekaal.co` (`CNAME` + `.nojekyll`).

No build step. No npm. No framework. No bundler. Nothing loaded cross-origin
except Cloudinary frames while the film still lives there.

## Rules that bind every command here

1. **One file is a decision, not debt.** A single `index.html` on a site with
   no build step means one request, no hydration, nothing to version-skew.
   You may argue for splitting it — but the argument has to survive "there is
   no build step to reassemble it," and it has to beat the status quo on a
   metric, not on taste.
2. **If the fix needs tooling, it is the wrong fix.** A proposal that starts
   with `npm i` has failed before it is read.
3. **Match the dialect.** `var`, function declarations, an IIFE, ES5-shaped.
   Do not scatter `const`/arrow/optional-chaining into a region you are not
   otherwise rewriting. Consistency beats your syntax preferences.
4. **Never break a fallback chain.** Every image degrades photo → Cloudinary
   still → designed panel. Every film gate in `filmAllowed()` is deliberate.
   Removing a fallback to simplify code is a regression, not a cleanup.
5. **Commercial values are not yours.** `checkout`, `price`, `edition`,
   `sold`, `dials`, and body copy are the owner's decisions. Flag them, never
   silently change them.
6. **Cite or shut up.** Every claim carries `index.html:LINE`. "This might be
   slow" is not a finding. If you did not read the code or measure it, say so
   out loud instead of dressing a guess as a result.
7. **Preserve behaviour.** Unless the command explicitly says otherwise, the
   rendered page must look and behave identically when you are done.
