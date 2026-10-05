# ADR-0030: Task execution — Start/Submit lifecycle, per-sub-task time tracking, deliverable approval gate

- **Status:** **accepted** (Edward, 2026-08-19)
- **Date:** 2026-08-18
- **Relates to:** **ADR-0010** (deliverable → sub-task breakdown), **ADR-0024/0025** (deliverable lifecycle engine + internal review; the `tg_deliverable_transition_guard`, `revision_round`, `sla_events`), **ADR-0029** (internal projects / booking-based assignment / SLA profiles / KPIs — this ADR captures the **actual time** those SLAs and KPIs measure against), **ADR-0015/0026/0028** (notification transport). Design doc §8/§10 (categorized SLA engine; SLA-to-performance linkage; append-only audit; anti-gaming).
- **Task(s):** proposed block **I8** (task execution). Sibling of I7 (ADR-0029); the two are independent and can build in either order.

## Context

I5/I6 proved work → review → sign-off, but the **sub-task** — the unit a person is actually assigned — has no execution surface: `sub_tasks.status` carries values (`todo/in_progress/blocked/review/done/cancelled`) that **nothing drives**, there is **no time capture** anywhere in the system, and the deliverable review/approval gate is **not** conditioned on the underlying work being finished. Edward's requirement: each assigned task needs **action buttons** (Start Task, Submit for Review, …) that drive its status **and a timer**, each deliverable must run through review, and approval must be **blocked** until the work is genuinely submitted. The captured time is also the **actual** that ADR-0029's SLA profiles and KPIs measure against.

### Decisions taken with Edward (2026-08-18)

- **The sub-task is the timed, actionable unit.** Start/Submit and the timer live on the sub-task; the deliverable's review is the existing state machine, reached once its work is submitted.
- **Single session: Start → Submit.** Start begins one timed run; Submit stops it (actual = submit − start). **No pause/resume** this slice.
- **Submit without Start → manual hours + a flag.** The person must enter hours by hand, and the entry is marked `manual` — a **small process-adherence flag** visible to the lead. **No automated pay/score penalty** (that stays P2 with the anti-gaming safeguards).
- **All sub-tasks must be submitted before a deliverable is reviewed/approved.** On review, the approver either **requests changes** — which **reopens the specific sub-task**, bumps **its** revision number, and **blocks approval** until it's resubmitted — or **approves** (sign-off). Round is tracked.
- **Request Changes REQUIRES a change description (Edward, 2026-08-19).** A reviewer cannot reopen a sub-task without saying what to change — a change request with no description is pointless. The description is a mandatory review comment (ADR-0025 anchored feedback) captured in the same action; no comment → no reopen.
- **No Block — soft dependencies instead.** A sub-task can never be marked "blocked" (blocking becomes an excuse for idleness). Instead, sub-tasks carry **soft dependencies** (B depends on A) and a deliverable carries **specific external-input** items; both are *shown, never enforced*. Starting work while a dependency/input is unsatisfied is flagged **"started ahead"** — a **positive** initiative marker, with any resulting rework tracked separately (rounds). Visible now; reward/penalty is P2.

## Decision

### 1. Sub-task execution lifecycle

Sub-task `status` is driven by explicit, authored actions (assignee-only for their own task):

| Action | From | To | Side effect |
|---|---|---|---|
| **Start Task** | `todo` | `in_progress` | opens a time entry (`started_at = now`); sets `started_ahead` if any dependency/external input is unsatisfied (§1b) |
| **Submit for Review** | `in_progress` | `review` | closes the open time entry (`submitted_at`, `minutes`); if none is open → require manual hours (`mode='manual'`, flagged) |
| **Request Changes** (reviewer) | `review` | `in_progress` | `revision_number += 1`; opens a **new** round; blocks the deliverable's approval |
| **Accept** (on deliverable sign-off) | `review` | `done` | — |

