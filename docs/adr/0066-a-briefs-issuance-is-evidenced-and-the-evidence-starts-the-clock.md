# ADR-0066: A brief's issuance is evidenced, and the evidence starts the clock

- **Status:** accepted (Edward, 3 Sep)
- **Date:** 2026-09-03
- **Open Decision:** — (specified by Edward, 3 Sep). Touches OD 1/4/5 territory (SLA authority,
  design draft v15 §11) without resolving any of them: this measures ONE interval, at the front of
  the process, and asserts nothing about deadline authority downstream.
- **Task(s):** `I35.5`, `I35.6`; extends ADR-0049's single model call site; the threshold field
  rides on `I14.7`'s Admin → Reminders screen; cost measurement rides on `I34.5`

## Context

**Nothing records when a brief was asked for.** A campaign enters Maestro at the moment somebody
types it into the wizard. Everything after that is measured — approval, assignment, review, sign-off
— and the interval *before* it is invisible. That interval is the agency's own responsiveness, and it
is the one nobody can currently be held to.

Edward, 3 Sep: *"The screen shot is to contain the brief request subject, date and time… This is
intended to be the evidence required to track issuance of the brief. If the brief is not prepared
through to approval by T+1 this should be highlighted as an exception and display on relevant
dashboards."*

### Half of this already exists

`campaigns.status` (`draft → pending_approval → approved`) and `approved_at` were added by
ADR-0048 d.8 and are live. **The END of the interval is already recorded to the second.** What is
missing is only its START — and a start that is asserted rather than evidenced is worth very little
in the conversation this feature exists to have, which is a conversation with a client about who was
waiting for whom.

Hence a screenshot: the request as it actually arrived, in Outlook or WhatsApp or Teams, carrying its
own subject line and its own timestamp. It is evidence in a way a typed date is not.

### The tension: the model can read it, but a machine reading is not evidence

`gpt-5.6-luna` can read the subject, date and time straight off the image, and that removes the
typing Edward asked to remove. But **ADR-0044 and ADR-0065 both hold that facts are never generated
— only sorted, extracted, or supplied.** A date is precisely a fact, and this one is load-bearing: it
decides whether a campaign is in breach.

A misread `3/9` for `9/3` invents a breach that did not happen, or hides one that did, and **nothing
on the screen would say which**. That is worse than no measurement, because a wrong number that looks
checked gets acted on. It is the same failure mode ADR-0065 refused for trends — marketing copy with
citations attached is worse than nothing, for the same reason.

### Cost is not a factor here, and was checked before it was dismissed

Measured against ADR-0049's ~$0.005 per ingested brief: a brief sends up to 50,000 characters
(≈ 12,500 tokens); a screenshot is billed by scaled area and comes to roughly **1,100 tokens** for a
desktop capture and **1,450** for a tall phone capture, against an answer of three short fields. So a
screenshot costs on the order of **a tenth of one brief read — about $0.0005** — and at twenty
campaigns a month, roughly **one cent per month**.

The per-image token rate for `gpt-5.6-luna` is **not recorded anywhere in this repository**; the
figures above use OpenAI's standard image tokenisation and are an estimate. The magnitude is safe
(one thousand tokens, not ten thousand) and the exact number is folded into `I34.5`, which already
exists to measure real AI spend against estimate. **Cost did not decide this ADR and should not be
read as having done so.**

### The three options, weighed

- **A — the model's reading is used directly.** No typing at all. **Rejected**: it makes an unchecked
  machine reading the origin of an accountability measure, which is the one thing ADR-0044 d.4 and
  ADR-0065 were written to prevent, and it fails silently.
- **B — the model proposes, a person confirms. Chosen.** One glance replaces three fields. The wizard
  **already has this exact mechanism**: brief fields filled by ingestion are marked as machine-filled
  and the marker comes off the moment a person edits or confirms (ADR-0044 §5). Nothing new is
  invented; an existing pattern is applied to three more fields.
- **C — the person types the three fields; the screenshot is evidence only.** Edward named this
  himself as the alternative. **Rejected** on the grounds that B costs one glance and delivers the
  same guarantee, so C is strictly more work for the same assurance.

### Wall-clock, against this project's own precedent

ADR-0005 gives every office a working week; ADR-0045's chase and escalation rungs are stated in
**working hours** for a good reason — a weekend must not manufacture a breach.

**Edward chose wall-clock hours here (3 Sep), and that is recorded as a deliberate departure, not an
oversight.** The reasoning that supports it: this interval is the one an agency discusses with a
client, and a client does not care about the agency's working week. The consequence is accepted and
stated plainly — **a brief arriving before a non-working day will show as an exception on a day
nobody worked.** The threshold being editable (d.8) is what makes that survivable without a
developer, and if it proves noisy the working-hours option remains available as an amendment.

### The receipt time is not the upload time, and the gap between them is the point

