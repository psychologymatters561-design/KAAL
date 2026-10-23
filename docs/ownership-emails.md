# The registry's emails, for your approval

Every email the ownership system sends to an owner, exactly as it will read. Placed, Inspected, Packed, Dispatched, Delivered, the reminder and Registered are the brief's own words and are fixed. All the others are in the same voice and are mine to propose: change any line you like and tell Claude. Nothing is sent to anyone until the action that triggers it.

Generated from `worker/letters.js` by `tools/print-letters.mjs`.

## placed

**When:** The moment a payment is verified (automatic). Replaces the earlier confirmation.

Subject: No. 07 is spoken for

```
Owner,

Your payment is received and No. 07 of 20 is now set aside for you alone. Before it leaves, it will be inspected again, boxed by hand and sent to you within five days. You will hear from us at each step.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## inspected

**When:** You tap Inspected (ten seconds to Undo).

Subject: No. 07 has passed inspection

```
Owner,

Before a KAAL leaves us, it is examined once more, on its own. Today it was No. 07's turn: the time, the day and date, the 24-hour hand, the crown, the bracelet, the finish. It passed.

Next, its box is made for it.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## packed

**When:** You tap Packed.

Subject: No. 07 is boxed

```
Owner,

Every KAAL box is made for the one piece it carries. No. 07's is finished, and the piece is resting inside it with its letter.

It leaves for you next.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## dispatched

**When:** You tap Dispatched, or Shiprocket reports the pickup.

Subject: No. 07 is on its way to you

```
Owner,

No. 07 has left us. It travels with Delhivery, tracking number SAMPLE123456.

Follow No. 07: https://www.delhivery.com/track/package/SAMPLE123456

Somewhere between here and you is a piece that will not be made again. When it arrives, open it slowly.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## outForDelivery

**When:** Shiprocket reports out for delivery. Once.

Subject: No. 07 is out for delivery

```
Owner,

No. 07 is out for delivery. It is with Delhivery's rider today. Keep your phone close; the rider may call.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## delivered

**When:** You tap Delivered, or Shiprocket reports it. Also when you or the owner ask for the link again.

Subject: No. 07 is with you. One step makes it yours.

```
Owner,

No. 07 has reached you. Before you wear it, take a minute with it. Turn it over and read the caseback.

One step remains. Registering writes you into the KAAL registry as Owner I of No. 07 of 20. That record stays with this piece for as long as it exists. It also opens your owner dashboard: your 2-year warranty counting down to the second, the piece's history, and its transfer if you ever pass it on.

Register No. 07: https://thekaal.co/claim?t=sample

Registering is how you accept the piece. Once you register, the 7-day return option closes and No. 07 is yours outright. If you would rather keep it on approval for now, this link will wait for you.

20 were made. This one found you.

KAAL

Follow No. 07's journey: https://thekaal.co/track?o=1&s=sample
```

## reminder

**When:** 72 hours after delivery, if the owner has not registered. Once, never again.

Subject: No. 07 has no name beside it yet

```
Owner,

No. 07 has been with you for three days. Its place in the registry is still empty.

Register No. 07: https://thekaal.co/claim?t=sample

Registering closes the return option and opens your warranty dashboard.

KAAL
```

## registered

**When:** The owner registers.

Subject: No. 07 is recorded in your name

```
Owner,

It is done. You are Owner I of No. 07, recorded on 26 October 2026. Your warranty runs until 23:59 on 24 October 2028.

Your dashboard is always at thekaal.co/owners, signed in with this email.

Kaal does not wait. Wear it well.

KAAL
```

## addressNeeded

**When:** A payment arrives with no delivery address. Once.

Subject: No. 07 needs somewhere to go

```
Owner,

Your payment is received and No. 07 of 20 is set aside for you. One thing is left: tell us where to send it.

Add delivery address: https://thekaal.co/claimed.html

KAAL
```

## claimReceived

**When:** An owner raises a warranty claim.

Subject: No. 07: your claim is with us

```
Owner,

We have your warranty claim for No. 07. We answer within forty eight hours, and you will hear from us here.

KAAL
```

## claimApproved

**When:** You approve a claim (with the pickup details you type).

Subject: No. 07: your claim is approved

```
Owner,

Your claim for No. 07 is approved. Its movement will be replaced, and your warranty stays exactly as it was.

Pickup: A courier will collect it on 28 October, between 10 am and 1 pm. Keep it in its box.

Please send it in its box, with its letter.

KAAL
```

## moreInfo

**When:** You ask the owner for more on a claim (with your question).

Subject: No. 07: we need a little more

```
Owner,

