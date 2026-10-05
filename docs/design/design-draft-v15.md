**Resource & Traffic Management Platform**

Design Document --- Fifteenth Draft

*A system to enforce discipline and accountability --- built on
resource-first scheduling, with SLAs, time and billing, and approval
workflows. Designed for internal use with a path to commercialization.*

Status: Working draft for review and iteration

Scope: Architecture, data model direction, differentiators, and open
decisions

This document captures decisions reached during design discussion. Items
marked OPEN are deliberately unresolved and flagged for follow-up.

**Contents**

**1. Overview & Purpose**

+-----------------------------------------------------------------------+
| **Product identity**                                                  |
|                                                                       |
| This is a system to enforce discipline and accountability. Scheduling |
| is the substrate the accountability runs on, not the headline. The    |
| reason to book resources against SLAs, attributable clocks, and       |
| performance linkage is to make commitments visible and enforced       |
| rather than aspirational.                                             |
+-----------------------------------------------------------------------+

This platform manages the booking, scheduling, and utilization of
resources --- both human and non-human --- together with approval
workflows, service-level commitments, time tracking, and billing. It is
conceived as a bespoke alternative to off-the-shelf tools such as
Resource Guru, whose per-resource pricing model and limited custom
functionality do not fit the intended use. But the ambition is different
in kind: existing tools answer \"who is available and what are they
booked on?\" This platform also answers \"did the committed work get
delivered on time, whose responsibility if not, and what does that mean
for how people are measured?\"

The platform is built primarily for **Meridian**, a creative and marketing
agency (offices in Baghdad, Dubai and Cairo; bilingual English/Arabic).
Meridian operates within **Kite Group**, a large conglomerate spanning
payments, logistics, e-commerce, media, insurance and more. Meridian does
marketing work for Kite sibling companies --- most as clients, and one or
two as peer tenants collaborating on shared workload. This real
structure grounds the multi-tenancy and collaboration model (Section 10)
and confirms the bilingual/RTL and multi-office requirements.

Two constraints drive the decision to build rather than buy: **cost at
scale** --- per-resource pricing grows with inventory rather than usage,
which penalizes a large resource pool served by a small number of actual
users --- and **custom functionality** --- the SLA, capacity, and
accountability logic required here has no equivalent in existing
products.

A bespoke build has near-zero marginal cost per resource, which inverts
the economics in the platform\'s favor as the resource count grows.
Commercialization is a stated future possibility, which shapes several
architectural decisions in this document --- most importantly
multi-tenancy and a strict avoidance of copyleft-licensed source code as
a foundation.

**1.1 What makes this hard**

The platform carries genuine underlying complexity --- fractional human
capacity, categorized SLAs, several distinct accountability models,
approval routing, and multi-tenancy. The central design challenge is not
implementing any one of these; it is keeping all of them out of any
individual user\'s way. This tension is resolved by two ideas in Section
2: complexity lives in the engine, and each user sees only their role\'s
slice of the system.

A consequence of the accountability-first identity: the accountability
engine is the spine, not a later bolt-on. A version that did only
scheduling, capacity, and billing would not yet do the thing this
platform exists to do --- it would be a rebuilt Resource Guru. The
scheduling layer may ship first for practical reasons (see Section 12),
but the schema assumes accountability from day one.

**2. Governing Design Principles**

These principles apply to every feature in this document. Each feature
specification must demonstrate compliance through an explicit Surface
vs. Engine split (see Section 2.3), written per role.

**2.1 The two ideas that make a complex system simple**

+-----------------------------------------------------------------------+
| **The core discipline**                                               |
|                                                                       |
| **Complexity lives in the engine, never in a user\'s path --- and no  |
| single user sees the whole system. Each role sees only its own        |
| slice.**                                                              |
+-----------------------------------------------------------------------+

Ease of use is not achieved by making the system smaller. It is achieved
at the **interface**: the system is large, but any individual user\'s
view of it is small. Very few users ever touch the full spectrum of
functionality --- most have narrow, specific needs --- so the design
gives each role a purpose-built surface that is genuinely simple because
it is genuinely smaller, not because complexity is hidden inside it.

**2.2 Governing principles**

-   **Role-scoped interfaces** --- the full spectrum exists only for the
    rare power user (admin, ops lead). Every other role gets a complete,
    self-contained tool for its own job. A creative\'s view is not \"the
    app with things hidden\" --- it is a small, complete tool for a
    creative.

-   **Complexity in the engine** --- calculations, rules, and workflows
    live in the system, never in the user\'s path.

-   **Derive, don\'t ask** --- every value the system can infer is a
    field the user never sees.

-   **Default, don\'t configure** --- configuration is a one-time admin
    act, not a daily-user burden. Defaults should be right \~90% of the
    time.

-   **Inform, don\'t obstruct** --- surface consequences and let the
    user decide, rather than blocking with hard errors (the
    warn-and-allow pattern).

-   **The scheduler is the substrate** --- the timeline view is
    best-in-class table stakes to be matched, not the product\'s
    headline; accountability is the point (Section 1).

**2.3 The Surface vs. Engine contract**

Every feature specification in this document carries a note with one
engine line and one surface line per relevant role:

**Engine:** the real complexity the system carries --- calculations,
rules, workflows, state. Shared by all roles.

**Surface:** what each role actually sees and does --- described per
role, since the same engine presents a different face to a creative, a
booker, a team lead, and an admin.

This makes \"which roles see this, and what does each see?\" a required
field for every feature. If a role\'s surface cannot be written simply,
the role scoping has leaked. The surface lines double as a
first-time-user test script per role. Two structural tests of correct
design: (1) adding a later-phase feature must *not* force any earlier
feature\'s surface line to be rewritten; (2) **each role must be able to
do its whole job without ever seeing a control that belongs to another
role.** If a creative must look at a capacity ceiling to get work done,
the scoping has failed.

**2.4 The role surfaces**

Indicative role-to-surface mapping. Roles are illustrative; the point is
that each is simple on its own terms.

  -----------------------------------------------------------------------
  **Role**       **What they see**
  -------------- --------------------------------------------------------
  Creative       Their queue, their deadlines, a way to flag \"blocked on
                 client.\" No capacity math, no billing, no one else\'s
                 SLAs.

  Booker /       The timeline and availability. Books resources. No
  scheduler      performance data.

  Team lead      Team load and SLA/breach status --- the accountability
                 dashboard. Where discipline is made visible and
                 enforced.

  Support /      A thin surface matched to their accountability type ---
  sales / event  which may be close to nothing.

  Admin          The only role touching the full configuration surface,
                 once, at setup.
  -----------------------------------------------------------------------

Design direction: implement role scoping as **fixed role-based views**
for v1 (each role gets a designed screen), structured so they are the
first expression of a model that can later become **configurable
per-customer role surfaces** --- the same reasoning as multi-tenancy
(Section 10). Fixed views suffice for internal use; configurability
matters for commercialization, where customers have different role
structures.

**3. Architecture & Technology Stack**

The stack is chosen for solo-developer velocity with heavy AI
assistance, low running cost, and full ownership of the codebase (a hard
requirement given commercialization).

  ------------------------------------------------------------------------
  **Layer**    **Choice**            **Rationale**
  ------------ --------------------- -------------------------------------
  Frontend     React + TypeScript    Fast, well-supported, shared language
               (Vite)                with backend

  Data grids   TanStack Query +      Server-state and the dense tables the
               TanStack Table        app needs

  Scheduler UI FullCalendar          Purpose-built for resource rows +
               (resource-timeline)   drag booking; not hand-rolled

  Backend /    Supabase (Postgres,   Fastest solo path; managed Postgres
  data         Auth, RLS, realtime,  with full temporal power
               storage)              

  Schema &     Supabase CLI          Versioned SQL migrations; no ORM
  migrations   (SQL-first)           abstraction over temporal logic

  Types        supabase gen types    End-to-end type safety without an ORM
               typescript            

  Business     Edge Functions        Testable, versioned workflows and
  logic        (Deno/TS)             calculations
  ------------------------------------------------------------------------

**3.1 Where logic lives**

With no ORM, three layers can hold logic. Disciplined separation is the
main safeguard against an unmaintainable system:

1.  **Database** (constraints, RLS, generated columns) --- invariants
    that must hold no matter what calls the DB: no double-booking of
    exclusive resources, row-access rules, referential integrity.

2.  **Edge Functions** --- workflows and calculations: approval routing,
    SLA evaluation, invoice generation. Explicit, testable, versioned.

3.  **Frontend** --- presentation only. No billing math, no SLA rules,
    ever.

The trap to avoid: billing or SLA logic buried in Postgres triggers that
cannot be easily unit-tested, or in the client where it is unverifiable.
Hard invariants go in the database; computed rules go in Edge Functions.
*This is a deliberate divergence from the reference systems (see Section
9), which lean more heavily on database-resident logic.*

**3.2 Why SQL-first rather than an ORM**

The hardest logic in this platform is relational and temporal: overlap
detection, SLA clocks, billing calculations. These are natural in SQL
(range types, exclusion constraints, window functions) and awkward
through an ORM. SQL-first migrations keep the schema as the source of
truth --- versioned and reviewable --- and Postgres SQL is written
fluently with AI assistance. Nothing of value is lost; direct access to
Postgres\'s temporal features is gained.

**3.3 Running cost (indicative)**

At the intended scale (roughly 25--30 users, a larger resource pool),
infrastructure sits in the region of \$50--150/month on a managed
Supabase-style stack. The larger cost of a bespoke build is developer
time, not hosting. Because per-resource marginal cost is effectively
zero, the economic case strengthens as the resource pool grows. *These
figures are indicative and should be confirmed against the chosen
deployment.*

**4. Resource Model & Capacity**

Resources are the spine of the system (resource-first, not
project-first). The key modeling insight is that two concerns which are
easy to conflate must be kept separate:

-   **Capacity model** --- a property of the resource. Governs
    scheduling and overbooking. Universal across resource kinds.

-   **Accountability model** --- a property of the work / booking, and
    optional. Governs SLAs and performance. Fragments by role (see
    Section 5).

**4.1 Capacity models**

  -----------------------------------------------------------------------
  **Capacity model**    **Applies to**            **Overlap behavior**
  --------------------- ------------------------- -----------------------
  Exclusive             Equipment, rooms          Booked or not; overlap
                                                  = hard conflict

  Pooled (n)            Interchangeable equipment Up to n concurrent
                        (e.g. 4 identical lenses) bookings, then full

  Load-based (ceiling,  All human resources       Bookings accumulate %
  warn-at)                                        load; overlap allowed;
                                                  warn past ceiling
  -----------------------------------------------------------------------

Humans are never truly at a clean 100% and routinely multi-task, so
human resources use **load-based capacity with warn-and-allow**: a
booking consumes a percentage of availability, overlaps are permitted,
and crossing the ceiling raises a visible warning but never blocks.
Equipment uses hard ceilings. Ceilings are per-resource attributes (a
senior resource may tolerate a higher ceiling than a new one), not a
global constant.

**Engine:** per-resource capacity model, fractional load accumulation,
per-person ceilings and warn thresholds.

