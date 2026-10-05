-- ADR-0034 (Option 1): a task is a task everywhere — including ad-hoc work assigned on the scheduler.
-- Principle (Edward): ALL assigned work is a TASK with a lifecycle (assign → start → submit → done);
-- a BOOKING is a static reservation (a meeting, a hold, leave). Ad-hoc work assigned to a person
-- becomes a standalone sub_task (no parent deliverable) so it flows through the existing assignment
-- notification, start/submit lifecycle, timer, and the "Assigned to me" surface — while a genuine
-- meeting/reservation stays a static booking (on the calendar + load, no Start/Submit).
--
-- Increment 1 — schema enabler: allow a sub_task to stand alone. Verified safe:
--   * app.tg_subtask_notify_assignee fires on assignee_id and reads only new.tenant_id/assignee_id/
--     title — it never touches the deliverable, so a standalone task still notifies its assignee.
--   * The start/submit lifecycle (app.sub_task_start / app.sub_task_submit) and the timer act on the
--     sub_task's own rows; no deliverable is required.
--   * The deliverable-state notification and the approval gate only ever target deliverable-backed
--     tasks, so they are unaffected by rows whose deliverable_id is NULL.
-- Forward-only; additive (relaxes a NOT NULL). The scheduler creation path, the "Assigned to me"
-- inclusion, and the Task-vs-Meeting UI follow in their own increments.

alter table sub_tasks alter column deliverable_id drop not null;

comment on column sub_tasks.deliverable_id is
  'Parent deliverable, or NULL for a standalone ad-hoc task assigned directly on the scheduler '
  '(ADR-0034). Standalone tasks carry their own tenant/assignee/scope and run the full task '
  'lifecycle (assign → start → submit → done) without a deliverable.';
