# The nearly-bought note, on WhatsApp

Someone gives their details, reaches payment and stops. Three hours later
(between 10 am and 8 pm) the worker writes the one note for WhatsApp, from
their visit: the number and dial they chose, whether it is still open, how
they came to it. Then it **waits for you** in the command centre,
**Follow-ups, Waiting for you**, and your phone gets an alert.

- **Nothing goes without you.** Read it, change the words or the name
  (write "Mr. Sharma" if you like), then **Approve and send on WhatsApp**,
  or **Skip** (no message to them, ever). Next to it, for your eyes only:
  what they did on the site (visits, numbers and dials looked at, the
  engraving, minutes).
- **The truth is checked again when you press it.** Paid since: never sent,
  cleared. Their number sold since, or the count moved and your words
  state the old count: the message is rewritten with today's facts and
  comes back to you to read again.
- **One message, never both.** If WhatsApp refuses it (no WhatsApp on that
  number, Meta's limits), your same words go by email at once. If Meta
  takes it and reports later that it could not deliver it, the email goes
  then (within six hours, and not if they paid or said stop).
- **"Stop"** (the button, or the word, or "band karo") stops everything,
  WhatsApp and email, and they are told so once.
- **Any other reply** comes to your phone as an alert. Answer it yourself
  from KAAL's WhatsApp. Within 24 hours of their reply you can write freely.
- **What the buyer is told:** the details step says their details are used
  "to reach you about this order, by email or WhatsApp", and the Privacy
  section names WhatsApp (Meta). Meta asks that people know a business may
  message them on WhatsApp; this line is that notice.
- **Off switch:** `WHATSAPP_NEARLY = "off"` in wrangler.toml, then merge.
  Without the four `WHATSAPP_` secrets it does nothing and the email goes
  on its own as before.

## What it costs

Meta charges for every marketing message it delivers: about a rupee each
in India (WhatsApp Manager, Billing, shows the current rate). Replies to
someone who wrote to you in the last 24 hours are free. Claude's line costs a
few rupees, the same as the email's.

## Setting it up

Most of Meta's setup is done for you by the worker. You make one app and
one token in Meta, put three keys in GitHub, and press buttons in the
command centre.

### 1. In Meta (about 15 minutes, on a laptop)

1. **developers.facebook.com, My Apps, Create app.** Name "KAAL Website";
   use case **Connect with customers through WhatsApp**; portfolio **KAAL**.
   If you already made an app with WhatsApp in its menu, use that one.
2. In the app, **App settings, Basic**: Privacy policy URL
   `https://thekaal.co/legal.html#privacy`, Category **Shopping**, an app
   icon, **Save changes**. Then next to **App secret** press **Show** and
   copy it. That is `WHATSAPP_APP_SECRET`.
3. **business.facebook.com/settings, Users, System users, Add**:
   `kaal-worker`, **Admin**. **Assign assets**: the app (full control) and
   KAAL's WhatsApp account (full control). **Generate token**: the app,
   expiry **Never**, tick `whatsapp_business_messaging` and
   `whatsapp_business_management`. Copy it (starts with EAA). That is
   `WHATSAPP_TOKEN`.
4. **WhatsApp Manager (business.facebook.com/wa/manage), Payment methods**:
   add a card, currency INR.

You do not need the Phone number ID or the template screens: the worker
finds the number from the token and makes the template itself.

### 2. In GitHub (5 minutes)

Settings, Secrets and variables, Actions, New repository secret:

| Name | Value |
|---|---|
| `WHATSAPP_TOKEN` | the EAA... token |
| `WHATSAPP_APP_SECRET` | the App secret |
| `WHATSAPP_VERIFY_TOKEN` | any long text you make up |

Then **Actions, setup-worker, Run workflow**, mode **live**, and wait for
the green tick.

### 3. In the command centre (5 minutes)

**Follow-ups, WhatsApp connection** checks every step with Meta and shows
the button for the next one:

- **Send code / Verify**: if Meta has not verified the number, a code comes
  by SMS to it; type it in.
- **Register**: switches the number on for sending, with a 6-digit PIN you
  choose (write it down). A number that also runs the WhatsApp Business app
  is already on and is left alone.
- **Connect replies**: subscribes the app to the account and points Meta's
  webhook at the worker, so replies and Stop come back.
- **Create template**: sends `kaal_nearly` to Meta, word for word.
  Approval takes minutes to a day; press **Check again**.

When every line is ticked it says **Connected**. Last, in the app at
developers.facebook.com, switch **App mode** to **Live**.

If the number is not found, the check says which numbers the token can see:
add 9311416678 to the WhatsApp account in WhatsApp Manager, Phone numbers,
or give kaal-worker that account in Assign assets. If the token sees no
account at all, add a fourth secret `WHATSAPP_WABA_ID` (WhatsApp Manager
shows it as the WhatsApp Business Account ID).

### 4. Try it

From a second phone: choose a number, fill the details, open payment and
close it. Three hours later (10 am to 8 pm) your phone alerts you; the
message waits in Follow-ups. Edit it, approve it, and it arrives. Reply
"stop" to see the stop work.

## Until Meta verifies the business

An unverified business can write first to a limited number of people a
day, far more than KAAL's checkouts. Business verification (Business
settings, Security centre) lifts it. It is not needed to start.