**Surface --- booker:** a booking either goes through cleanly or shows
one gentle warning with a proceed option (e.g. \"this puts Sarah at 115%
--- proceed?\"). No percentage math shown unless requested.

**Surface --- team lead:** team load at a glance, with over-ceiling
resources flagged. The capacity picture is their tool, not the
booker\'s.

**Surface --- the resource:** does not see capacity mechanics at all.

**4.2 Booking states (design direction)**

Booking states are governed by application logic (Edge Functions) so
that flexible states can coexist by rule, while a hard invariant is
still enforced at the database level for correctness.

-   **soft_hold** --- a short-lived reservation while a user decides;
    expires automatically.

-   **tentative** --- pending approval; may coexist with other
    tentatives.

-   **confirmed** --- approved; consumes capacity.

-   **cancelled / expired** --- ignored for availability.

Design direction: use **application logic for the flexible states**
(soft-holds, tentatives, approvals) and a **partial database constraint
for the one hard invariant** --- no two confirmed bookings may overlap
for an exclusive resource. This gives flexibility where wanted and a
physical guarantee (including against race conditions) where it matters.
Load-based resources are governed entirely by application logic, since
overlap is expected.

**4.3 Blackout / unavailability**

Resource unavailability (leave, maintenance, holidays) is modeled
separately from bookings. This is distinct from capacity load and must
be represented as its own concept.

**5. Accountability, Work Types & SLAs**

This is the most nuanced area of the design and contains the platform\'s
primary differentiators. The essential realization: accountability is
not uniform across human resources. \"Work type with an SLA\" applies to
creative, deliverable-producing resources --- not to all humans.

**5.1 Accountability is a spectrum**

Different human resource types are measured in fundamentally different
ways. Forcing them all through a single SLA engine would be wrong.
Meridian\'s real department structure (from the org chart) grounds the roles
and their accountability shapes:

  -----------------------------------------------------------------------
  **Meridian department / role**   **Accountability shape**
  --------------------------- -------------------------------------------
  Creative (Art & Video;      Deliverable SLAs --- turnaround on outputs,
  Copy, Social & Content)     revision-bounded, quality-linked

  Production (Pre-Prod →      Stage-gated deliverable SLAs --- milestone
  On-Set → Post-Prod          dates per stage (shoot, first cut, final)
  pipeline)                   

  Performance Marketing       Outcome-based --- ROAS, CPA/CPL against
                              spend; campaign-flight deadlines

  Influencers                 Coverage & delivery --- creator briefing,
                              drafts, go-live milestones

  Client Services (Account    Ownership/coordination --- owns intake and
  Mgmt)                       client relationship, not deliverable SLAs

  Support functions           Capacity + hours, or response-time SLAs ---
  (Accounting, P&C, IT)       not creative deliverable SLAs
  -----------------------------------------------------------------------

*The structure confirms the design\'s core claim: accountability is
role- and work-type-specific, not uniform. It also confirms Production
is a genuine multi-stage pipeline --- reinforcing stage-gated SLAs for
production work --- and that Meridian is multi-office (Baghdad, Dubai, Cairo)
and bilingual (English/Arabic, RTL), both designed-in requirements
rather than assumptions.*

**5.2 The separation that keeps this clean**

Three concerns are separated so that adding a new role never disturbs
scheduling or billing:

4.  **Capacity / scheduling** --- universal. Every human is
    load-based-with-ceiling; equipment is exclusive/pooled.

5.  **Billing** --- largely universal (rate × time, or fixed-price),
    varying by configuration.

6.  **Accountability / performance** --- the dimension that fragments by
    role.

Design move: treat **accountability as a pluggable profile attached to a
resource type**, where \"creative-deliverable-SLA\" is one profile among
several --- alongside \"sales-target\", \"event-coverage\",
\"response-time-SLA\", and \"none\". Capacity and billing stay common;
only the accountability profile swaps out. Adding \"sales rep\" later
becomes a new profile plugged into a resource type that already
schedules and bills correctly.

**5.3 Work type as a first-class entity**

For resources whose accountability is deliverable-SLA (principally
creatives), work type is the spine that ties scheduling, SLAs, and
billing together. A booking optionally references a work type; when it
does, that work type carries a default SLA profile, a default billing
model, and a default capacity expectation. Bookings for non-SLA
resources (e.g. support coverage) simply leave the work-type dimension
null and never enter the SLA/performance machinery.

**5.4 SLA engine --- design direction**

Work is predominantly deadline-driven: most work has a hard deadline.
Variability lies in how the deadline is set, not whether one exists.

-   **Standardized work** (e.g. social posts, streaming) --- deadline
    auto-calculated from the work type.

-   **Bespoke work** (e.g. brand identity) --- deadline negotiated and
    set explicitly at intake, then treated as just as hard.

Common machinery across work types, configured per profile:

-   Which points are measured (end-to-end, stage transitions, or
    handoffs).

-   Whether completion is committed (default) or, rarely, estimated.

-   **A pausable, attributable clock** --- the clock pauses when work is
    genuinely blocked on the client (awaiting feedback, assets,
    approvals). Essential for fairness, and load-bearing once SLAs feed
    performance.

-   Revision allowance before the deadline renegotiates (bounding
    otherwise-unbounded revision cycles).

-   Breach handling (hard breach vs. warning vs. queue-priority effect).

-   Billing linkage (fixed-price vs. time-and-materials).

**Engine:** categorized SLA profiles, deadline derivation,
pausable/attributable clock, revision bounding, breach handling.

**Surface --- creative:** sees a due date, already filled in, and a way
to flag \"blocked on client.\" SLA configuration is invisible.

**Surface --- team lead:** sees SLA and breach status across the team
--- this is where the clock becomes an accountability tool.

**Surface --- booker:** sees nothing SLA-related; the due date is
derived automatically at booking.

**Surface --- admin:** configures SLA profiles once, at setup.

**5.5 SLA → performance & rewards**

SLA outcomes are intended to feed the employee performance and rewards
system. This raises the stakes on the data model and imposes
requirements the operational-only version would not have:

-   **Clean, fair attribution** --- every unit of elapsed time on a job
    must be attributable to a responsible party (assignee / client /
    dependency / approver). Performance scoring counts only time
    genuinely in the assignee\'s court. This is why the pausable clock
    matters more, not less, once pay is involved.

-   **Immutability & auditability** --- once outcomes affect rewards,
    records become contestable. SLA events likely need to be an
    append-only log: when the deadline was set and by whom, whether it
    changed, when the clock paused and why, when delivery occurred.

-   **Aggregation model (policy, not engineering)** --- how individual
    outcomes roll into a performance metric (% met, weighted by
    importance, near-miss vs. severe miss, whether beating a deadline
    earns credit). The data model must be granular enough to support
    whatever policy is chosen.

-   **Anti-gaming counterweights** --- measuring on a metric invites
    optimizing the metric (padded estimates, gamed pause states,
    avoiding hard jobs, rushing quality). The system should make gaming
    visible even where it cannot prevent it; pause-state changes and
    deadline changes should be logged as visible, reversible claims
    rather than silent edits.

+-----------------------------------------------------------------------+
| **Open decision --- deadline authority & pause states**               |
|                                                                       |
| For bespoke jobs, who may set or change the deadline, and does a      |
| change after work starts get recorded as a scope-change event         |
| (protecting the assignee\'s score) rather than a silent edit? And are |
| pause states self-service, or do they require approval/evidence?      |
| Direction leaned toward: self-service to log, but logged as a         |
| visible, reversible claim a manager can override.                     |
+-----------------------------------------------------------------------+

**6. Dashboards & Workflow Surfaces**

Dashboards are how the accountability engine becomes visible and
actionable. They are not primarily reporting screens; for most users
they are action surfaces --- the place each person starts, telling them
what needs doing and who to talk to. This is the role-scoped-interfaces
principle (Section 2) expressed as the day-to-day entry point to the
system.

**6.1 Three tiers of dashboard**

All three tiers are the same underlying data at different altitudes.
Nothing is separately tracked or entered; each tier is a different view
of the same bookings, SLA clocks, and attribution.

  -----------------------------------------------------------------------
  **Tier**        **For**                 **Answers**
  --------------- ----------------------- -------------------------------
  Action surface  The individual doing    What is on my plate, in what
                  the work                order, and what is at risk?

  Exception feed  Team leads (oversight)  What needs my attention now,
                                          and who do I talk to?

  Health view     Department & senior     How are we doing overall, and
                  management              where are the structural
                                          problems?
  -----------------------------------------------------------------------

**6.2 Tier 1 --- the individual action surface**

Each contributor\'s active work, ordered by urgency: approaching
deadlines, anything they have flagged as blocked, and items waiting on
them (an approval to give, feedback to return). The engine already knows
all of this from the SLA clock and capacity model; the dashboard
presents the person\'s slice and nothing else.

**Engine:** per-person aggregation of active work, deadline proximity,
block states, and pending items owned by this user.

**Surface:** a short, ranked list of what to do next. Healthy,
not-yet-urgent work stays quiet.

**6.3 Tier 2 --- the oversight exception feed**

For team leads, the dashboard is an exception feed, not a wall of
everything. Its job is to compress many live items into the few that are
off-track or waiting on the lead. Healthy work stays invisible; only
amber and red surface.

What surfaces: approaching or breached deadlines, pending approvals in
the queue, people over their capacity ceiling, work stalled in a blocked
state, and unassigned work. **Every concern names a person and a next
action.** Not "this is late" but "this is late, waiting on X\'s
approval, \[open\]." The attribution built for fair performance
measurement (Section 5.5) is exactly what powers "who to talk to" ---
the same data, a second use.

Items are ranked by *how much attention they need now* --- severity and
time, not chronology. A breached hard deadline for a key client outranks
a soft internal one. This ranking is a real design decision and a place
where defaults matter.

+-----------------------------------------------------------------------+
| **The principle that makes this usable**                              |
|                                                                       |
| Exception-first, not everything-first. Health is the quiet default;   |
| the dashboard earns attention only for what is off-track. If a        |
| lead\'s dashboard ever shows all their team\'s work rather than just  |
| the exceptions, it collapses into noise. "Comprehensive" for          |
| oversight roles means comprehensive coverage of problems, not         |
| comprehensive display of everything.                                  |
+-----------------------------------------------------------------------+

**Engine:** exception detection across the team (deadline proximity,
approval age, capacity breach, block state, unassigned), with
attribution and severity ranking.

**Surface:** a ranked feed of only the items needing the lead\'s
attention, each with the responsible person and a direct action.

**6.4 Tier 3 --- department & company health**

The one genuinely dashboard-like surface in the reporting sense: a
standing picture of how things are, not just what is on fire. Persistent
and diagnostic where the exception feed is transient and
action-oriented. Health is an aggregation of the same signals rolling up
from below, not a new dataset.

**Department health**

On-time delivery rate, proportion of work at-risk or breached, approval
throughput (are approvals moving or bottlenecking), capacity load across
the team (chronic overload vs. slack), and volume of blocked or stalled
work. A department reads green when these sit in healthy ranges,
amber/red as they drift.

**Company health**

The same indicators aggregated across departments, plus cross-department
patterns: which departments are consistently at risk, where the systemic
bottlenecks are, whether the organization as a whole is meeting its
commitments. One screen answering "is the organization delivering, and
where are the structural problems?"

**6.5 The unifying principle --- same data, different altitudes**

An individual\'s blocked task becomes an exception on their team lead\'s
feed, becomes a data point in that department\'s "% work blocked" health
metric, and rolls into the company\'s overall delivery-health picture.
One event, surfaced appropriately at every level. Because every tier
reads from the same source --- the individual bookings and SLA clocks
--- the CEO\'s health view and the contributor\'s task list can never
disagree. Drill-down runs the whole way: from company health, into the
department driving an amber reading, into the specific exceptions behind
it, down to a single blocked task and the person responsible. That
end-to-end drill-down through the same attribution is what makes health
actionable rather than merely informational.

**6.6 Keeping health honest**

Health must stay diagnostic, not a vanity metric. The value is in
showing amber and red truthfully so problems get addressed; the
temptation is to make everything look green. There is also a governance
risk that mirrors the SLA-to-rewards caution (Section 5.5): once
department and company health are visible to leadership, they become a
*de facto* measure of leads and departments, which invites optimizing
for green rather than for honest delivery. The health view should
therefore be designed to make hidden problems *more* visible, not less,
and leadership norms should treat an honest amber as better than a fake
green.

+-----------------------------------------------------------------------+
| **Open decision --- how exceptions are triggered**                    |
|                                                                       |
| Some triggers are objective and automatic (deadline within X hours,   |
| approval pending \> Y hours, capacity over ceiling). Others are       |
| judgment calls --- can a person manually flag something as at-risk    |
| before the clock says so? Direction leaned toward both: automatic     |
| triggers as the baseline, plus a manual flag that itself becomes an   |
| exception on the lead\'s feed, since people often know something is   |
| going wrong before the metrics do.                                    |
+-----------------------------------------------------------------------+

**7. Real-Time Collaboration, Chat & Huddles**

Chat in this platform is contextual, not generic: a conversation is
attached to the work it concerns --- a booking, a job, an approval, an
SLA breach. This turns the dashboard\'s "who do I talk to about this?"
into "talk to them, here, on the thing itself," and the conversation
about a delay becomes part of that item\'s history. Generic chat is a
commodity; chat bound to the accountable object is the differentiator.

**7.1 Delivery approach --- Supabase Realtime, consolidated**

The direction is to build real-time chat on Supabase rather than
introduce a second backend. Two known Supabase Realtime pitfalls are
addressed head-on by design:

-   **Subscription fan-out / cost** --- the failure mode is one
    subscription per booking/job/thread, which grows connection count
    and cost rapidly for a dashboard-driven app with threads everywhere.
    The design instead consolidates: a small, roughly constant number of
    channels (per tenant or per active project) carry many threads,
    filtered client-side by which item a message belongs to. Aligning
    the real-time boundary with the tenancy/project boundary also keeps
    the security story clean.

-   **Reliability** --- the real-time layer is treated as delivery, not
    the source of truth. Messages persist to a Postgres messages table
    (the durable, auditable record the accountability model wants
    anyway); Realtime only delivers the live nudge that a new message
    exists. A dropped frame becomes a cosmetic re-fetch from Postgres,
    never lost data.

**Engine:** messages persisted in Postgres with tenant/project/item
association; consolidated Realtime channels for live delivery and
presence.

**Surface:** a thread appears in place on the item it concerns; users
see live messages without any awareness of channels or subscriptions.

**7.2 SpacetimeDB --- considered and set aside (documented escape
hatch)**

SpacetimeDB was evaluated as a dedicated real-time layer. It genuinely
excels at high-frequency shared state with efficient subscription
fan-out, which maps to the concerns above. It was set aside for v1
because it introduces a **second backend** --- a parallel data store
with its own model, hosting, module language, and security model --- and
therefore a synchronization seam between it and Postgres that must
re-derive tenant/RLS rules in a separate permission model. For a solo
developer with a commercialization path, betting a core subsystem on a
younger, smaller-ecosystem platform is a real risk. The lower-risk path
keeps everything on one backend and inherits existing RLS and tenant
isolation.

+-----------------------------------------------------------------------+
| **Escape hatch --- the trigger to revisit SpacetimeDB**               |
|                                                                       |
| If subscription consolidation on Supabase proves insufficient at      |
| scale --- i.e. connection/cost ceilings are still hit after channels  |
| are consolidated to per-tenant/per-project, or genuinely real-time    |
| collaborative features beyond chat (live multi-user editing,          |
| presence-heavy interactions) become requirements --- SpacetimeDB is   |
| the documented fallback for a dedicated real-time layer, scoped       |
| narrowly to live transport and presence, with Postgres remaining the  |
| system of record. Confirm consolidation has actually been tried       |
| before taking on a second backend.                                    |
+-----------------------------------------------------------------------+

**7.3 Cross-tenant threads**

On a joint project (Section 10), a thread may be cross-tenant ---
visible to both the host and invited tenants --- while other threads on
the same project remain internal to one tenant. Thread visibility
therefore follows the same granular sharing rules as the rest of
joint-project data, and is one of the access paths that warrants extra
review, since a mis-scoped thread is a cross-tenant leak.

**7.4 Huddles --- voice, screen share & the audio record**

+-----------------------------------------------------------------------+
| **Why this is accountability infrastructure, not a convenience        |
| feature**                                                             |
|                                                                       |
| **Decisions are made in conversation. Today those conversations       |
| happen in Teams, WhatsApp and hallway calls, and leave no trace       |
| against the work they decided. A huddle recording attached to the     |
| deliverable is the decision record --- that is the reason to build    |
| it.**                                                                 |
+-----------------------------------------------------------------------+

A huddle is a **contextual voice session attached to an entity** --- a
deliverable, stream, campaign or ad-hoc job --- not a meeting with a
dial-in and a calendar invite. It carries voice, optional screen share,
and by default an audio recording. The context is the whole point: you
huddle on something, and what was said lands against that thing. This is
§7.1's contextual-chat principle extended from text to voice, not a
separate product bolted alongside it.

**Woven into the thread, not parallel to it**

A huddle starts from the thread on the item and returns to it. The
recording drops back into the same thread as an artifact in sequence, so
the conversation reads continuously: text, then a huddle entry
(duration, participants, recording), then text resuming. Voice becomes
another message type on the existing timeline rather than a second
channel to check. The practical effect is that the decision made in
voice sits in the same place, at the same point in time, as the text
either side of it --- which is precisely what the current toolchain
cannot do.

**Ad-hoc vs. scheduled --- two different things**

-   **Ad-hoc huddles are part of the workflow.** Someone starts one on a
    deliverable and participants are notified. This is the digital
    equivalent of turning to the person next to you, it is the common
    case, and it is not scheduled, not booked, and not counted as
    consumed time. Treating it otherwise would tax the thing we want
    people to do.

-   **Scheduled huddles are planned and tracked.** A start time,
    invitees, and a place on the calendar surface alongside work. These
    are the ones that eat the week.

The design decision that matters: a scheduled huddle is **tracked but
not blocking**. It does not enter the confirmed state and does not
consume capacity in the booking model (§4.2) --- it will not prevent
work being scheduled over it. It is recorded and surfaced so that
scheduled-huddle time can be measured against delivery time. The
question this answers is diagnostic, not gating: how much of a team's
week is going into scheduled calls, and does that correlate with streams
running late? That is a metric nobody can produce today because the
calls live in one system and the work in another. Making it a blocker
would import a scheduling fight the platform does not need; making it
invisible would waste the one thing consolidation buys.

**The audio record --- default on, opt-out audited**

-   **Recording is on by default** for huddles, audio-first. Screen
    share is recorded only when explicitly enabled --- video egress
    costs materially more in CPU and storage, and the accountability
    value is in what was said and agreed.

-   **The huddle creator can turn recording off** --- and that act is
    itself logged and auditable. The escape hatch exists, but it leaves
    a trace. Someone may hold a private conversation; they may not hold
    an invisible one. This is the accountability model applied to its
    own opt-out.

-   **Consent is explicit** --- notice on join and a visible indicator
    for the duration of the session, for every participant including
    external ones. This is not a nicety: huddles will carry client
    voices across several jurisdictions.

-   **Playback rights are set per huddle** --- all participants on the
    parent entity, or a named subset. Rights are set at creation and
    enforced by RLS like any other artifact, so a recording on a joint
    project respects the same per-field boundaries as everything else
    (§10.4).

-   **Retention follows the §8.3 media lifecycle** --- huddle audio is
    media and ages through the same hot / cold / proxy-only tiers as any
    other asset. No separate retention regime, no special-case storage
    policy.

**Delivery approach --- LiveKit, self-hosted**

LiveKit is the direction. It is Apache 2.0, self-hostable with no
per-user or per-minute fee, and its Egress service writes recordings
server-side to S3-compatible storage --- which is Backblaze B2 (§3).
That last point is why it fits rather than merely qualifies: the
recording lands in the existing storage lifecycle, keyed on the existing
hierarchy, without a bridge. Participant tokens are JWTs minted by a
privileged route from Supabase auth --- the same pattern as the
Collabora WOPI token (§8.4), so the permission model reaches the media
layer without a second identity system.

The alternatives were considered. Jitsi Meet is mature and embeddable,
but it is a meeting product joined by iframe rather than primitives to
build with, its Jibri recorder runs a Chrome instance per recording, and
branding overrides break on upgrade. Galene is the simplest thing
available (a single Go binary) but recording is left to external
tooling. mediasoup is a library, not an application --- maximum control,
and a WebRTC engineering project this team does not have capacity for.
The general finding holds: the cheapest options by licence become the
most expensive once development time is counted. LiveKit is chosen
because the UI is built from SDK primitives, so a huddle attached to a
deliverable looks and behaves like part of the platform rather than a
guest inside it.

+-----------------------------------------------------------------------+
| **Open --- huddle operational detail**                                |
|                                                                       |
| TURN/coturn is the real operational risk and is on us to run:         |
| corporate firewalls are where WebRTC fails, and clients joining from  |
| restricted networks are the exact case that must work. Egress is a    |
| separate service with its own resource appetite, not a configuration  |
| flag. Untested at this stage --- unlike Collabora (§8.4), no fidelity |
| or connectivity test has been run. Logged as Open Decisions 27--28.   |
+-----------------------------------------------------------------------+

**8. Briefs, Media Review & Storage**

This section covers how work is specified (the brief system), how
creative deliverables are reviewed inside the platform, and how media is
stored affordably without losing the history the accountability model
depends on.

**8.1 The brief system --- three phases, campaign hierarchy**

The organization\'s existing brief templates (eight discipline-specific
forms) collapse into a three-phase lifecycle rather than eight parallel
types. The eight are phases of work, not a flat taxonomy:

-   **Concept** --- a piece of work is specified and thought through.
    Either a 360 campaign (which spawns multiple discipline streams) or
    a standalone single-discipline brief (social, production,
    influencer, activation, performance).

-   **Execution** --- a specific deliverable is produced. The
    lightweight single-task form.

-   **Feedback** --- an existing deliverable is revised. Carries
    revision round and feedback source (client / internal / both).

This is a lifecycle, not a filing scheme: work is briefed, made, and
revised --- Concept → Execution → Feedback → (loop until approved). That
loop is the SLA revision-bounding and pausable-clock model made
concrete.

**Campaign → Stream → Deliverable**

A 360 campaign is a parent that spawns discipline streams, not one of
the disciplines. The clean hierarchy:

-   **Campaign** holds the strategic core once --- brand, audience,
    insight, proposition, omni-channel journey, campaign deadline.
    Authored a single time.

-   **Streams** hang off it and inherit the strategy automatically,
    adding only their discipline-specific fields. Stream types are the
    work types (Section 5): social, production, influencer, activation,
    performance --- each with its own SLA profile, KPIs, and owners.

-   **Deliverables** are the individual items produced within a stream,
    executed and revised via the Execution and Feedback phases.

The payoff is coherence by construction: the proposition is defined once
and every stream reads from it, so it cannot drift across parallel
documents. It also collapses effort --- the shared header and strategic
spine are entered once, not once per stream. Crucially, this hierarchy
*is* the project/work structure the scheduling and dashboard layers
already need: a campaign is a project, streams are bundles of
schedulable work, and campaign health rolls up from stream health
(Section 6).

**Every campaign carries a campaign calendar**

Each campaign automatically owns a campaign calendar --- created with
the campaign, not a separate object anyone sets up or opts into. It is a
shared, cross-team surface --- available to every team working the
campaign, not tied to any single discipline. It is the schedule of that
one campaign's work: its streams and their deliverables laid out in
time, from each item's commence-by date through its milestones to its
go-live. The calendar is assembled, not authored --- the same brief data
and per-work-type SLA lead times that already drive scheduling (Section
5.4) populate it --- so it exists the moment the campaign is briefed and
stays current as deliverables move.

This is deliberately separate from the planning calendar (Section 10.2),
because the two answer different questions. The planning calendar is a
forward-looking, cross-campaign instrument for a whole client
relationship: what is coming across the year, and by when must each
brief land. The campaign calendar is scoped to a single campaign already
in motion: what is the schedule of everything being made here, and how
is it tracking. Keeping them distinct stops the planning surface from
drowning in per-deliverable detail and gives each campaign a natural
home for its own timeline.

The two are connected by reference, not by synchronization. A campaign
that originated from a planning-calendar entry carries a link back to
that entry --- and the entry can point forward to the campaign it
spawned --- so anyone can move between "the slot we agreed for the year"
and "the campaign as it is running." The link is contextual only:
following it navigates between the two views, but each calendar keeps
its own dates. Moving a milestone on the campaign calendar does not
silently rewrite the agreed planning date, and re-agreeing a planning
date does not reach in and reschedule live work. This preserves the
planning calendar as the record of what the client committed to (Section
10.2) while letting the campaign schedule flex as real production does.

**Engine:** a campaign-scoped calendar view projected over the
campaign's existing streams, deliverables, milestones and SLA-derived
dates, plus an optional reference to the originating planning-calendar
entry. No new scheduling data is stored --- it reads what the brief and
SLA engine already hold.

**Surface --- every team working the campaign:** the campaign calendar
is a shared surface, not a single-discipline or account-management tool.
Every team on the campaign --- creative, production, performance
marketing, influencer, and the account manager --- reads the same
campaign timeline of streams, deliverables, commence-by dates,
milestones and go-live, so cross-stream dependencies and hand-offs are
visible to everyone delivering it. What stays role-scoped is the detail
beneath the dates: a team sees the whole campaign's schedule but not
another team's internal capacity, SLA clock, or performance (Section
2.3). The calendar is read-only for the delivery teams --- dates change
only by moving the underlying booking or deliverable in a team's own
surface. The account manager is the single role that can adjust
milestone and go-live dates directly on the campaign calendar; every
other team reads them.