There is **no Block action and no `blocked` status** for sub-tasks — dependencies replace it (§1b). The migration drops `blocked` from the `sub_tasks.status` check. Only the **assignee** may Start/Submit their own sub-task; **Request Changes** rides `reviews:moderate` at the deliverable level (ADR-0025). Transitions are enforced by a small `app.tg_sub_task_action_guard` (mirrors the deliverable guard), so illegal jumps are rejected and the round/time side effects are atomic.

### 1b. Dependencies & external inputs — soft, never a Block

Blocking is removed because it rewards idleness. Waiting is modelled as information, not a gate:

- **Internal dependency** — `sub_task_dependencies (tenant_id, sub_task_id, depends_on_sub_task_id)`: B depends on A. Many-to-many, allowed **across deliverables**, with a **cycle guard** (no A→B→A). Satisfied **when A is submitted**.
- **External input** — a deliverable carries **specific** pending items: `deliverable_pending_inputs (id, tenant_id, deliverable_id, description not null, awaited_from, requested_at, satisfied_at)`. "Waiting on Acme's logo pack," never a vague "blocked." These **cascade** to the deliverable's sub-tasks, so everyone under it sees the same pending item; it is reflected on the deliverable **and** its sub-tasks.
- **Both are soft** — displayed, never enforced. Start/Submit are never disabled by an unsatisfied dependency or pending input; nothing upstream is stopped either.
- **Started ahead = initiative.** When a sub-task is **Started** while any of its own dependencies *or* its deliverable's external inputs are unsatisfied, the time entry is flagged `started_ahead = true` — a **positive** marker on the owner. Any rework it later causes is counted separately (rounds), so initiative and churn stay honest, separate numbers.
- **Guardrail:** the `started_ahead` flag and the pending items are **visible now** (lead + candidate KPI signal); no automated reward/penalty until P2.

### 2. Time tracking — `task_time_entries`

```sql
create table task_time_entries (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id),
  sub_task_id   uuid not null references sub_tasks(id) on delete cascade,
  user_id       uuid not null references user_profiles(id),   -- who did the work (the assignee)
  round         int  not null default 0,                       -- matches sub_tasks.revision_number at start
  started_at    timestamptz,                                   -- null when the entry is a manual back-fill
  submitted_at  timestamptz,
  minutes       numeric(7,1),                                  -- timer: submitted−started; manual: entered
  mode          text not null check (mode in ('timer','manual')),
  started_ahead boolean not null default false,               -- started while a dependency/input was unsatisfied (§1b)
  created_at    timestamptz not null default now()
);
create index idx_task_time_entries_sub_task on task_time_entries (sub_task_id, round);
create unique index uq_task_time_open_entry on task_time_entries (sub_task_id, round) where submitted_at is null;
```

- **One entry per sub-task per round.** Start writes an open entry (`started_at` set, `submitted_at` null — the running clock); Submit closes it and stamps `minutes`. A rework round (after Request Changes) starts a fresh entry at the new `round`.
- **`mode='manual'`** — Submit with no open entry: the person enters `minutes` by hand and the entry is `manual`. This is the **process-adherence flag**; it is *visible* (lead sees "hours entered manually, timer not used") but carries **no automated consequence** in this slice.
- **Actual time** for a sub-task = `sum(minutes)` across rounds; per-round = that round's entry. This is the **actual** that ADR-0029's `app.effective_sla` (budget = `sla_hours` / profile) is compared against, and a source for derived KPIs (throughput, on-time, blocked time).

