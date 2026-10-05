-- I74 fix-up (Edward, 3 Oct, answering Q13) — a lead blocks time for the people she leads, leave included.
--
-- "Team leads must be able to block time for their team, including leave. However they do this via the modal..and then
-- it is added to the leave page automatically."
--
-- Until now a `resource_unavailability` row was written by `leave:manage` (kind leave, resource_unavailability_leave_write)
-- or `blackouts:manage` (any kind, resource_unavailability_scheduler_write), each within `app.resource_in_write_scope`.
-- A team lead holds neither, so the Schedule's Block time (Figma L SC-22) was closed to her.
--
-- This adds ONE policy: whoever may book (`bookings:create`) may write rows of kind 'leave' or 'internal' for a person
-- in her SCHEDULING reach (`app.resource_in_scheduling_scope`, ADR-0139 d.1/d.6 — a team lead her own team, a department
-- lead his department, Traffic and the Power Admin everyone, a self-scoped person nobody) — without `leave:manage`. The
-- leave written is the same row the Leave page reads (`kind = 'leave'`), so it appears there with nothing copied. The
-- two existing policies are untouched: HR holders of `leave:manage` keep their reach, and the other kinds stay with
-- `blackouts:manage`. Records ADR-0139 d.7's dated addendum.
--
-- No function is created or changed; RLS only. Policies are permissive, so this widens and narrows nothing else.

begin;

drop policy if exists resource_unavailability_lead_block on resource_unavailability;
create policy resource_unavailability_lead_block on resource_unavailability
  for all to authenticated
  using (tenant_id = app.current_tenant_id()
         and kind in ('leave', 'internal')
         and app.has_permission('bookings', 'create')
         and app.resource_in_scheduling_scope(resource_id))
  with check (tenant_id = app.current_tenant_id()
              and kind in ('leave', 'internal')
              and app.has_permission('bookings', 'create')
              and app.resource_in_scheduling_scope(resource_id));

comment on policy resource_unavailability_lead_block on resource_unavailability is
  'I74 fix-up, ADR-0139 d.7 addendum (Edward, 3 Oct): a lead who may book (bookings:create) blocks time — leave or '
  'internal work — for the people in her scheduling reach (app.resource_in_scheduling_scope), without leave:manage. '
  'Leave lands as the same kind=leave row the Leave page reads.';

commit;