**Surface --- client (portal):** a client-shareable view of the campaign
schedule, surfaced in the portal alongside the planning calendar and
stripped to client-facing milestone and go-live dates, never internal
working deadlines or the SLA clock (Section 10.2).

**Rule: one campaign per stream (with a bounded exception)**

A stream belongs to exactly one campaign --- a clean parent-child rule
that keeps inheritance, roll-up, and dashboards unambiguous. Two
real-world realities are handled without breaking it:

-   **Shared brand assets** --- assets (logos, fonts, guidelines, key
    visuals) live at the brand level, above campaigns, and are
    referenced (not copied) by campaigns, streams, and deliverables.
    Same pattern as the resource model: owned once, referenced many
    times, so updates propagate and nothing goes stale. Cross-tenant
    visibility still applies --- an invited tenant sees only assets
    shared into the joint project, not the host\'s whole library.

-   **Rare cross-campaign work** --- when a stream\'s output serves two
    campaigns, the output (an asset) is shared via the brand library;
    the work itself still belongs to one campaign. True multi-parent
    stream co-ownership is deferred as a rare case, revisited only if
    real demand proves it common --- never letting the rare case reshape
    the common model.

**Ad-hoc jobs --- discrete work outside the campaign structure**

Not all work is briefed through a campaign or a discipline brief. A
great deal of real agency work is **discrete**: a minor edit to
something already shipped, a single piece of artwork, preparing a brief,
a small job that does not warrant a full template. An ad-hoc job is a
first-class job type for exactly this work.