Edward, 3 Sep: *"the time that is stated for receipt needs to calculate the actual time stamp
extracted, not the timestamp of the upload."*

This is the trap the whole feature turns on. A brief that arrived at 14:32 on Tuesday and was
screenshotted at 09:00 on Wednesday is already **eighteen and a half hours old** when it reaches the
wizard — which is most of a 24-hour threshold, spent before Maestro knew the campaign existed. An
upload-anchored receipt would forgive exactly the delay that the measurement exists to reveal, and it
would do so invisibly, because the number on screen would look perfectly reasonable. So the extracted
value is the receipt, and the moment of capture is kept beside it as a separate fact rather than
standing in for it.

It also means a receipt can be **in exception the moment it is entered**, and that is correct
behaviour, not a bug to soften.

### One thing this feature could become, and must not

If evidence is optional, and evidence is what starts a clock, then **not attaching evidence is a way
to never be late**. Nobody need intend it for it to happen.

Forcing evidence is not the answer — a brief genuinely can arrive by phone, and refusing to record
one would push real work outside the system entirely. But nor is silence: an unevidenced campaign is
not compliant, it is **unmeasured**, and those are different things.

**This is where the ADR stops and a leadership question begins** (Edward, 3 Sep): it turns on how the
agency wants **verbal briefs** treated, which is a policy question about accountability, not a
technical one. d.10 therefore decides only what is safe to decide now — evidence is optional, and an
unevidenced campaign is never in breach — and records the incentive problem, plus the two shapes an
answer usually takes, so the conversation begins with them rather than rediscovering them.

## Decision

**d.1 — A campaign carries a *brief receipt*:** the screenshot, the subject line, `received_at` (the
timestamp read off the image), `captured_at` (when the screenshot reached us), and who confirmed it.
One receipt per campaign. The two timestamps are separate fields because they are separate facts —
see d.5.

**d.2 — The screenshot is filed as an ordinary asset** in the campaign's References folder, not
hidden in a column. Evidence lives in the Library with everything else, versioned and downloadable
like any other document, and the receipt points at it.

**d.3 — The image may be pasted, not only chosen from disk.** Pasting is how a screenshot actually
arrives. A pasted image carries no filename, so it is named deterministically from the confirmed
receipt (`Brief received 2026-09-03 09-14.png`) rather than being left as `image.png`.

**d.4 — The model READS and PROPOSES; it never states.** Subject, received-at date and received-at
time arrive in the form marked as machine-filled, exactly as ingested brief fields do (ADR-0044 §5).
The marker comes off when a person edits or confirms.

**d.5 — The clock starts from the timestamp INSIDE THE IMAGE, never from when the screenshot was
uploaded.** This is the whole point of the evidence and the easiest thing to get wrong: a request
that arrived Tuesday 14:32 and was screenshotted on Wednesday morning is **fourteen hours old before
anyone opens the wizard**, and a receipt anchored on upload time would silently forgive every one of
those hours. `received_at` is the extracted value; the upload moment is recorded separately as
`captured_at` and is never the clock's origin. A receipt awaiting confirmation starts no clock and is
shown as awaiting confirmation (d.4).

**d.6 — The image is the record; the three fields are an index into it.** Any dispute is settled by
opening the screenshot, which is why d.2 files it as a real asset rather than a thumbnail.

**d.7 — The exception:** a campaign whose brief has not reached `approved` within the threshold,
measured in **wall-clock hours** from the confirmed received-at, is in exception. `approved_at`
already records the other end.

**d.8 — The threshold is tenant configuration, not a constant** — a field on the Admin → Reminders
screen `I14.7` is already building, beside "chase after" and "escalate after", which are the same
kind of number. Default 24 hours. Changing it must never require a developer.

**d.9 — The exception is computed on READ, not by a scheduled job.** It is a query over campaigns and
their receipts, shown on the campaign page, the campaigns list and the dashboard beside
`UnassignedWork`. **Notifying anyone about it waits for `stall-sweep` (`I14.7`)** and is explicitly
out of scope here; this ADR makes the exception visible, not noisy.

**d.10 — Evidence is OPTIONAL, and a campaign with no receipt is never in breach.** There is no
deadline without a start, so calling it one would be false. **What else happens to an unevidenced
campaign is deliberately left open** (Edward, 3 Sep): it turns on how the agency wants **verbal
briefs** handled, which is a leadership question and not a technical one. Until it is answered,
nothing is surfaced about unevidenced campaigns beyond the campaign itself.

The reason a count was proposed, recorded here so it reaches that conversation: **if evidence is
optional and evidence starts the clock, skipping the screenshot is a way to never be late.** Nobody
need intend this for it to happen. The two shapes an answer usually takes are (a) count unevidenced
campaigns as their own number beside the exceptions, so the gap is visible without being punitive, or
(b) treat a verbal brief as evidence of a different kind — *logged by a named person, at a stated
time, on their word* — which starts the clock honestly and removes the incentive altogether. **(b) is
the more likely fit** for an agency that genuinely takes briefs by phone, and it costs one extra
control, not a new mechanism. Neither is decided here.

