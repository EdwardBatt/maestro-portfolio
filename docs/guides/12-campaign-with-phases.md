# 12 — Creating a campaign with phases

**Who this is for:** the Account Manager for the client, or Traffic on their behalf.

**What you need before you start**

- The client already exists (guide 1), and a brand if the campaign is for one.
- The client's brief — as a document you can drop in, text you can paste, or in your head.

That is all. Nothing has to be set up per department first: once the campaign is approved, each
piece's **owner** approves that piece's task list (ADR-0100).

**When to use phases.** A campaign that runs over weeks — a teaser before launch, then week one,
week two, a wrap-up — is planned in **phases**. Each phase has a name, a start and an end, and
every piece in it is planned backwards from the phase's end. A campaign that runs as one piece
leaves phases off; nothing changes for it.

The example throughout is **LUMA Season 2** for Luma Retail: a pre-launch teaser, then weekly
phases of posts, reminders and winner stories.

---

## The steps

### 1. Open the Campaign Builder

Go to **Campaigns** and press **+ New** at the top right (or `Ctrl P` anywhere in Maestro). The
builder has **five steps**; every step saves as you go, and nothing is released until the last one.

*(Screenshot withheld from the public copy: The campaigns list, with + New at the top right)*

### 2. Step 1 — The campaign, and its phases

On the left, **the campaign**: its name, the client and brand, and the account manager (filled in
from the client — the person who approves it). Under them, **evidence the brief was requested**:
a screenshot of the request as it arrived, or the time the client asked, typed by hand. That is
when the client's clock starts.

On the right, two switches: **Phases** (off) and **Workstreams** (on).

*(Screenshot withheld from the public copy: Step 1, as it opens)*

Name the campaign, pick the client, and turn **Phases** on. The panel offers **+ Add a phase**.

*(Screenshot withheld from the public copy: Named, with phases switched on)*

Press **+ Add a phase** for each one: a **name**, a **start** and an **end**. Only the first phase
asks for its start; every phase after it starts the day after the one before ends, already filled
in — change it only if there is a gap.

*(Screenshot withheld from the public copy: Adding the second phase — its start is filled in from the first)*

| # | Name | Runs |
|---|---|---|
| 1 | Pre-Launch | the week before launch |
| 2 | Week 1 | launch week — first draw |
| 3 | Week 2 | second draw |
| 4 | Weeks 3–4 | the last two draws |

*(Screenshot withheld from the public copy: Four phases on step 1)*

Press a phase to change it; **Remove this phase** is in the same dialog. **Workstreams** stay on unless the campaign is
too small to group — they are how the pieces arrive on the next step. Press **Next**.

### 3. Step 2 — The brief

One page in five parts — context, audience and brand, the idea, journey and measures, dos and
don'ts — with a rail on the left counting what is filled. **Drop a file** or **Paste text instead**
and Maestro fills the empty fields for you to check; or type them. Only **the proposition** is
required. **+ Add a rule** puts a campaign rule on top of the client's own.

*(Screenshot withheld from the public copy: Step 2 — the brief filled in)*

Press **Next — propose the deliverables**.

### 4. Step 3 — The work

Maestro reads the brief against **your deliverable catalogue** and proposes the pieces — each one
a catalogue entry, never a made-up name — grouped into **workstreams**, each with the line of the
brief it came from, how many, and the **phase** it suggests. Every row is ticked (kept); untick
what the brief did not ask for, or **Drop all** in a workstream.

*(Screenshot withheld from the public copy: Step 3 — the proposal, in three workstreams)*

Every piece needs an **owner** — the lead accountable for it. Press **Edit** on the row: the
dialog holds the type (with its task list, folded under it), how many, the owner, the phase, the
format, channel, priority, languages and notes. **The owner's department is the piece's
department** (ADR-0102); the workstream only groups it.

*(Screenshot withheld from the public copy: A piece opened — the owner chosen)*

Give each workstream an owner too, from the list beside its name — the lead who assigns its work.
Add a piece by typing its name into the line under a workstream; **+ New workstream** for anything
the brief did not suggest; **Move** takes a piece to another workstream; **✕** removes it, with a
reason that stays on the record.

*(Screenshot withheld from the public copy: Step 3 — every piece owned)*

Press **Keep these — go to timing**. It refuses while a kept piece has no owner, and says which.

### 5. Step 4 — Timing

The top of the step is **the season**: one block per phase, with its dates and the day it ends
on. Maestro has already counted every piece backwards from its phase's end — the delivery day, and
the day work must start, working days only (Friday and Saturday never count). Press a phase to see
its pieces.

*(Screenshot withheld from the public copy: Step 4 — Pre-Launch open; two pieces short of their lead time)*

An **amber row** is short of time: it needs more working days than its phase leaves. You can go
ahead; it is recorded as reduced scope. A piece the brief did not place in a phase is listed
underneath — *not in a phase yet, so it has no date*.

**A date chooses the phase.** Press **Edit** on a piece and give it a due date: the dialog says
when work starts and **which phase that date sits in**. Save, and the piece moves into that phase
— earlier or later. The Caption had no phase; given 6 October, it sits in Week 1.

*(Screenshot withheld from the public copy: Giving the Caption a date — it sits in Week 1)*

*(Screenshot withheld from the public copy: Week 1, now holding the Caption)*

The pencil on a phase changes its dates; every piece in it re-plans from the new end. **The client
has been given this date** marks a date as promised. Press **Next — review**.

### 6. Step 5 — Review, and approve

The campaign as one card — client, phases, workstreams, how many pieces, launch and finale — then
**who gets what**, one line per workstream with its department and who assigns it, and **what
approving does**, in so many words: the clocks start, each owner is told the work is theirs and
approves their task lists before anyone is assigned, and every piece appears on its planned days.

*(Screenshot withheld from the public copy: Step 5 — this one is yours to approve)*

Press **Approve and start the work**. If you are the account manager, it is approved at once; if
not, it waits for them (the page says who). **Save as a draft** keeps it without telling anybody.

### 7. The campaign page

The campaign opens on its **Grid**: the task lists waiting for their owners at the top, every piece
below by workstream, and the workstreams under it. Guide 13 covers everything you can do from here.

*(Screenshot withheld from the public copy: LUMA Season 2, approved — seven task lists waiting)*

---

## The rules

- **Phases are optional per campaign; a single job never has them** (ADR-0096).
- **A piece plans backwards from its phase's end.** A date given to a piece chooses its phase; a
  phase whose dates change re-plans every piece in it.
- **Short of time warns, records and proceeds** — a piece that needs more working days than its
  phase leaves is amber and goes out as reduced scope (ADR-0075). So does a date after go-live or
  after its phase's end. None of them is refused.
- **The catalogue is the vocabulary.** The proposals come from it and only it (ADR-0097). If the
  brief asks for something the catalogue has no entry for, add the entry under Admin → Deliverable
  types first.
- **A piece's department is its owner's** (ADR-0102). A workstream groups pieces; it does not
  decide where they belong (ADR-0099).
- **Every piece needs an owner** before the step will be left.

## What happens next

- Each owner is told the campaign is approved and what they own.
- Each owner approves their own pieces' **task lists** on the campaign's Grid (ADR-0100). Nothing
  under a piece can be assigned until its list is approved.
- Then the work is assigned on the schedule (guide 6).