**Ad-hoc is a job type, not a fourth phase.** The three phases describe
how briefed work moves (Concept → Execution → Feedback); ad-hoc
describes work that does not need that ceremony. It can contain any
phase --- preparing a brief produces a Concept, so it cannot sit inside
one --- which is why it sits alongside the lifecycle rather than within
it.

The structural rule is that ad-hoc hangs off the client and carries
optional links rather than a structural parent:

-   **Optional campaign link** --- set when the job relates to a
    campaign, so cost and utilization roll up to it; null when the work
    is genuinely standalone.

-   **Optional source-deliverable link** --- set when the job acts on
    existing work (a revision, a later phase). The output becomes a new
    version in that deliverable's lineage, while the job that asked for
    it keeps its own owner, clock and finance line. Version lineage and
    job lineage are different axes and are not conflated.

-   **Both null** --- a discrete piece of work with no campaign and no
    antecedent. This is a normal case, not an error state.

An ad-hoc job is a full accountability citizen: it carries a work type,
an owner, an SLA clock, deliverables, and a line in the finance export,
exactly as briefed work does. This is the point. Small discrete jobs are
precisely where accountability leaks today --- no brief, no clock,
someone simply does it --- so putting them outside the SLA engine would
leave a hole in the thing the platform exists to close. The ceremony is
lighter; the accountability is not.

+-----------------------------------------------------------------------+
| **Design note --- ad-hoc and the rare-case rule**                     |
|                                                                       |
| Ad-hoc is not an exception carved out of the campaign model; it is a  |
| third shape alongside the 360 campaign (many streams) and the         |
| standalone single-discipline brief. All three hang off the client,    |
| all three carry work types and SLA clocks, and all three roll up.     |
| What varies is the ceremony required to start one and whether the     |
| optional links are set. The common model is not reshaped by it.       |
+-----------------------------------------------------------------------+

**8.2 Media review & annotation**

Creative deliverables --- static images and video --- need in-platform
review and feedback. The strategic reason to build rather than buy: the
review data (comments, revision rounds, client-vs-internal attribution)
must live inside the accountability model, which no external tool does
because none has the SLA/attribution spine. Review is scoped in tiers:

-   **Tier 1 --- attach & comment** (easy): display media on a
    deliverable, comment underneath. Reuses the contextual-chat layer;
    effectively free once chat exists.

-   **Tier 2 --- positional feedback** (the target): pinned x/y comments
    on images, timecoded comments on video ("at 0:14 the logo is wrong"
    --- click to seek). This is what the Feedback brief implies and
    covers the vast majority of real need. It is a few extra fields on
    the feedback record (timecode, coordinates, resolved-state), not a
    new subsystem.

-   **Tier 3 --- frame accuracy, drawing, pro formats** (deferred): true
    frame-precise stepping, freehand annotation, and professional-codec
    handling. Each is a discrete, harder chunk added only where
    genuinely needed.

**Engine:** media records with per-deliverable version chain; feedback
records carrying timecode/coordinate, round, source, resolved-state; all
tenant-isolated by RLS.

**Surface --- reviewer:** watch or view in the browser, click to leave a
pinned/timecoded comment. No tooling to learn.

**Surface --- maker:** click a comment to jump to the exact frame or
spot; see rounds and status inline.

+-----------------------------------------------------------------------+
| **Escape hatch --- Frame.io for frame-accurate video**                |
|                                                                       |
| Frame.io is the professional standard for frame-accurate video        |
| review, with deep Adobe/Premiere integration this platform will not   |
| attempt to match. Direction: build Tier 2 image and lightweight video |
| review in-house (review data stays in the accountability model), and  |
| treat Frame.io as a link-out for deliverables that genuinely need     |
| frame-precise review. Design the media record so a deliverable can    |
| either be reviewed in-app or carry a link to an external review tool  |
| --- never forcing a rebuild of Adobe-grade tooling. Frame.io          |
| reviewers/clients are free; internal seats are paid, and true API     |
| integration may require its Enterprise tier --- so loose coupling     |
| (link-out) is the low-cost default, deep API integration only if      |
| pulling review status into the accountability dashboard later proves  |
| worth it.                                                             |
+-----------------------------------------------------------------------+

**8.3 Storage & the media lifecycle**

Storage is where costs concentrate, especially for video, along two
axes: volume (masters are gigabytes) and egress (review means the same
file streamed repeatedly). The resolving insight is that history splits
into two very different things:

-   **Metadata history is cheap and permanent** --- the record of what
    happened (versions, comments, attribution, rounds, deadlines,
    approvals) is text in Postgres. Kept forever at negligible cost.
    This is the accountability history, and none of it is at risk.

-   **Media history is expensive --- so it is tiered** --- heavy files
    are not kept hot forever. Active (in-review) media sits in hot
    storage; approved masters move to cheap cold storage; superseded
    intermediate versions keep a lightweight proxy (the web-playable
    preview) while the full master is archived or dropped after a
    retention window. You keep visual history at a fraction of the cost.

Provider direction: keep Supabase/Postgres as the system of record, but
**decouple media storage behind a swappable media record** (provider +
key + URL + storage-tier + retention-state). Heavy media goes to
egress-cheap object storage --- Backblaze B2 or Cloudflare R2, ideally
fronted by a CDN so egress cost effectively disappears --- rather than
Supabase Storage, whose egress pricing bites hardest exactly on repeated
review streaming. A nightly job transitions media between tiers by
deliverable status and age, mirroring the exception-detection job.
YouTube is suitable only for referencing already-public final videos,
never for confidential in-progress review (no timecoded feedback, weak
privacy, no versioning).

+-----------------------------------------------------------------------+
| **Open decisions --- media retention & formats**                      |
|                                                                       |
| Two agency inputs set the policy. (1) Master retention: how long      |
| client contracts and legal obligations require the actual delivered   |
| master to be reproducible --- this sets the cold-storage window; past |
| it, proxy-only. (2) Intermediate versions: whether full masters of    |
| rejected intermediate cuts must be kept, or only approved finals as   |
| masters with intermediates as proxies --- the single biggest storage  |
| variable. (3) Upload formats: whether editors upload web-ready MP4    |
| (small bespoke layer, maybe no transcoding) or raw masters like       |
| ProRes (needs a transcoding step, or lean on Frame.io for video) ---  |
| this decides whether the build is "small bespoke" or "small bespoke   |
| plus a transcoding pipeline."                                         |
+-----------------------------------------------------------------------+

**8.4 Collaborative deck editing --- Collabora Online**

+-----------------------------------------------------------------------+
| **The problem this closes**                                           |
|                                                                       |
| **The deck is currently the workflow engine. It holds the brief,      |
| collects multi-person input, carries feedback, and ships to the       |
| client --- while being terrible at all three of the jobs that are not |
| \"be a deck\".**                                                      |
+-----------------------------------------------------------------------+

Today an art director builds a bespoke deck template per job in
PowerPoint, the team contributes to it simultaneously on separate
slides, and the completed deck goes to the client. That loop works and
is not the problem. The problem is everything around it: no version
control, no attribution, no record of whether feedback was addressed, no
visibility of what was approved or what the client actually received.
The deck doubles as the version-control system, the comment thread, and
the delivery mechanism.

**The options were weighed and most were rejected.** Generated decks
(pptxgenjs) cannot produce client-ready bespoke art direction. A
templated in-platform slide editor fails because the AD builds novel
layouts per job and needs real creative freedom --- that is a design
tool, not a form. Upload-a-version plus manual assembly adds a step and
removes the parallelism the team currently relies on. Linking out to a
file leaves version control manual and puts the artifact outside the
audit trail --- the same sticky-tape-between-tools pattern this platform
exists to remove. Penpot is a genuine design tool with a real API and
webhooks, but has no supported embed path (only an undocumented
development-only CORS flag), so it can only sit alongside as a second
system.

**The approach --- the deck lives in the platform**

Collabora Online is an open-source (MPL 2.0) document editor designed to
be integrated into a host application. It runs as a container, edits
documents from the host's own storage over the WOPI protocol, and
renders into an iframe. Crucially it shares rendered tiles --- pixels
--- rather than the document itself, and stores no data of its own. This
means the deck can be edited, by several people at once, inside the
platform, behind the platform's auth, on the platform's storage, under
the platform's version control.

**Validated by test:** a real bespoke Meridian deck was opened in Collabora
against a WOPI host. Layout, dark background art, layered motifs, image
stacks and footers rendered correctly; brand fonts resolved from the
deck without substitution; editing worked; and the deck round-tripped
--- saved from Collabora and reopened in PowerPoint without degradation.
Fidelity was the make-or-break risk and it passed.

