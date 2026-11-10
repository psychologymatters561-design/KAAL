# The nearly-bought note, on WhatsApp

Someone gives their details, reaches payment and stops. If they ticked
**"KAAL may send one WhatsApp message about this number"** on the details
step, the one note goes to their WhatsApp instead of their inbox. Same
rules as the email (docs/followups.md): three hours after, between 10 am
and 8 pm, once per person, ever. Claude writes the middle for that person;
the rest is fixed.

- **One note, never both.** If WhatsApp refuses it (no WhatsApp on that
  number, Meta's limits), the email goes instead, in the same run. If Meta
  takes it and reports later that it could not deliver it, the email goes
  then (within six hours, and not if they paid or said stop).
- **"Stop"** (the button, or the word, or "band karo") stops everything,
  WhatsApp and email, and they are told so once.
- **Any other reply** comes to your phone as an alert. Answer it yourself
  from KAAL's WhatsApp. Within 24 hours of their reply you can write freely.
- **No tick, no WhatsApp.** The tick starts unticked. Meta's rules and
  India's DPDP Act both need their own yes, and the worker keeps the time
  they gave it.
- **Off switch:** `WHATSAPP_NEARLY = "off"` in wrangler.toml, then merge.

## What it costs

Meta charges for every marketing message it delivers: about a rupee each
in India (WhatsApp Manager, Billing, shows the current rate). Replies to
someone who wrote to you in the last 24 hours are free. Claude's line costs a
few rupees, the same as the email's.

## Setting it up (once, about an hour, mostly waiting for Meta)

A computer makes the Meta steps much easier than a phone.

### 1. The number

Use KAAL's number, +91 93114 16678. **If it is on the WhatsApp Business
app:** when Meta asks while you add it (step 3), choose to **connect the
existing WhatsApp Business app**. That way the app keeps working, the notes
the worker sends show up in it, and you reply from your phone as you do
now. **If it is on ordinary WhatsApp:** move it to the WhatsApp Business app
first. Adding a number that is on ordinary WhatsApp takes it off that app.

### 2. The app

1. developers.facebook.com, My Apps, **Create app**. Use case: **Connect with
   customers through WhatsApp**. Business portfolio: KAAL's (the one with the
   Facebook Page and Instagram).
2. In the app, **App settings, Basic**: copy the **App secret**. That is
   `WHATSAPP_APP_SECRET`. Set the Privacy policy URL to
   `https://thekaal.co/legal.html#privacy`.

### 3. WhatsApp

1. In the app, **WhatsApp, API Setup**, **Add phone number**: +91 93114 16678,
   display name **KAAL** (Meta approves the name, usually within a day).
2. Copy the **Phone number ID** (a long number, not the phone number). That is
   `WHATSAPP_PHONE_ID`.
3. **WhatsApp Manager, Payment methods**: add a card. Marketing messages are
   not sent without one.

### 4. A token that never expires

The token on API Setup lasts 24 hours. Do not use it.

business.facebook.com, **Settings, Users, System users**, **Add**: name
`kaal-worker`, role **Admin**. **Assign assets**: the app (full control) and
the WhatsApp account (full control). **Generate token**: the app, expiry
**Never**, permissions `whatsapp_business_messaging` and
`whatsapp_business_management`. Copy it. That is `WHATSAPP_TOKEN`.

### 5. The template (word for word)

WhatsApp Manager, **Message templates, Create template**.

- Category **Marketing**, type **Default**
- Name **kaal_nearly**
- Language **English**
- Header: none
- Body, exactly this, with the blank lines:

```
Hello {{1}}, this is KAAL.

{{2}}

Seven days to live with it, and every rupee back if it is not for you. Two years on the movement. Delivery across India included.

This is the only message we will send about it. If paying went wrong, reply here and a person will answer.
```

- Samples Meta asks for: `{{1}}` Rohan; `{{2}}` You chose No. 13, the
  Champagne dial, and stopped at payment. It is still unclaimed, eight of the
  twenty are left, and the design is never made again.
- Footer: none
- Buttons, in this order:
  1. **Visit website**, text **See the number**, URL type **Dynamic**:
     `https://thekaal.co/?utm_source=whatsapp&utm_medium=nearly&n={{1}}`,
     sample `13`
  2. **Custom** (quick reply), text **Stop**

Submit. Approval usually takes minutes to a day. If you change any word, the
worker's preview (worker/whatsapp.js, `waPreview`) should be changed to match.

### 6. The four secrets

GitHub, the KAAL repository, **Settings, Secrets and variables, Actions, New
repository secret**, four times:

| Name | Value |
|---|---|
| `WHATSAPP_TOKEN` | the never-expiring token (step 4) |
| `WHATSAPP_PHONE_ID` | the Phone number ID (step 3) |
| `WHATSAPP_APP_SECRET` | the App secret (step 2) |
| `WHATSAPP_VERIFY_TOKEN` | any long text you make up, e.g. three random words and a number |

Then **Actions, setup-worker, Run workflow**, mode **live**.

### 7. The webhook (replies, stop, failures)

In the app, **WhatsApp, Configuration, Webhook, Edit**:

- Callback URL: `https://kaal-edition.kaal-edition-hq.workers.dev/wa/webhook`
- Verify token: the same text as `WHATSAPP_VERIFY_TOKEN`

**Verify and save**, then **Manage** and subscribe to **messages**. Finally,
switch the app from Development to **Live** (top of the app's page). Meta
sends real replies only to a live app.

### 8. Try it on yourself

On your own phone: choose a number, fill the details, **tick the WhatsApp
box**, open payment and close it. Three hours later (between 10 am and 8 pm)
the note arrives. The command centre's Follow-ups shows it word for word,
marked WhatsApp. Reply "stop" to see the stop work. That marks you stop, so
use a second number for your next test.

## Until Meta verifies the business

An unverified business can write first to only a small number of people a
day, far more than KAAL's checkouts. Business verification (Business
settings, Security centre) lifts it. It is not needed to start.
