# KAAL house rules

Read by every command in `.claude/commands/`. It lives outside that directory
on purpose: any `.md` inside `commands/` becomes a slash command, and this is
reference, not a command.

## What this codebase is

`index.html` — 2,200-odd lines, the entire storefront. Inline CSS, inline
vanilla JS in one IIFE. `claimed.html`, `legal.html` and `manifesto.html` are
satellites. `worker/` is a Cloudflare Worker that rewrites the `sold` array in
`index.html` on a Razorpay webhook: `index.js` routes, `lib/edition.js` holds
the pure rules, `lib/{store,github,http,crypto}.js` are adapters. Static
hosting: GitHub Pages, custom domain `thekaal.co` (`CNAME` + `.nojekyll`).

`ARCHITECTURE.md` is the long answer, including what was deliberately not
split. Read it before proposing a split.

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
8. **The worker has layers; respect the direction.** `worker/lib/edition.js`
   imports nothing and must stay that way — no fetch, no env, no clock. A
   handler in `worker/index.js` may decide and may call; the moment it builds
   a header, decodes base64, or writes a KV key with a prefix in it, the fix
   belongs in the adapter below it.
9. **Money changes start with a failing test.** `tools/test/` runs with no
   npm, no network and no mocking library. Every test in there exists because
   the behaviour it describes is something you only get to be wrong about
   once.