**How it maps onto the architecture**

-   **WOPI host = Vercel API routes** --- Collabora fetches and returns
    the file through a small set of endpoints. This is the
    privileged-route pattern already in §3.1; the token is a Supabase
    JWT, and the storage denies a wrong token, which is exactly what the
    protocol requires.

-   **Storage = B2, keyed on the hierarchy** --- the file is an object
    under the campaign/stream/deliverable path, not a folder someone
    invented. Structure comes from the brief, not from filing.

-   **Version on save** --- Collabora returns the file on save; the host
    writes a new object and a new version row (deliverable, version,
    author, timestamp) rather than overwriting. Version history becomes
    real data instead of the storage provider's side-effect.

-   **Permissions = CheckFileInfo** --- the endpoint reports per-user,
    per-deliverable rights, so RLS reaches into the editor: a
    contributor writes, a client reviewer does not, and named cursors
    come from the same call.

-   **The AD keeps PowerPoint** --- the bespoke template is authored in
    the AD's real tool and uploaded as the first version. Nothing about
    creative freedom changes; the platform takes custody from that
    point.

Licensing matters here and is the reason this is viable. Collabora
Online is MPL 2.0 with no user limits and no feature restrictions in the
community edition; the paid subscription (€3/user/month) buys support,
SLA, signed security updates and maintenance --- not the software. The
10-document / 20-connection cap frequently cited is a property of the
convenience CODE Docker image, not the licence. Self-hosting from source
carries no per-user fee, which matters given that per-resource pricing
is the reason this platform is being built rather than bought.

**Slide-level edit attribution --- the upstream patch**

Version-on-save answers who saved and when. It does not answer **who
edited which slide** --- because the person whose client triggered a
save is not necessarily the person who made the change. With several
contributors in one session and Collabora auto-saving periodically, a
file diff attributes every changed slide to whoever's save happened to
fire. That is not an audit trail; it is a guess with a name on it.

This matters because the requirement is an audit trail, not a
convenience. An audit record that is inferred fails precisely in the
case it exists for --- a disputed change, where the inference is what
gets challenged. Either the record is authoritative or it is not worth
holding.

Three routes were investigated and closed:

-   **Native track changes --- not available.** LibreOffice records
    insertions, deletions and formatting changes with per-user
    attribution, but only in Writer and Calc. Impress has no
    track-changes; the upstream request (TDF bug 95978, open since 2016)
    is reported as not planned. This route works for .docx and .xlsx and
    does not exist for .pptx.

-   **PostMessage API --- wrong granularity.** Collabora's documented
    host-to-editor channel exposes document lifecycle and UI actions
    (Document_Loaded, Document_Modified, Session_Closed, User_Idle,
    UI_SaveAs and similar). Document_Modified reports that the document
    changed; it does not report which slide, or by whom. It is a UI
    integration surface, not an edit-event stream.

-   **Session correlation --- inference, not record.** Knowing who is in
    the session, forcing a save, and diffing slideN.xml attributes
    changed slides to whoever was active. Exact when editing is serial;
    a guess when it is simultaneous. Adequate for "who last touched
    this", inadequate for audit.

**The route that works is a patch.** Collabora Online is MPL 2.0, and
the data already exists inside the server: per-user edit identity is not
an optional extra but a precondition of co-editing --- the server must
know who made each change in order to broadcast it to everyone else.
What is missing is anything emitting that outward. The patch therefore
adds emission rather than behaviour: a hook that fires a webhook to the
platform on each edit, carrying user, document, slide and timestamp,
which lands as an audit row alongside every other event in §5.5.

A narrower version is likely sufficient and materially smaller: emit
which slide changed and who touched it, on a short interval, rather than
every keystroke. The requirement is "Ali revised slide 12 this morning",
not an input log. Scope the patch to that.

**Costs, stated plainly.** This is a C++ patch to a codebase this team
does not own, carried across every upgrade --- rebasing, not pinning. It
forces the source-build route and therefore settles Open Decision 26 by
removing the choice. The mitigation worth attempting is upstreaming:
"emit edit events for integrators" is plausibly wanted by other
integrators, and if accepted, maintenance stops being ours. The
prerequisite to scoping is establishing what the server actually knows
at the point of broadcast --- LibreOfficeKit's internal edit granularity
may be object- or coordinate-level, with slide identity derived rather
than given. That is answerable by reading the source, and should be
answered before any estimate is offered.

+-----------------------------------------------------------------------+
| **Decision --- slide-level attribution is a patch, not a              |
| configuration**                                                       |
|                                                                       |
| Audit-grade per-slide, per-user attribution is not available from     |
| Collabora as shipped, via track changes (Writer/Calc only), or via    |
| PostMessage (wrong granularity). It requires patching the server to   |
| emit edit events --- permitted by MPL 2.0, small in principle because |
| the data already exists, and carrying a real ongoing maintenance      |
| cost. Accepted on the grounds that the requirement is an audit trail  |
| and an inferred audit trail is not one. Logged as Open Decision 29.   |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Open --- Collabora operational detail**                             |
|                                                                       |
| Resolved by test: fidelity, font resolution, and PowerPoint           |
| round-trip. Still open: version granularity (Collabora saves          |
| periodically during a session, so a one-hour session with five        |
| contributors produces many save callbacks --- versions should almost  |
| certainly be collapsed per session rather than per save); whether to  |
| run the CODE image or build from source for production; and font      |
| installation into the container for any deck that does rely on        |
| non-embedded brand fonts. Logged as Open Decisions 25--26.            |
+-----------------------------------------------------------------------+

**9. Reference Architecture Mapping**

+-----------------------------------------------------------------------+
| **Licensing basis**                                                   |
|                                                                       |
| Both reference systems are copyleft (Worklenz: AGPL-3.0;              |
| LibreBooking: GPL-3.0). Given commercialization, neither is used as a |
| code foundation. They are **design references only**: patterns are    |
| studied and re-implemented clean. No source is copied. This keeps     |
| custom IP free of copyleft obligations.                               |
+-----------------------------------------------------------------------+

**9.1 LibreBooking --- booking / approval reference**

A mature, resource-first booking engine (descendant of Booked Scheduler
/ phpScheduleIt; PHP + MySQL). Its structure matches the resource-first
spine and offers proven patterns:

-   **Resource** as the central entity, grouped into resource groups and
    schedules (the bookable time grid).

-   **Reservation series vs. instance** --- the logical booking (with
    recurrence rules) is separated from each concrete occurrence. A
    pattern worth adopting for recurring bookings.

-   **Approval workflow** --- reservations may require approval before
    confirming; built in.

-   **Quotas & credits** --- booking limits per user/group over a
    period; a rate-limiting pattern potentially repurposable for
    capacity governance.

-   **Blackout periods** and role-based access control.

*Silent on: time tracking, billing, fractional capacity (resources are
pure exclusivity), SLAs, and performance. It is a booking engine only.*

**9.2 Worklenz --- timesheet / billing / utilization reference**

A project-first management platform (React + TypeScript + Express +
PostgreSQL). Shares this platform\'s language and database, so its SQL
schema is directly legible as a reference:

-   **Project → Task → Assignment** hierarchy --- a useful reference for
    how work links to people and time (though this platform inverts it
    to resource-first).

-   **Time entries / timesheets** --- the basis for both utilization and
    billing; the half LibreBooking lacks.

-   **Financial layer** --- budgets, costs, rates, profitability.

-   **Utilization via database views** --- utilization is computed, not
    stored; a pattern worth noting.

*Silent on: true booking/approval flow (it is assignment, not
reservation-with-approval), fractional-capacity ceilings, SLAs, and
performance linkage. Resource modeling is secondary to projects. Note
its logic-in-database style is deliberately **not** followed here (see
Section 3.1).*

**9.3 Capability matrix**

  -----------------------------------------------------------------------------
  **Requirement**           **LibreBooking**   **Worklenz**   **Your build**
  ------------------------- ------------------ -------------- -----------------
  Resource modeling         Yes --- central    Part ---       Ref: LibreBooking
  (resource-first)                             secondary      

  Booking + time-window     Yes --- mature     No             Ref: LibreBooking
  reservation                                                 

  Approval workflow for     Yes                No             Ref: LibreBooking
  bookings                                                    

  Recurrence (series vs     Yes --- clean      Part           Ref: LibreBooking
  instance)                                                   

  Blackout / unavailability Yes                Part           Ref: LibreBooking

  Time tracking /           No                 Yes --- strong Ref: Worklenz
  timesheets                                                  

  Billing / rates /         No                 Yes            Ref: Worklenz
  invoicing                                                   

  Utilization aggregation   Part --- reports   Yes --- views  Ref: Worklenz

  RBAC                      Yes                Yes            Either

  Fractional capacity +     No                 No             **Clean-sheet**
  ceiling                                                     

  Warn-and-allow            No                 No             **Clean-sheet**
  overbooking                                                 

  Categorized SLA engine    No                 No             **Clean-sheet**

  Pausable/attributable SLA No                 No             **Clean-sheet**
  clock                                                       

  SLA → performance /       No                 No             **Clean-sheet**
  rewards                                                     

  Accountability profiles   No                 No             **Clean-sheet**
  (multi-role)                                                

  Multi-tenancy             No                 No             **Clean-sheet**
  (commercialization)                                         
  -----------------------------------------------------------------------------

**9.4 Gap analysis --- the build scope**

The references cover the entire commodity layer and none of the
differentiators. This is the ideal outcome: it shows exactly where to
move fast on proven patterns and where the real design effort
concentrates.

**Borrowed-structure zone (fast, low-risk)**

Resource modeling, bookings, approvals, recurrence, blackouts,
timesheets, billing, utilization. Known patterns, implemented cleanly in
the Supabase schema. LibreBooking informs the booking half; Worklenz
informs the time/billing half.

**Clean-sheet zone (the IP --- where design effort concentrates)**

7.  Fractional capacity model --- per-resource capacity type with
    per-person ceilings and warn-and-allow.

8.  Categorized SLA engine --- work-type-driven profiles, hard deadlines
    with type-specific derivation, pausable/attributable clock.

9.  Accountability profiles --- the pluggable per-role measurement
    framework (creative-SLA, sales-target, event-coverage, response-SLA,
    none).

10. SLA-to-performance linkage --- attribution, append-only audit trail,
    aggregation policy, anti-gaming counterweights.

11. Multi-tenancy --- tenant isolation via RLS, threaded through every
    table from day one.

*The absence of any open-source precedent for these is a positive signal
for commercialization: they are precisely what existing tools do not
do.*

**9.5 Finance integration --- the Odoo export**

The finance questionnaire (completed by A. Sye, Finance Lead) resolves
how this platform meets Finance and settles Open Decision 8. **Finance
does not want the platform to be a billing engine.** Finance runs Odoo
and re-keys project data by hand today because projects run without
Finance visibility, so hours and costs are chased after the fact. The
platform's job is to remove that manual step: it is a data producer that
feeds Odoo, not a replacement for it.

