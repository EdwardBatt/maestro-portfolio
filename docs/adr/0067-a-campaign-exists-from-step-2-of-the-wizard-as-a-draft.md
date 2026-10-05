# ADR-0067: A campaign exists from step 2 of the wizard, as a draft

- **Status:** accepted (Edward, 3 Sep)
- **Date:** 2026-09-03
- **Open Decision:** —
- **Task(s):** `I35.4`, `I35.5`; retires the after-submit filing path in ADR-0044 §8; prerequisite
  for [ADR-0066](0066-a-briefs-issuance-is-evidenced-and-the-evidence-starts-the-clock.md)

## Context

The Brief Wizard writes **nothing** until its last step. `create_campaign_from_brief` creates the
campaign, its stream and its deliverables in one transaction, and until that moment the campaign does
not exist.

That was a good decision for a form. It stops being one the moment the form has to file documents,
because **a document needs a folder and a folder needs a campaign.**

### The existing workaround, and what it already costs

ADR-0044 §8 files the ingested brief document into the campaign's References folder **after** submit,
for exactly this reason. The code says so, and it also says what that costs:

> *"The campaign is already saved, so this is never a failed submit. It is also not nothing: the
> wizard said 'will be filed in the campaign's References folder', and filing needs `assets:manage`,
> which the wizard itself does not require — so an Account Manager without that grant would otherwise
> be shown a promise, then silently sent to a campaign with no reference document."*

So there is already a promise-then-apologise path, carefully written, for **one** file. Edward now
wants **campaign reference materials on step 2, multiple, filed into chosen folders** (3 Sep), and
brand documents on step 1 the same way. Staging N files in the browser until submit scales that
apology from one file to many, gives the user no folder tree to file into during the step where they
are choosing files, and loses everything if the tab closes.

### The slot already exists and has never been used

`campaigns.status` permits `draft`, `pending_approval` and `approved` (ADR-0048 d.8,
`chk_campaigns_status`). **Nothing has ever created a `draft` campaign** — the wizard's RPC writes
`pending_approval`, and every `'draft'` elsewhere in the migrations is a `deliverable_state`, a
different type entirely. The value was defined, gated for, and left unused.

Folder provisioning needs nothing new either: `app.provision_campaign_folders` runs on campaign
insert and creates Working Files, Deliverables, Final Assets and References. A draft campaign gets a
real folder tree for free, the same way a brand does.

### Options

- **A — keep staging in the browser until submit.** No orphans. But no folder tree to file into
  during the wizard, an apology per failed file instead of per failed campaign, and uploads lost on
  abandon. **Rejected**: it preserves a property (nothing exists early) whose only beneficiary is the
  campaigns list, at the cost of the feature being asked for.
- **B — create the campaign as a draft on the step 1 → 2 transition. Chosen.**
- **C — provision folders without a campaign.** `asset_folders.campaign_id` is a real foreign key
  with a real cascade. A tree pointing at nothing is a second kind of orphan and a worse one, because
  nothing in the schema describes it. **Rejected.**

### What B genuinely costs, stated before it is chosen

**Campaigns will exist that are not campaigns yet.** Seven places read `campaigns`
(`campaign-api`, `campaign-detail-api`, `bookings-api`, `deliverables-api`, `schedule-api`, and two
in `chat`); `schedule-api` already filters to approved. Each must now have an answer for `draft`, and
"it inherits whatever `pending_approval` does" is only accidentally right.

**Abandoned wizards leave drafts behind.** That is the honest price of the feature, and it is paid in
clutter rather than in correctness — nothing under an unapproved campaign is assignable (ADR-0048
d.8), so a stray draft is inert.

## Decision

**d.1 — Moving from step 1 to step 2 creates the campaign with `status = 'draft'`.** Client, brand,
name and account manager — everything step 1 collects — are written then. Folder provisioning is
already triggered by the insert; **no new provisioning code is needed.**

**d.2 — A draft campaign is not work.** Nothing under it is assignable or bookable, which is already
true of anything not `approved` and requires no new gate.

**d.3 — The campaigns list shows drafts separately, as *unfinished*, never mixed with live
campaigns.** A draft is a wizard someone walked away from, and presenting it beside real campaigns
would make the list lie. The wizard can **resume** one, which is a capability the current design has
no way to offer.

**d.4 — Submit completes the draft** — strategy, deliverables and stream, then `draft →
pending_approval`. That part stays one transaction; what splits is the campaign's *creation* from the
writing of its *content*, not the content itself.

**d.5 — The campaign name is claimed at step 2.** `uq_campaigns_tenant_name` therefore reports a
duplicate at step 2 rather than after five steps of typing. This is an improvement and is stated as a
decision because it changes where an error surfaces.

**d.6 — Filing during the wizard is ordinary filing.** Same permission (`assets:manage`), same
folders, same errors, no staging. **The after-submit filing path in ADR-0044 §8 is retired for new
campaigns** and its promise-then-apologise handling goes with it.

**d.7 — An abandoned draft is never deleted automatically.** Deleting a half-written brief on a timer
destroys somebody's work to tidy a list. Drafts are visible (d.3) and deletable by hand. If they
accumulate to the point of being a problem, a sweep is a **later decision with evidence behind it**,
not a precaution taken now.

## Consequences

**Easier.** Uploading during the wizard becomes ordinary rather than special: a real folder tree, on
the step where the files are being chosen, with the same behaviour as everywhere else in the app. The
apology path for unfiled documents disappears rather than being generalised to N files. Resumable
briefs arrive as a side effect. Duplicate names are caught early. And ADR-0066 becomes buildable at
all — a screenshot filed as evidence needs somewhere to be filed.

**Harder.** `draft` stops being a theoretical value and becomes one every reader of `campaigns` must
handle; the seven call sites above are the checklist, and missing one shows up as a half-built
campaign appearing where it should not. The atomic create splits into create-then-complete, so a
draft can exist with no deliverables — legal, but a state the current code has never seen.

**Locked in.** A campaign's **identity** (client, brand, name, account manager) is fixed one step
earlier than its **content**. Changing the client on a campaign that already has files filed under
that client's folder tree is consequently not a rename — it would be a move — and nothing here makes
that possible. If changing a campaign's client is ever wanted, it is a new decision, and this ADR is
why.

**Not affected.** Brand documents (step 1) never needed any of this: a brand's folders exist the
moment the brand does. The two upload surfaces share a picker, not a mechanism.