To decide your claim for No. 07 we need a little more from you:

A photograph of the caseback, and of the dial in daylight.

Reply to this email with it, and we will carry on.

KAAL
```

## claimDeclined

**When:** You decline a claim (with your reason). Offers the paid service.

Subject: No. 07: about your claim

```
Owner,

We have looked closely at your claim for No. 07, and we are not able to approve it under the warranty.

The movement is working as it should; the time it shows is a setting, not a fault.

If it still needs work, we will service it for a fee. Reply to this email and we will quote it before anything is done.

KAAL
```

## serviceReturned

**When:** You mark a claim serviced.

Subject: No. 07 is on its way back to you

```
Owner,

No. 07 has its new movement and has been tested. It is on its way back to you, with Delhivery, tracking number SAMPLE123456.

Your warranty is unchanged. It still runs until 23:59 on 24 October 2028.

KAAL
```

## transferStarted

**When:** An owner starts a transfer. The code is never in the email.

Subject: No. 07: a transfer has begun

```
Owner,

You have started to pass No. 07 to someone else. The code was shown to you once, on your owner page. Give it to them with the watch and its letter. It works for seven days.

Until they accept it, No. 07 is still yours, and you can cancel from your owner page. If you did not keep the code, cancel and start again.

KAAL
```

## transferInvite

**When:** An owner starts a transfer and gives the buyer's email (optional).

Subject: No. 07 is being passed to you

```
Owner,

Its owner has started to pass No. 07 of 20 to you. When you have it in your hands, open the page below and enter the code that came with it.

Accept No. 07: https://thekaal.co/claim/transfer

The code works for seven days from today. Until you accept, nothing changes.

KAAL
```

## transferComplete

**When:** A transfer is approved (to the seller and to the buyer; two wordings).

**To the owner passing it on**

Subject: No. 07 has passed on

```
Owner,

No. 07 is now recorded in the name of its next owner. Your time with it, as Owner I, is written into its history from 2026 to 2029.

Thank you for keeping it.

KAAL
```

**To the new owner**

Subject: No. 07 is recorded in your name

```
Owner,

It is done. You are Owner II of No. 07. Its warranty is unchanged and runs until 23:59 on 24 October 2028.

Your dashboard is at thekaal.co/owners, signed in with this email.

Kaal does not wait. Wear it well.

KAAL
```

## transferRejected

**When:** You reject a transfer.

Subject: No. 07: the transfer was not approved

```
Owner,

The transfer of No. 07 was not approved, and it stays with its current owner. If you would like to know why, reply to this email.

KAAL
```

## stolenConfirmed

**When:** You confirm a stolen report.

Subject: No. 07 is flagged as stolen

```
Owner,

We have confirmed your report. No. 07 is now shown as stolen in the public registry, and it cannot be transferred. If it is found, write to us and we will clear it.

KAAL
```

## stolenCleared

**When:** You clear a stolen flag.

Subject: No. 07 is cleared

```
Owner,

The stolen flag on No. 07 is cleared. It is shown in the registry as it was, and it can be transferred again.

KAAL
```

## accessReset

**When:** You verify a locked-out owner and move their sign-in. (The brief's "passcode reset": there are no passcodes here, only emailed codes.)

Subject: No. 07: your access is restored

```
Owner,

We have checked your record for No. 07 and moved your sign-in to this address. Every earlier sign-in has been closed.

Sign in to Owners: https://thekaal.co/owners

We will email you a six digit code each time you sign in.

KAAL
```

## recoveryDeclined

**When:** You decline a recovery request (with your reason).

Subject: No. 07: about your request

```
Owner,

We could not verify your request for No. 07, and we have changed nothing.

The movement is working as it should; the time it shows is a setting, not a fault.

Reply to this email with a photograph of the caseback and of the letter that came with it, and we will look again.

KAAL
```

## returnProcessed

**When:** A return is processed and refunded.

Subject: No. 07: your return is processed

```
Owner,

We have received No. 07 back, and your return is processed. ₹5,999 is on its way back to the way you paid, and can take up to seven working days to show.

Thank you for trying it.

KAAL
```

## For you only (never to an owner)

- `sla`: No. 07 is late: Placed more than 48 hours ago, not inspected
- `courierAlert`: No. 07: the courier reports placed
- `linkRequested`: A new registration link was asked for: No. 07
- `requestNew`: [KAAL] A warranty claim for No. 07 needs you
- `requestLate`: [KAAL] No. 07: a claim has waited 36 hours