Odoo codes projects, clients, and cost centres as **Analytic Accounts**.
This is the one hard mapping requirement: tenant, client, campaign and
project records each carry an optional analytic-account code so an
export reconciles against Odoo without hand-matching. No fixed import
template or code format is mandated yet (Finance answered "nothing
specific required currently"), so the field is nullable free-text now
and can be tightened to a validated format once Finance confirms it.

The export carries exactly the data points Finance asked for --- and
deliberately omits the ones it did not:

  -----------------------------------------------------------------------
  **Data point (requested by Finance)** **Export handling**
  ------------------------------------- ---------------------------------
  Hours worked, per job / project       Aggregated from time entries;
                                        per-project totals.

  Hours worked, per person              Per-person line within each
                                        project.

  Cost of work done (labour)            Hours × internal cost rate per
                                        resource.

  Client / customer per job             Client identifier, carrying the
                                        Odoo Analytic Account code where
                                        mapped.

  Rates charged                         External charge rate, per person
                                        / job / hour as applicable.

  Job / project completion status       Current status at export time.

  Who approved / signed off             Approver identity from the
                                        approval record.

  Dates work started and finished       Start and finish dates per job.
  -----------------------------------------------------------------------

**Explicitly out of scope, because Finance ticked "no":**
billable-vs-non-billable split, materials/equipment, deadlines met or
missed, and job notes or references. The deadline and SLA data that
dominates the accountability layer (§5) is not Finance's concern ---
finance and accountability stay cleanly separated, which keeps the
export narrow and the two models decoupled.

**Aggregation --- roll-ups, not raw entries**

Finance needs four roll-ups and explicitly not a per-time-entry dump: a
total per client, a total per job/project, a line per person, and
weekly/monthly summarisation. The export is therefore a set of database
views over the time and rate data --- the same computed-view pattern
already used for utilization (§9.2) --- not a raw timesheet feed.

**Delivery --- daily file, respecting the month-end lock**

Finance wants both an import file (CSV / spreadsheet) and a
human-readable report, delivered **once a day**. The hard constraint is
the close: figures must not change after month-end. The export therefore
honours a period-lock boundary aligned to Finance's close --- once a
period is locked, its exported figures are frozen, which fits the
append-only audit posture (§5.5) rather than fighting it.
Finance-related communication is to run through email or the approved
system only; accuracy, security, and a clean audit trail are the stated
concerns, reinforcing the §13 watch-items.

+-----------------------------------------------------------------------+
| **Resolved --- finance integration**                                  |
|                                                                       |
| No billing engine; the platform feeds Odoo via a period-locked export |
| (import file + readable report), keyed on Odoo Analytic Account       |
| codes, delivered daily and frozen at month-end close. The rate model  |
| carries two distinct rates per resource: an internal cost rate (for   |
| labour cost) and an external charge rate (for rates charged). Open:   |
| the exact Odoo import template/format, and whether the daily export   |
| is pushed on a schedule or pulled by Finance on demand --- logged as  |
| Open Decisions 23--24.                                                |
+-----------------------------------------------------------------------+

**10. Multi-Tenancy, Collaboration & Commercialization**

Because commercialization is in scope, the platform is a product serving
many organizations, not a single-org internal tool. Designed in from the
start rather than retrofitted, this shapes the schema and security model
from day one. The deployment reality gives this concrete shape: Meridian (a
creative agency) is the primary tenant, operating within Kite Group --- a
large conglomerate of companies (payments, logistics, e-commerce, media,
insurance, retail and more). Meridian does marketing work for Kite sibling
companies, which is exactly the collaboration the model must serve.

**10.1 Three relationship types --- do not conflate them**

The org context makes clear the system must represent three distinct
relationships, of increasing cost. Modelling the common one simply and
reserving the expensive machinery for the rare one is essential ---
treating every client as a full tenant would be serious
over-engineering.

  ---------------------------------------------------------------------------
  **Relationship**   **Who**                     **How modelled**
  ------------------ --------------------------- ----------------------------
  Primary tenant     Meridian itself                  The full home tenant: its
                                                 people, resources, work,
                                                 rates, performance.

  Client             Most Kite siblings (Kite Card,  A lightweight entity inside
                     Souqly, Mirage TV, the    Meridian\'s tenant --- who work
                     school chain, etc.)         is for. No cross-tenant
                                                 machinery. The common case.

  Peer tenant on     One or two Kite siblings that A full separate tenant,
  joint project      operate their own side      sharing a bounded joint
                                                 project with Meridian. The
                                                 invited-tenant model. The
                                                 rare, expensive case.
  ---------------------------------------------------------------------------

The distinction is: a **client** is who work is for (lives inside Meridian\'s
tenant); a **tenant** is an organization that operates in the system. A
Kite sibling is usually a client (simple), and rarely both a peer tenant
and a joint-project collaborator (the sophisticated model). The common
case stays simple; the rare case gets the machinery.

These three describe how organizations *relate* to the system. Cutting
across them is a separate question of *external access*: how a client
--- who by definition lives inside Meridian's tenant --- is given a narrow
window onto its own work without becoming a tenant at all. That is the
client portal (10.2), an access mode rather than a relationship type.

**Client vs. brand**

A client (e.g. Kite Card) is the organization work is for; a brand carries
the assets and campaigns (Section 8). Usually one client maps to one
brand, but a client may hold several brands, and --- given the Kite group
--- clients can be related to one another. Client is therefore its own
entity above brand, so the real org structure is representable.

**10.2 The client portal --- a scoped external review surface**

The three relationship types above describe how *organizations* relate
to the system. The client portal is a distinct fourth thing: not a
relationship type but an *access mode* --- a heavily-restricted external
surface through which a client (an entity that lives *inside* Meridian's
tenant, per 10.1) is given a narrow window onto its own work. It is
deliberately *not* a lightweight peer tenant. A peer tenant operates its
own side, allocates its own resources, and runs cross-tenant machinery
(10.4); a client-portal user only *observes and responds*. Conflating
the two would import the expensive joint-project machinery into the
common case --- exactly the over-engineering 10.1 warns against.

**What the portal is for.** A client logs into a restricted view of its
own projects to do three things, and only three:

-   **Monitor progress** --- see the status, milestones, and deliverable
    states of the work Meridian is doing for it. The same roll-up the
    internal dashboards read (Section 6), filtered to this client's own
    work and stripped of internal signal.

-   **Leave feedback directly on deliverables** --- pinned/timecoded
    comments on the client's own deliverables, captured through the same
    Tier-2 review engine as internal feedback (Section 8.2). The
    difference is provenance: feedback entered here is client-sourced at
    the point of capture, not transcribed later by an account manager.

-   **Approve deliverables** --- a first-class, audited approval event:
    who approved, which deliverable version, when. Approval is the
    client's most consequential action and the one most worth having as
    tamper-evident record rather than an email an AM screenshots.

**Why capture-at-source matters --- the attribution upgrade.** This is
the load-bearing reason the portal is not a cosmetic convenience.
Section 5.5 makes clean, fair attribution the requirement the whole
accountability model rests on: every unit of elapsed time must be
attributable to a responsible party (assignee / client / dependency /
approver), and the pausable clock (5.4) only pauses fairly when the
system genuinely knows the work is blocked on the client. When feedback
and approvals are AM-logged, the client's contribution to the timeline
is hearsay --- reconstructed second-hand, contestable once SLAs feed
rewards. When the client acts in the portal directly, the "blocked on
client" interval, the feedback round, and the approval are all sourced
from the client themselves. The attribution the accountability engine
already needs stops being transcribed and starts being recorded at
source --- the same principle as native contextual chat (Section 7),
applied to the client boundary.

**What the portal never exposes.** The portal is defined as much by its
exclusions as its inclusions. A client-portal user never sees Meridian
internals: not rates, not capacity or utilization, not other clients,
not internal-only threads, not performance or accountability data, not
any other client's work. Progress is shown as the client-facing shape of
a deliverable's state, never the internal capacity or SLA machinery
underneath it. This is the Surface-vs-Engine contract (Section 2.3) and
role-scoping principle (Section 6) pushed to its most restrictive
setting: the external surface shows the least of any role in the system.

**Storage implication --- reinforces own-storage, not YouTube.** Because
clients review confidential in-progress media through the portal, the
portal is another reason media must live on owned, access-controlled,
signed-URL storage (Section 8.3) and never on YouTube or any public
host. Portal media access is per-deliverable and signed, scoped to the
client's own work, and expires --- the same media-record decoupling
already designed, with the client's row-level scope as one more filter
on it.

**Planning calendar --- proactive lead-time enforcement.** The three
actions above are reactive: they capture what happens once work is under
way. The planning calendar is the portal's one proactive surface, and it
exists to solve a specific, recurring problem with established clients
--- work arriving with unrealistic deadlines because the client did not
plan its own marketing calendar in advance. The cost of that lands
entirely on Meridian: rushed delivery, SLAs blown through no fault of the
maker, and no record that the client caused the compression. The
calendar inverts the flow. Rather than reacting to whatever arrives, Meridian
agrees the client's campaign and content calendar up front --- typically
once a year with the client's marketing team --- and the system then
enforces the lead times that calendar implies.

**The mechanism --- backward planning from an agreed date.** The
calendar rests on machinery the platform already has, read in the
opposite direction. The SLA engine (Section 5.4) derives a deadline from
a work type --- it already knows how long a social post, a video, or a
brand identity takes. The planning calendar uses that same per-work-type
duration the other way round: given an agreed end date (a go-live, a
post date, a launch), it computes the must-commence-by date as end date
minus lead time, where lead time is the work's expected duration plus
the buffer for the client's own feedback rounds (already modelled as
client-side time by the pausable clock). Nothing new is estimated; the
calendar is deadline derivation pointed backwards and surfaced as a date
the client agrees to in advance rather than discovers too late.

*One object, two readings.* Forward: "work starts today → it will be
done by X." Backward: "you want it live on X → work must start by Y."
Same lead-time number; the calendar is the backward reading made visible
and enforceable.

**What it does.** The calendar runs a simple loop:

-   **Agree the calendar up front** --- Meridian and the client populate a
    shared annual calendar with known commitments. Entries can be firm
    (dated), provisional (a rough month or quarter, no brief yet), or
    recurring (retainer cadence --- standing social volume, monthly
    deliverables), the last using the reservation-series pattern noted
    in Section 11.

-   **Compute commence-by dates automatically** --- for every dated
    entry the system works backward through the work type's lead time
    and marks the date work must begin to hit that end date at full
    quality, with no compression and full feedback rounds.

-   **Fire reminders as commence-by approaches** --- the accountability
    instrument. As a commence-by date nears with no brief received, the
    system nudges the client first (in the portal), then the Meridian account
    manager. The message is concrete: "to hit your March 12 launch at
    full quality, the brief needs to land by February 20, and we have
    not received it." Because the reminder is generated from the
    client's own agreed calendar, it is the client's plan holding them
    to account, not Meridian nagging.

-   **Capture the record** --- if the client blows past the commence-by
    date and still demands the original deadline, that is now a logged,
    timestamped event: the calendar was agreed, the reminder fired, the
    brief was late. It feeds SLA attribution (Section 5.5) so a
    compressed timeline is provably client-caused --- protecting the
    assignee's performance score and giving Client Services a defensible
    artifact.

