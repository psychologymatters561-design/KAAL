# `.claude/` — what is in here and why

## `commands/` — eight slash commands

Type `/name` in any Claude Code session opened on this repo.

| Command | For |
|---|---|
| `/perf` | Scroll and render performance. Measured, not guessed. The deepest one — it names the real suspects in the rAF loop and the frame sequence. |
| `/audit` | Architecture and maintainability review. Reports; does not edit. |
| `/debug` | Root-cause a bug as an incident: reproduce, prove, fix minimally, verify. |
| `/security` | The money path — the Worker's GitHub write, the Razorpay hand-off, client-trusted state. |
| `/frontend` | Build or harden UI, with every state and input method enumerated. |
| `/ship` | Pre-push gate for GitHub Pages + the Worker. Ends with ship / do not ship. |
| `/techlead` | Decisions, not typing. Pushes back before anything gets built. |
| `/caveman` | Compressed output for one reply. |

`house-rules.md` sits one level up, outside `commands/`, because every `.md`
inside that directory registers as a slash command. Each command reads it
first; it carries the constraints that make the other files specific to this
repo rather than generic prompt-engineering.

## Where these came from — and what was cut

Adapted from a set of ten "senior engineer" role-play prompts. Two were
dropped and two merged, because on this codebase they were fiction:

- **"Architect your startup backend"** — dropped. There is no backend. There
  is one Cloudflare Worker that edits one line of one file, and it already
  documents its own scope better than a generic architecture prompt would.
- **"DevOps: Docker/Kubernetes, CI/CD, monitoring"** — replaced by `/ship`.
  The deploy is `git push` → GitHub Pages. A twenty-watch drop that needs a
  control plane has a different problem than the one that prompt solves.
- **"Rebuild messy code into clean architecture"** — merged into `/audit`,
  which already has to judge whether the single-file decision holds. A command
  whose premise is "this code is messy, split it" cannot reach the answer
  "it is not, and splitting it would cost you the no-build-step property."

The rest were rewritten rather than transcribed. A prompt that says "identify
performance bottlenecks" gets generic answers; one that says "48 decoded
frames at 1280w are held as live Image objects — do the arithmetic" gets a
number. Specificity is the whole difference between a prompt and a command.

## `skills/`

`3d-web-experience` — pre-existing, not part of the above.
