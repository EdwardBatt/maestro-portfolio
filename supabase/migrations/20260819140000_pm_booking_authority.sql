-- ADR-0029 (I7.2b): per-project PM booking authority.
--
-- I7.1 gave the appointed PM (a job's owner_user_id) authority over their project's sub-tasks across
-- departments. This extends the same reach to BOOKINGS: a PM may book a resource in any department
-- for their own project's work, so a multi-department project is scheduled by one coordinator. The
-- PM still needs `bookings:create` (the booking-transition pre-check); this only bypasses the
-- resource's write-scope for the PM's own project.

create or replace function app.caller_is_booking_pm(p_deliverable uuid, p_sub_task uuid, p_job uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from public.jobs j
    where j.owner_user_id = auth.uid()
      and j.id in (
        p_job,
        (select d.job_id from public.deliverables d where d.id = p_deliverable),
        (select d2.job_id from public.deliverables d2
           join public.sub_tasks st on st.deliverable_id = d2.id where st.id = p_sub_task)
      )
  )
$$;
comment on function app.caller_is_booking_pm(uuid, uuid, uuid) is
  'ADR-0029: is the caller the appointed PM (owner_user_id) of the project this booking belongs to (via its sub-task/deliverable/job)? Lets a PM book across departments for their own project.';

-- extend the scheduler booking policies with a PM branch (bypasses resource write-scope for the
-- caller''s OWN project only; still requires bookings:create/update).
drop policy bookings_scheduler_insert on bookings;
create policy bookings_scheduler_insert on bookings
  for insert to authenticated
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'create')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));

drop policy bookings_scheduler_update on bookings;
create policy bookings_scheduler_update on bookings
  for update to authenticated
  using (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)))
  with check (tenant_id = app.current_tenant_id()
    and app.has_permission('bookings', 'update')
    and (app.resource_in_write_scope(resource_id)
         or app.caller_is_booking_pm(deliverable_id, sub_task_id, job_id)));