**Feeding the internal demand view.** Because every entry carries a work
type and an end date, the same calendar aggregated across all clients is
Meridian's demand forecast --- expected load by discipline and by week,
answering the capacity-planning question ("are we about to be underwater
in production in March?") as a byproduct of planning the clients
themselves did. An established client's expected demand assembles from
three sources into one view: the retainer baseline (recurring entries),
known upcoming campaigns (provisional entries), and historical cadence
(what the client actually commissioned before, used to surface gaps ---
"last year you ran a Ramadan campaign; nothing is on the calendar yet
this year" --- as a prompt, never an auto-booking). This aggregate view
is Meridian-only.

**Confidentiality --- the split.** The calendar sits on both sides of
the client boundary, so the split is explicit and enforced by the same
row- and field-level scoping as the rest of the portal. The client sees
only its own calendar --- its agreed dates, its commence-by triggers,
its reminders. The client never sees Meridian's aggregate demand view, Meridian's
capacity or utilization, any other client's calendar or load, or how its
work competes for shared resources: the client sees its row, Meridian sees
the sum. This bears on Open Decision 20 (whether clients see internal
dates): the commence-by date is safe to show because it is not an Meridian
internal working deadline --- it is the client's own obligation, derived
from the client's own end date. It is "when your homework is due," which
keeps the reminder client-facing without leaking Meridian's internal
timeline.

**The campaign calendar in the portal**

The portal carries a second calendar surface beside the planning
calendar: the campaign calendar, one for each of the client's active
campaigns (defined in Section 8.1). The planning calendar is the forward
instrument --- agree the year's dates up front, get reminded when each
brief must land. The campaign calendar is the client's window onto a
campaign already under way: its milestones and go-live dates as the work
is produced, and each deliverable's state as it progresses. Because
every campaign automatically has one, there is nothing for an account
manager to assemble per client and nothing that can be forgotten.

What the client sees is the client-appropriate projection of the
campaign's schedule --- milestones and delivery dates, not the internal
working deadlines or SLA clock beneath them --- held to exactly the
exclusions that govern the rest of the portal: no capacity, no
utilization, no other client's work, no internal performance data. This
is the same client-facing-dates posture reached for the planning
calendar and Open Decision 20: the client sees when things are due to
land, never Meridian's internal timeline.

The campaign calendar shows a reference link back to the
planning-calendar entry the campaign was agreed under, so the client can
move between "the year I agreed" and "this campaign as it runs." The
link is context only, not a sync (Section 8.1): a date that moves on one
calendar does not silently move on the other. The planning calendar
stays the agreed-commitment record; the campaign calendar tracks reality
against it. Resolved (v15): the client's campaign calendar exposes
milestone and go-live dates only, not deliverable-level dates. These
milestones were agreed with the client up front, so surfacing them adds
no new commitment exposure, whereas deliverable-level detail would ---
so it stays internal. This matches the milestone-only posture of Open
Decisions 19 and 20.

+-----------------------------------------------------------------------+
| **Open decisions --- planning calendar**                              |
|                                                                       |
| Resolved at dev-plan time. (a) Lead time for provisional entries: a   |
| briefed campaign has a work type and therefore a lead time; a         |
| provisional "something in March" does not --- does the client pick a  |
| rough work type, or does a default lead time apply until the brief    |
| firms it? (b) Reminder escalation ladder: how many nudges, at what    |
| intervals, and when it escalates from client-only to looping in the   |
| account manager --- too aggressive trains people to ignore it, too    |
| soft defeats the purpose. (c) Entry ownership: can the client add and |
| move entries freely, or does the account manager co-own them (client  |
| proposes, AM confirms) so a moved date is a logged negotiation rather |
| than a silent edit? (d) Forecast weighting: whether provisional       |
| entries are weighted lower than firmed ones in the aggregate demand   |
| view, or shown as a separate band.                                    |
+-----------------------------------------------------------------------+

+-----------------------------------------------------------------------+
| **Highest-risk surface --- inherits disproportionate testing**        |
|                                                                       |
| The client portal is an external-facing access path into a system     |
| whose default posture is internal. Like the joint-project RLS (10.4), |
| it is a place where a scoping bug is a confidentiality breach ---     |
| here, leaking Meridian internals or another client's work to an outside    |
| party. It therefore inherits the same disproportionate-testing flag:  |
| every tile, thread, deliverable, and media URL reachable through the  |
| portal must correctly answer "is this field client-visible, and is it |
| this client's own work?" The portal's advantage over the              |
| joint-project case is that visibility is strictly one-directional and |
| read-mostly (observe, comment, approve --- never allocate or          |
| configure), which bounds the surface. But external reachability       |
| raises the consequence of any leak, so it is designed and tested with |
| the same care as the two-part RLS, not less.                          |
+-----------------------------------------------------------------------+

**10.3 Isolation --- the default**

-   **Tenant boundary on every table** --- on Supabase, enforced through
    Row-Level Security so isolation is structural, not
    application-dependent.

-   **Configurability over hard-coding** --- SLA profiles, capacity
    rules, approval workflows, and the work-type taxonomy become
    per-customer configuration.

-   **Clean data ownership & export** --- commercial customers will
    require portable, isolated data; reinforces building on fully-owned
    infrastructure.

Tenancy model: **shared-schema-with-RLS**, now firmly decided ---
peer-tenant collaboration is far harder under schema-per-tenant, so the
collaboration requirement settles the model.

**10.4 Joint projects --- symmetric shared workspace, single host**

For the one or two peer-tenant collaborations, a joint project is a
genuinely shared workspace, not a host-owned project with a guest
looking in. Because Meridian and the peer share the workload, both sides
allocate their own resources and both need to see resources allocated,
progress, and communications on the shared work. Visibility is
bidirectional --- but bounded.

**One nominal host owns; both sides operate**

Each joint project has a single nominal host tenant that owns its
configuration --- SLA profiles, approval rules, work-type setup, and the
final say. This keeps authority unambiguous (no "whose rules when they
differ" deadlock) while work and visibility remain shared both ways.
Shared operation, single ownership.

**Bidirectional but bounded visibility**

Within a joint project, each tenant sees the shared work --- the other
side\'s allocations on this project, shared progress and milestones, and
shared threads. Neither sees the other\'s *unrelated* internal data: not
internal rates, capacity ceilings, other clients, other projects, or
performance data. "Shared" is per-field and per-record, evaluated
symmetrically for both tenants --- some data crosses the boundary, most
never does.

-   **Resources** --- a joint project\'s schedule is the union of both
    tenants\' allocations. Each side manages only its own resources (you
    cannot book the other company\'s people) but both see the combined
    picture. Allocations on a joint project are tenant-tagged.

-   **Progress** --- the joint project\'s status, milestones, and
    deliverable states are shared, and it appears on both tenants\'
    dashboards and exception feeds --- showing the shared work\'s
    health, never the other side\'s internal capacity.

-   **Communications** --- chat on a joint project is cross-tenant by
    default: a shared workspace conversation both companies join.
    Internal-only threads are the exception each side can keep private.

**Cross-tenant identity & the two-part RLS**

A collaborator is a full user in their own tenant, granted a scoped role
into the shared project --- home-tenant identity plus a project-scoped
grant; their home role does not carry over. Row-level security becomes:
"your tenant\'s rows, *plus* joint-project rows you are granted, with
per-field rules about what crosses the boundary, evaluated symmetrically
for both tenants." This is the system\'s most security-critical layer.

+-----------------------------------------------------------------------+
| **Highest-risk surface --- disproportionate testing required**        |
|                                                                       |
| Symmetric bidirectional sharing is the highest-risk surface in the    |
| system. With visibility running both ways and both sides allocating   |
| resources and communicating, every resource view, progress roll-up,   |
| thread, and dashboard tile on a joint project must correctly answer   |
| "which side is this, and is this field shared or internal?" The       |
| two-part, per-field, symmetric RLS is the enforcement boundary; a bug |
| here is a cross-tenant data leak, the most serious failure the system |
| can have. This surface warrants the most careful design and           |
| disproportionate testing relative to how simple it looks --- it is    |
| both the highest-value collaboration feature and the                  |
| highest-consequence place for a leak.                                 |
+-----------------------------------------------------------------------+

**11. Open Decisions**

Deliberately unresolved items, collected for follow-up. These are
design-thinking decisions best made before code generation, since
ambiguity here causes rework.

  ----------------------------------------------------------------------------
  **\#**   **Open decision**             **Notes / leaning**
  -------- ----------------------------- -------------------------------------
  1        Full list of human-resource   The single highest-leverage item. For
           accountability types          each role: deliverable-SLA,
                                         response-SLA, outcome/target,
                                         coverage, measured-elsewhere, or
                                         none. Resolves most structural
                                         questions at once.

  2        Is accountability in scope    Plausible that v1 ships scheduling +
           for v1, or a later phase?     capacity + billing for all resource
                                         types, with accountability profiles
                                         (starting creative SLAs) as phase 2.
                                         Lets the universal layer ship and be
                                         validated first.

  3        Tenancy model                 Shared-schema-with-RLS vs.
                                         schema-per-tenant. Now firmly leaning
                                         shared-schema, since invited-tenant
                                         collaboration effectively requires
                                         it.

  4        Deadline authority (bespoke   Who sets/changes deadlines; changes
           jobs)                         after start logged as scope-change
                                         events, not silent edits.

  5        Pause-state control           Self-service vs. approval-required.
                                         Leaning self-service logged as a
                                         visible, reversible claim.

  6        Performance aggregation       How SLA outcomes roll into a metric
           policy                        (weighting, near-miss vs. severe,
                                         credit for beating deadlines).

  7        Do support/non-creative roles Determines whether the SLA engine is
           need any SLA at all?          one-with-variations or a broader
                                         accountability framework.

  8        Billing: build vs. embed ---  RESOLVED (finance questionnaire, A.
           RESOLVED                      Sye, Finance Lead): no billing
                                         engine. Finance runs Odoo and wants
                                         the platform to feed it, not replace
                                         it. The platform produces a
                                         period-locked export (import file +
                                         readable report) rather than issuing
                                         invoices. This settles the layer as
                                         an export/interface, detailed in
                                         §9.5.

  9        Role surfaces: fixed vs.      Fixed role-based views for v1,
           configurable                  structured to become configurable
                                         per-customer role surfaces later.
                                         Confirm the role list itself.

  10       Exception triggers: automatic How something becomes a surfaced
           vs. manual flag               exception on a dashboard. Leaning
                                         both: automatic thresholds plus a
                                         manual at-risk flag that itself
                                         becomes an exception.

  11       Health-as-a-measure           Once department/company health is
           governance                    visible to leadership, it becomes a
                                         de facto measure of leads. Reward
                                         honest amber over fake green; design
                                         health to expose hidden problems.

  12       Joint-project rule authority  RESOLVED: a single nominal host
                                         tenant owns each joint project\'s
                                         configuration and rules, while work
                                         and visibility are shared
                                         bidirectionally.

  13       Cross-tenant performance      Whether performance on joint work
           attribution                   counts, and for whom (host, peer,
                                         both). Affects the accountability
                                         model on shared projects. Still open.

  14       Real-time chat scaling        Confirm consolidated Supabase
                                         subscriptions (per tenant/project)
                                         resolve the fan-out/cost issue before
                                         considering SpacetimeDB as a
                                         dedicated real-time layer.

  15       Media master retention window How long client contracts / legal
                                         require the actual delivered master
                                         to be reproducible. Sets the
                                         cold-storage window; past it,
                                         proxy-only.

  16       Intermediate-version masters  Whether full masters of rejected
                                         intermediate cuts must be kept, or
                                         only approved finals as masters
                                         (intermediates as proxies). Biggest
                                         storage variable.

  17       Editor upload formats         Web-ready MP4 (small bespoke review
                                         layer, maybe no transcoding) vs. raw
                                         masters e.g. ProRes (needs a
                                         transcoding step, or lean on Frame.io
                                         for video). Decides build size.

  18       Frame.io coupling depth       Link-out (cheap, minimal build) vs.
                                         deep API integration (pulls review
                                         status into the accountability
                                         dashboard, but likely needs
                                         Frame.io\'s Enterprise tier). Start
                                         link-out.

  19       Client-portal approval        RESOLVED (v15): clients approve at
           granularity --- RESOLVED      the milestone/stream level --- it
           (v15)                         matches how clients think ("sign off
                                         the shoot," not each cut) and lines
                                         up with the milestone-only
                                         campaign-calendar exposure (§8.1,
                                         §10.2). Deliverable-level detail is
                                         still captured internally via the
                                         Tier-2 review record, and milestone
                                         approval roll-up feeds campaign
                                         health (Section 6).

  20       Do clients see deadlines /    RESOLVED (v15): the portal shows
           timelines? --- RESOLVED (v15) client-facing milestone and go-live
                                         dates only, never internal working
                                         deadlines or the SLA clock. Because
                                         the deliverable milestones were
                                         agreed with the client up front,
                                         exposing them creates no new
                                         commitment risk while giving the
                                         client a real schedule;
                                         deliverable-level dates and all
                                         internal capacity signal stay hidden.

  21       Client-portal v1 sub-step     Confirmed in the MVP (it upgrades
           ordering                      attribution from AM-logged to
                                         captured-at-source, Section
                                         5.5/10.2), but the MVP itself
                                         decomposes into logical sub-steps.
                                         Open: whether the portal ships as one
                                         unit or the three portal actions
                                         (monitor → feedback → approve)
                                         sequence across sub-steps, and in
                                         what order relative to the internal
                                         Tier-2 review it rides on. Resolved
                                         when the detailed dev plan is drawn
                                         up.

  22       Planning-calendar scope &     The portal planning calendar (§10.2)
           phasing                       depends on the portal, work-type lead
                                         times (§5.4), and recurring entries
                                         all existing first --- so it is a
                                         post-portal phase, not MVP. The
                                         campaign calendar is different: the
                                         internal campaign-calendar projection
                                         is MVP --- it only reads the streams,
                                         deliverables, milestones and
                                         SLA-derived dates the schema already
                                         holds and stores no new scheduling
                                         data --- and the client-portal
                                         campaign calendar rides with the
                                         portal itself. Neither depends on the
                                         planning calendar, backward lead-time
                                         planning, or recurring entries, so
                                         the campaign calendar is not deferred
                                         alongside the planning calendar. Its
                                         own open decisions (provisional-entry
                                         lead time, reminder escalation, entry
                                         ownership, forecast weighting) are
                                         listed in §10.2. Confirmed as a
                                         client-portal feature, not a separate
                                         surface.

  23       Odoo import template / code   Finance answered "nothing specific
           format                        required currently," so the
                                         analytic-account code is nullable
                                         free-text for now. Open: the exact
                                         import template and whether
                                         analytic-account codes must be
                                         validated to match Odoo exactly. Firm
                                         up once Finance confirms the
                                         template.

  24       Finance export --- push vs.   Whether the daily export is pushed on
           pull                          a schedule (an Edge Function writes
                                         the file / posts to Finance) or
                                         pulled on demand (Finance downloads
                                         when needed). Leaning scheduled push
                                         with a manual on-demand re-run, both
                                         respecting the month-end lock.

  25       Deck version granularity ---  Collabora saves periodically during
           session vs. save              an editing session, so a long
                                         multi-contributor session produces
                                         many PutFile callbacks. Versioning
                                         every callback creates noise;
                                         versioning only on close risks loss.
                                         Leaning session-collapsed versions
                                         with a forced version at approval and
                                         at client delivery. Resolve at
                                         dev-plan time.

  26       Collabora deployment --- CODE The convenience CODE image carries a
           image vs. build from source   10-document / 20-connection cap and
                                         is stated as unsuitable for
                                         deployment; the licence (MPL 2.0) has
                                         no such limit. Production therefore
                                         needs a source build or a supported
                                         subscription (€3/user/month, which
                                         buys support rather than the
                                         software). Weigh solo-maintenance
                                         burden of self-building against a
                                         per-user fee this platform exists to
                                         avoid. Note: largely settled by Open
                                         Decision 29 --- the edit-event patch
                                         forces a source build regardless.

  27       Huddle recording consent ---  Recording is default-on with notice,
           jurisdictional policy         a visible indicator, and an audited
                                         creator opt-out. Open: whether a
                                         per-tenant or per-jurisdiction policy
                                         switch is needed given operations
                                         across Iraq, UAE and Egypt plus
                                         client participants elsewhere. Needs
                                         a real answer before external
                                         participants are recorded, not a
                                         checkbox.

  28       LiveKit --- TURN and Egress   Self-hosted LiveKit requires coturn
           deployment                    configured separately; corporate
                                         firewalls are where WebRTC fails and
                                         client-side joins from restricted
                                         networks are the case that must work.
                                         Egress is a separate service with its
                                         own resource footprint. Untested ---
                                         run a connectivity and recording test
                                         as Collabora was tested before
                                         committing.

  29       Collabora edit-event patch    Slide-level audit attribution
           --- scope and upstreaming     requires patching Collabora to emit
                                         per-user edit events (§8.4). Open:
                                         what LibreOfficeKit knows at
                                         broadcast (object/coordinate vs.
                                         slide identity) --- read the source
                                         before estimating; whether to emit
                                         per-edit or per-interval-per-slide;
                                         and whether to attempt upstreaming to
                                         escape permanent rebase cost. This
                                         decision supersedes OD 26 ---
                                         patching forces the source-build
                                         route.
  ----------------------------------------------------------------------------

**12. Indicative Phasing**

Phasing separates what ships when at the surface from what the schema
must assume from the start. The scheduling surface ships first for
practical reasons, but the accountability engine is the spine
(Section 1) --- the data model assumes it from day one even though its
user-facing surfaces arrive in a later phase. Timeline assumes a solo
developer working with heavy AI assistance.

  ---------------------------------------------------------------------------
  **Phase**   **Scope**                                        **Indicative
                                                               time**
  ----------- ------------------------------------------------ --------------
  MVP         Resource model + capacity, scheduling            \~2--4 weeks
              (timeline), bookings, approval routing,          
              role-scoped views, the individual action-surface 
              dashboard, auth/roles, tenant isolation with     
              joint-project sharing, accountability-ready      
              schema (including the Odoo analytic-account code 
              field, dual cost/charge rate columns, and the    
              ad-hoc job shape with its optional campaign and  
              source-deliverable links, so neither finance     
              keys nor job shapes are retrofitted later), and  
              the scoped client portal (monitor / feedback /   
              approve --- capturing client-sourced attribution 
              at source), plus the campaign calendar as a      
              read-only projection over each campaign's        
              streams, deliverables and milestones (no new     
              scheduling data). The MVP itself decomposes into 
              logical sub-steps at dev-plan time; the portal   
              rides on the Tier-2 review record and need not   
              land in a single step (Open Decision 21)         

  Full v1     Adds time tracking, billing/rates, utilization,  \~6--10 weeks
              notifications, reporting, and the oversight      total
              exception feed (team-lead dashboard), contextual 
              chat, brief-driven job creation                  
              (campaign/stream/deliverable), and Tier-2 media  
              review (pinned image + timecoded video           
              comments), collaborative deck editing via        
              Collabora (§8.4), huddles with recording via     
              LiveKit (§7.4), the finance export to Odoo       
              (period-locked import file + readable report;    
              §9.5), edge-case hardening                       

  Phase 2     Accountability surfaces: profiles (creative SLAs After v1
              first), SLA→performance linkage, audit trail,    validated in
              and department/company health dashboards, full   use
              cross-tenant collaboration hardening, media      
              storage lifecycle/tiering, and any deferred      
              Tier-3 media review                              
  ---------------------------------------------------------------------------

Note on estimates: the last 20% (the genuinely hard real-world cases ---
a booking spanning a holiday, partially cancelled, needing re-approval)
takes longer than a demo suggests. The domain edge cases ---
timezone/DST handling, SLA clock rules across business vs. calendar
hours, billing rounding and rate precedence --- are cheap to write and
expensive to get subtly wrong. Over-specify these before building.
*Treat all timings as indicative.*

**13. Key Risks & Watch-Items**

-   **Single point of knowledge** --- a solo build means one person
    holds the context. Mitigate from day one with real documentation and
    clean data export, so the organization is not hostage to one person.

-   **Complexity leaking to the surface** --- the primary product risk.
    Enforced by the Surface vs. Engine contract and by role scoping:
    each role must do its whole job without seeing another role\'s
    controls. Validated only through testing with real users doing real
    tasks.

-   **Role-scope leakage** --- if a narrow role (e.g. creative) is ever
    forced to touch a control belonging to another (e.g. capacity
    ceilings), the simplicity guarantee breaks. This is the specific
    failure mode to watch in every feature.

-   **Copyleft contamination** --- avoided by treating references as
    design-only and filtering all embedded libraries for permissive
    licenses.

-   **Cross-tenant data leak** --- the most serious failure mode once
    joint projects exist. The two-part RLS (own rows plus granted
    joint-project rows, field-filtered) is the enforcement boundary;
    joint-project access paths get extra testing and review.

-   **Client-portal confidentiality leak** --- the portal (Section 10.2)
    is an external-facing path into an internally-postured system, so a
    scoping bug leaks Meridian internals or another client's work to an
    outside party. Visibility is strictly one-directional and
    read-mostly, which bounds the surface, but external reachability
    raises the consequence. It inherits the same
    disproportionate-testing flag as the joint-project RLS: every
    portal-reachable tile, thread, deliverable, and signed media URL
    must be verified to expose only this client's own, client-visible
    fields.

-   **Real-time as source of truth** --- avoided by persisting chat to
    Postgres and treating Realtime as delivery only, so a dropped frame
    is a re-fetch, not lost data or a broken audit trail.

-   **Media storage cost** --- video volume and repeated-review egress
    are the cost risk. Contained by splitting cheap permanent metadata
    history from tiered media (hot → cold → proxy-only), decoupling
    media to egress-cheap storage (B2/R2 behind a CDN), and a retention
    policy set by contract/legal --- not by keeping every master hot
    forever.

-   **Performance-metric gaming** --- once SLAs feed rewards, incentives
    distort. Counterweights and visible audit trails are required, not
    optional.

-   **Finance-export integrity** --- once the export feeds Odoo and
    drives invoicing and payroll, a wrong figure or a leak across the
    month-end lock is a financial error, not a display glitch. The
    period-lock boundary, the cost-vs-charge rate distinction, and the
    analytic-account mapping each need testing against Finance's close;
    a locked period must be provably frozen.

-   **Deck editing is a live dependency** --- hosting the deck
    in-platform means Collabora sits on the critical path of
    client-facing creative work. Fidelity round-tripped cleanly in test,
    but the test was one deck; a format regression, an upgrade, or an
    unsupported construct in a future deck degrades the artifact that
    goes to the client. Keep the PowerPoint escape hatch explicit ---
    download, edit natively, re-upload --- and re-test fidelity on
    upgrade rather than assuming it holds.

-   **Recorded voice is a liability surface** --- huddle audio is the
    most sensitive data the platform will hold: unguarded speech, client
    voices, several jurisdictions. Consent notice, the visible
    indicator, and the audited opt-out are the controls, but a
    playback-rights bug leaks a conversation rather than a field. Treat
    huddle recordings with the same disproportionate testing as the
    joint-project RLS boundary (§10.4), and resolve the consent policy
    (Open Decision 27) before any external participant is recorded.

-   **Carrying a C++ patch** --- the edit-event patch (§8.4) puts this
    team in the position of maintaining a fork of a large C++ codebase
    it did not write, rebased on every upgrade, as a solo developer.
    This is the single most open-ended maintenance commitment in the
    plan. Upstreaming is the only real exit; attempt it early rather
    than after the fork has diverged. If upstreaming fails and the
    rebase cost proves unsustainable, the fallback is session
    correlation (inferred attribution) with the audit-grade claim
    withdrawn --- which is a product decision, not a technical one, and
    should be taken knowingly.

-   **Retrofit costs** --- multi-tenancy and clean attribution are
    expensive to add later; both are designed in from the start.

*End of fifteenth draft, now grounded in the real Meridian org structure and
Kite Group context. This draft resolves the campaign-calendar decisions
--- the client sees milestone and go-live dates only, approval is taken
at the milestone/stream level, milestone and go-live dates are editable
only by the account manager, and the campaign calendar (internal
projection) sits in the MVP independent of the planning calendar (see
§8.1, §10.2 and Open Decisions 19--20). Highest-leverage remaining
inputs: the staff survey (how work actually flows), the Excel resource
sheet (real capacity tracking), and the agency\'s media retention and
format answers.*
