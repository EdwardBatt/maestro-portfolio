# ADR-0040: Assigning work requires the authority to schedule it

- **Status:** accepted
- **Date:** 2026-08-24
- **Open Decision:** — (closes the remaining half of `I12.3`; forces the `L6.9` account-manager question)
- **Task(s):** I12.5 (new); relates to ADR-0009 (write scope), ADR-0024, ADR-0034/0035

## Context

Assigning ad-hoc work is gated **twice, in two places, with a commit in between**:

| Step | Gate | Question it asks |
| --- | --- | --- |
| `create_adhoc_deliverable` (RPC, transactional) | `project_tasks:manage` + `app.in_write_scope(department, team)` | may you assign work *here*? |
| `subtask-schedule` (Edge Function, separate call) | `bookings:create` + `app.resource_in_write_scope(resource)` | may you book *that person's calendar*? |

Those are independent permissions over independent objects, so passing the first and failing the
second is an ordinary outcome — and by then the task is committed. The assignment half-succeeds: work
is owed by somebody whose calendar the assigner was never permitted to touch, it appears on no grid,
consumes no capacity, and is visible only to the assignee.

**This is not hypothetical and it is not rare.** On 23 Aug it produced six identical tasks for one
piece of work: the operator saw an error, retried, and each retry committed another task. `I12.3`
addressed the retry loop (a partial success no longer reads as a failure) but not the cause — the
operation can still half-succeed on the first press.

The campaign path has the same shape: `useUpsertSubTask` inserts the sub-task, then calls the
scheduler separately.

**The measurement that makes this urgent.** `L6.9` established that `account_manager` holds
`project_tasks:manage` but **not** `bookings:create`. So *every* ad-hoc assignment made by an account
manager half-succeeds today, by construction. The role whose stated purpose is "assigns and
coordinates within their accounts" cannot complete an assignment.

### Options weighed

- **A — surface unscheduled tasks (an exceptions count).** Rejected. It reports the broken state more
  loudly without preventing it; the assigner still cannot fix what they lacked permission to do.
  Proposed first by the author and rejected by Edward on exactly that ground.
- **B — roll back the task when scheduling fails.** Client-driven compensation: a crash between the
  two calls still strands a task, and it deletes work someone has just typed.
- **C — move materialisation into the create transaction.** Genuinely atomic, but the scheduling
  maths (working days, day spans, hour spreading) lives in TypeScript in the Edge Function; porting
  it to SQL is a large change to satisfy a permissions problem.
- **D — ask both questions before writing anything (chosen).** The failure being prevented is
  overwhelmingly a *permissions* failure, and permissions can be checked up front cheaply. What
  remains after this is genuine runtime failure — a network blip, storage unavailable — which is what
  `I12.3`'s retry is for.

## Decision

1. **Assignment requires booking authority over the assignee's calendar.** When a task is assigned to
   someone who holds an active bookable resource, the assigner must hold `bookings:create` **and**
   that resource must be within their write scope (`app.resource_in_write_scope`). Checked before any
   row is written.
2. **Enforced by a trigger on `sub_tasks`, not in each RPC.** `BEFORE INSERT OR UPDATE OF
   assignee_id`, so it covers every path that exists or will exist — `create_adhoc_deliverable`, the
   campaign form's direct insert, `update_task_assignment`, a repair script, a future import.
   Postgres owns the invariant (AGENTS.md §2); gating it in one RPC is how the two-gate split arose.
3. **An assignee with no active bookable resource is exempt.** The scheduler already treats that as a
   legitimate no-op — there is nothing to materialise, so there is nothing to be authorised for.
   Without this, assigning work to anyone without a calendar would be blocked outright.
4. **Unassigning is never blocked.** Clearing `assignee_id` requires no booking authority; the check
   applies only when a task is being given to someone.
5. **`system_op` contexts are exempt** (the seeders and migrations already fence with
   `app.system_op`), so a data migration cannot be blocked by a permission the migration role has no
   business holding.

## Consequences

**Easier.** An assignment either happens completely or does not happen at all, and the assigner is
told which at the moment they press the button, with a message naming the real reason. The class of
"real, owed, invisible" tasks stops being creatable, which retires the visibility question raised
under `I12.3` — there is nothing left in that state to surface.

**Harder — and this one has an organisational cost, not just a technical one.** Account managers
cannot assign ad-hoc work at all until they hold `bookings:create`, because they never could complete
one; the difference is that the failure is now honest and immediate instead of silent. **This
migration will stop an assignment that "worked" yesterday**, and the fix is a grant, not a code
change. `L6.9` already flagged that `account_manager` lacks the booking grants its own role
description implies; this forces that decision rather than letting it fail quietly. The same applies
to any role holding `project_tasks:manage` without `bookings:create`.

**Locked in.** Authority to give someone work and authority to occupy their time are the same
authority. Anything that wants to assign without scheduling is asking for a different concept — a
request or a proposal that the assignee or a scheduler accepts — not a reason to let the two split
again.

**Testing.** pgTAP: assignment refused without `bookings:create`; refused when the resource is outside
write scope; permitted with both; permitted when the assignee has no bookable resource; unassignment
permitted regardless; and the whole transaction rolled back on refusal, so no orphan task survives.
