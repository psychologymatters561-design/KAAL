# Follow-ups: the one note to someone who nearly bought

Someone chooses a number, reaches checkout and stops. Three hours or more
later (between 10 am and 8 pm India time) one note goes to them, once, ever.
Nothing else is ever sent to them about it.

## Who writes it

Command centre, **Follow-ups**, three choices:

- **Claude writes and sends** (the default once Claude is connected). Claude
  writes the middle of the note for that one person: whether their number
  is still open, which other numbers carry the same dial, how many are left,
  and how they came to it (a first look or their fourth visit, the dial they
  kept returning to, a payment that failed, a gift). Their history is used
  only to choose what the note leads with; the note never mentions what we
  saw of their visit.
- **Claude drafts, I approve.** The same drafts wait in Follow-ups. Edit the
  words if you like, then **Send it** or **Skip** (no note to them, ever).
- **The standard note only.** The note written for every case, as before.

## What it can and cannot say

The offer is only the truth: the piece is unclaimed and there is one of it,
never another; seven days to send it back unworn for every rupee; two
years' warranty on the movement; free delivery across India; a person who
answers if paying went wrong. Never a discount, a code, a deadline, "today
only", "held for you", anything about religion, a founder, reviews or a
feature that is not real.

Every draft is checked by the worker before it can go: none of those words,
no number that is not true (the number, the same dial's open numbers, how
many are left), no links, no dashes, no exclamation marks, no greeting or
sign-off of its own. The greeting, the one link, the offer of help, the
signature ("KAAL") and the P.S. ("This is the only time we'll write about
No. 07.") are fixed and never written by Claude. A draft that fails the
check, a declined request, a timeout or any error sends the standard note
instead, and Follow-ups says why. Claude is never sent anyone's email or
phone, only their first name.

**Write a sample now** drafts one for the most recent unfinished checkout and
shows it beside the standard note. Nothing is sent. Ten an hour at most.

## Connecting Claude (once)

1. At console.anthropic.com, sign in, then API keys, Create key. Copy it.
2. In GitHub: the KAAL repository, Settings, Secrets and variables, Actions,
   New repository secret. Name: `ANTHROPIC_API_KEY`. Paste the key. Save.
3. Actions, setup-worker, Run workflow, mode **live**. In about two minutes
   Follow-ups says "Claude is connected".

The model is Claude Opus 5.5 (`claude-opus-5-5`). A note is a few hundred
words in and out, roughly ₹1 to ₹2 each; at most three are written each
half-hour run.
