# Owners' reviews: what to send, and how to add them

The section is built and switched on, and it shows nothing until
`KAAL.reviews` in `index.html` holds a real owner's words. There is no
placeholder text anywhere on the page.

## The message to send the owners of No. 01 and No. 02

WhatsApp or email, from you, in your own name. Change the number for each
person.

> Hi [first name], it's [your name] from KAAL. Thank you again for No. 01.
>
> We'd like to put a few words from owners on thekaal.co, beside the twenty.
> Only if you want to, and only in your words. Three questions:
>
> 1. In two or three sentences, what is it like to wear No. 01? Say it the way
>    you would to a friend, good or not.
> 2. Can we publish it with your first name, the first letter of your
>    surname, and your city? For example "Aarav S., Pune".
> 3. Would you like a photo in a small circle next to it? If yes, send one
>    you are happy with, of your face or the watch on your wrist. If not, we
>    will use your initials.
>
> If you're happy for us to publish it, please end your reply with "Yes, you
> can publish this", so we have your permission in writing.
>
> Nothing changes if you'd rather not: your number, your warranty and your
> return window stay exactly the same. There's no discount or gift for doing
> this. We'd rather your words were freely given.

Keep the reply. It is your record of consent.

## Adding a reply

In `index.html`, find `reviews: [],` and replace it with the owners' entries:

```js
reviews: [
  { no: 1, name: "Aarav S.", city: "Pune",
    text: "Their words, exactly as they wrote them.",
    photo: "assets/img/owners/01.webp", month: "September 2026", consent: true },
  { no: 2, name: "Meera K.", city: "Bengaluru",
    text: "Their words, exactly as they wrote them.",
    month: "October 2026", consent: true }
],
```

- `no` is their number. The page adds the dial ("Owner of No. 01 · Emerald").
- `photo` is optional. Leave it out and the circle shows their initials.
- `consent: true` is the switch. Leave it out and the entry is never shown.

**The photo.** Square, 240×240, WebP, saved as `assets/img/owners/01.webp`
(the number, two digits). From any photo:

```bash
mkdir -p assets/img/owners
ffmpeg -i photo.jpg -vf "crop='min(iw,ih)':'min(iw,ih)',scale=240:240" -quality 82 assets/img/owners/01.webp
```

Or send the photo in a session and ask for it to be added.

**Removing one.** If an owner changes their mind, delete their entry and
their photo. They are gone on the next load.

## The rules this follows

India's standard for online consumer reviews, **IS 19000:2022**, and the
CCPA's dark-pattern guidelines boil down to the following. They are also the
only reason a review is worth reading.

- **Only real buyers.** Both are verified by their order.
- **Their words.** Fix spelling if they ask you to. Never change meaning,
  and never write one for them.
- **Their permission, in writing.** That is the "Yes, you can publish this"
  in the message.
- **Nothing paid for it.** If you ever give something in return, it must be
  said next to the review.
- **Not only the good ones.** With two owners, publish what both say. A
  lukewarm line next to a glowing one is more believable than two glowing
  ones.

## Why there are no stars and no structured data

Google's review rich results require a star rating with each review. The
message does not ask for one, and turning someone's sentence into five stars
would be inventing a number they never gave. The words are published as
words. If you later decide to ask for a rating as well, it can be added to
the structured data then.