Add to `sub_tasks`: `revision_number int not null default 0` (per-task round count; distinct from the deliverable's `revision_round`).

### 3. Deliverable review / approval gate

Amend the deliverable lifecycle (ADR-0024/0025 `tg_deliverable_transition_guard`):

- **→ `in_review` requires every sub-task submitted** — all `sub_tasks.status in ('review','done','cancelled')` for that deliverable. A deliverable with any `todo`/`in_progress`/`blocked` sub-task cannot enter review. (When there are *no* sub-tasks, the deliverable behaves as today — direct review is allowed.)
- **→ `approved` requires the same** — a **reopened** sub-task (Request Changes → `in_progress`) drops the deliverable out of the "all submitted" state, so **approval is blocked** until it's resubmitted. This is exactly Edward's rule: a change request holds the approval gate shut on that specific task.
- **Request Changes** is authored at the sub-task level by a reviewer (`reviews:moderate`): it reopens the chosen sub-task(s) — not all of them — bumps each one's `revision_number`, and (via the gate) prevents approval. **A change description is mandatory** — the action carries at least one review comment (ADR-0025 feedback, anchored to the version under review) explaining what to change; the guard rejects a reopen with no accompanying comment. The deliverable's own `revision_round` still increments on the `in_review → in_progress` move (existing behaviour) so the deliverable-level round count is preserved.

### 4. Notifications (reuse the ADR-0028 lane)

- **Deliverable becomes reviewable** (the last outstanding sub-task is submitted) → the existing `review_requested` notification to the reviewer/AM. Individual sub-task submits do **not** each notify — only the transition to reviewable does (no spam). *(Confirmed default, Edward.)*
- **Request Changes reopens a sub-task** → notify **that sub-task's assignee** ("changes requested on your task"), actor-excluded. Add a `changes_requested` emission at the sub-task grain (entity_type `sub_task`), mirroring the existing deliverable one.
- **Dependency satisfied** → when submitting A satisfies a downstream B's dependency, notify **B's assignee** ("the input you were waiting on is ready"). The natural payoff of the soft-dependency model — the waiter learns the moment they can proceed. Actor-excluded.
- No transport change (ADR-0015/0026/0028 stand).

### 5. Surfaces (UI)

- **My Work / task detail:** Start / Submit on the assignee's own sub-tasks (no Block); a live elapsed display while running; each task shows its **dependencies + the deliverable's pending external inputs** and their state; a **manual-hours modal** when Submit is pressed with no timer running (clear "not timer-tracked" note); a **"started ahead"** indicator when applicable. This is the deep-link target for a task notification (ADR-0029, corrected).
- **Reviewer view:** per-sub-task "Request changes" + the deliverable **Approve** (enabled only when the gate is open); each sub-task shows its `revision_number` and its actual vs budget.
- **Lead view:** actual-vs-budget per sub-task and the `manual` compliance flags across their scope.
- EN + AR for every new control (RTL), per I6.2.

## Consequences

**Easier:** the sub-task finally has a real execution surface; assignees drive their own status; **actual time is captured at last**, giving ADR-0029's SLAs and KPIs something true to measure; the approval gate can no longer be jumped over unfinished work; change requests are precise (the one task that needs rework) and fully counted.

**Harder / new:** the deliverable transition guard — shipped code — gains a completion precondition (must be covered by tests so existing flows don't silently break); a new table + a sub-task action guard + round bookkeeping; the "no open timer" manual path must be airtight (it's the compliance seam); and a live timer in the UI needs a reliable elapsed calc from `started_at` (server time, not client clock).

**Explicit non-goals (later / P2):** pause/resume timers (single session by decision); automated pay or score penalties for `manual` entries or misses (P2 + anti-gaming); **workday attendance / clock-in-out** — a separate concern with its own end-of-day-detection problem → **ADR-0031** (to be drafted).

## Settled (Edward, 2026-08-19)

- **Request Changes requires a change description** — a mandatory review comment (ADR-0025), captured in the same action; no comment → no reopen. (There's no point reopening a task without saying what to change.)
- Accepted for build as **I8**.

## Open — none blocking

_All decisions settled. Prior rounds (Edward): no Block — soft dependencies + specific external inputs; started-ahead is a positive (initiative rewarded, rework tracked separately, visible-now/P2-consequences); dependency satisfied = A submitted; notification default = notify only when the deliverable becomes reviewable, plus a dependency-satisfied ping; Request Changes requires a change description._

## On acceptance (bookkeeping to apply — not done yet)

Row **0030** → `docs/adr/README.md`; new **I8** block in `docs/TASKS.md`; cross-reference from ADR-0029 (SLA/KPI actuals ← this) and a note on ADR-0024/0025 that the lifecycle guard gains a completion precondition. Proposed first commit: `docs: ADR-0030 task execution + time tracking [I8 plan]`.