**d.11 — Reading an image is an additive extension of `_shared/model.ts`, which stays the single
model call site** (ADR-0049). The image travels as a content part beside the existing text; no
caller gains its own request shape, because the value of that file is that a provider switch touches
one file.

**d.12 — The model still gets no tools and no data access** (ADR-0044 d.4). A hostile screenshot can
put strange text into three fields a person is about to read, and can do nothing else.

**d.13 — A partial timestamp is returned partial. The model never completes one.** Screenshots
routinely do not state an absolute moment: WhatsApp shows `14:32` for anything received today, mail
clients show `Yesterday 09:15` or `2 hours ago`, and a date with no year is the norm. Turning any of
those into an absolute timestamp requires knowing when the screenshot was taken — which is an
inference, and **d.4 forbids the model from making it**. So the model returns only what the image
states, the field arrives incomplete and clearly marked as such, and **the person completes it**.
This is the fact rule doing its job at the exact point it matters, and it is why d.4 is worth its one
glance.

**d.14 — An extracted time is interpreted in the confirming person's office timezone, and that zone
is shown beside it.** A screenshot carries a wall-clock reading with no offset — the sender's mail
client rendered it in the *reader's* local zone, and the image cannot say which. Storage is
`timestamptz` as everywhere else in this project, so a zone must be chosen rather than assumed: the
office of the person confirming is the closest available truth and is right in the ordinary case. It
is shown, not hidden, so a receipt confirmed by somebody in another office can be corrected instead
of being quietly wrong by four hours.

## Consequences

**Easier.** The agency's own responsiveness becomes measurable for the first time, at the point where
it is most often disputed and least often recorded. An argument about when a brief landed is settled
by opening an image rather than by recollection. The threshold is tuned by whoever runs the agency,
not by a deployment.

**Harder — and this is the real cost.** **A screenshot of an inbox carries more than the brief.** An
email capture routinely shows other subject lines, other senders, contact names and internal
addresses; a WhatsApp capture shows phone numbers and unrelated messages. That content is then (a)
stored in the Library where anyone with `assets:view` can read it and (b) **sent to OpenAI**. Brief
*text* already leaves the tenant under ADR-0049, so the destination is not new — but the *breadth* of
what an untrimmed screenshot contains is materially wider than a brief document, and it is
incidental rather than chosen. The mitigation is honest interface copy asking for a cropped capture
of the request itself, and it is a mitigation, not a fix. This does not reopen residency (ADR-0044
d.6 / ADR-0049 d.6, still open); it does mean that when residency is answered, **images must be
considered separately from text**, and this paragraph is the reason why.

**Also harder.** The wizard gains a step's worth of interaction on a screen that is already dense.
`_shared/model.ts` gains a second capability, which is a small tax on the "one file" property each
time it is extended. Wall-clock will produce weekend exceptions (accepted above).

**Locked in.** The measured interval is anchored on a **human-confirmed** timestamp. Should a later
decision want the clock started automatically — an email integration, say — that is a new decision
about a new source of evidence, not a loosening of this one.

**Cost.** ~$0.0005 per screenshot on the ADR-0049 base, subject to the caveat above; measured under
`I34.5`. No new dependency, no new service, no licensing dimension.

**Left open, deliberately.** How an **unevidenced** campaign is treated (d.10) — Edward is confirming
with leadership how verbal briefs should be handled. Accepting this ADR does not settle it, and the
implementation must not assume an answer: evidence is optional, an unevidenced campaign is not in
breach, and nothing further is displayed about it until the question comes back. The likely shape of
the answer, and the incentive problem it has to solve, are recorded in d.10 so the conversation
starts with them rather than rediscovering them.

**Depends on** [ADR-0067](0067-a-campaign-exists-from-step-2-of-the-wizard-as-a-draft.md) for the
campaign to exist when the screenshot is filed.

## Addendum — 11 Sep, from ADR-0086's build

**A campaign may now hold several receipts.** d.1's one-receipt-per-campaign uniqueness
(`campaign_brief_receipts.campaign_id`, `20260903100200`) was dropped by `20260911130400`, because
ADR-0086 d.5/d.6 attach a duplicate request to the job it duplicates and both proofs must sit on one
evidence trail in arrival order. **The clock is read from the EARLIEST confirmed receipt**, which is
what d.1 always meant; a later receipt is a later event on the same trail and restarts nothing.
`useBriefReceipt` reads the earliest; `useSaveBriefReceipt` updates by id. A receipt is never moved
between campaigns except by that attach, and the stamp trigger no longer re-stamps `confirmed_by` on
a move — a mover is not a confirmer.
