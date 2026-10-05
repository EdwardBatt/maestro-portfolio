-- The planner is told what a permission check really costs (I54.25).
--
-- **"Waiting for you" took 9 seconds and was being killed by the 8-second statement timeout**, so a
-- department lead, an account manager or Traffic opened My Work and were told they had nothing to
-- approve. Not an error — the panel hides itself when the list is empty, and a list that never
-- arrived looks exactly like an empty one. Measured on 224 campaigns, which is small for a real
-- agency, and it gets worse as work accumulates.
--
-- **The cause, from the query plan.** One of the six things the list asks for is pending deadline
-- extensions. Postgres chose to start at `sub_tasks` and apply
--
--     sub_task_can_decide_extension(id) AND sub_task_extension_approver(id) = <me>
--
-- as a filter over **every task in the tenant** — `Rows Removed by Filter: 1444` — before ever
-- reaching the thirteen extension events those checks were meant for. 1,444 tasks x two
-- authorisation functions, each doing its own reads: nine seconds to return zero rows.
--
-- It chose that because **nothing told it otherwise**. Postgres costs a function at 0.0025 units
-- unless told, so an authorisation check that runs several queries is priced like an integer
-- comparison and gets pushed down as a cheap filter. That is a default, not a mistake in the SQL.
--
-- **The fix is to tell the truth about the price.** These functions read tables, sometimes several;
-- `cost 10000` says so, and the planner then applies them LAST, once the cheap joins have narrowed
-- the rows from 1,444 to 13. It changes no logic, no permissions and no results — only the order
-- the planner does the work in.
--
-- Measured before and after, same data, same person, security on:
--
--     the extension branch    9,263 ms  ->    0.7 ms
--     the whole list          9,056 ms  ->  253 ms
--
-- `has_permission` and `in_write_scope` are priced too. They are the two most-called checks in the
-- system — every RLS policy leans on them — and they are mis-priced in exactly the same way. Their
-- cost is lower because they are cheaper per call, but the same rule applies: a check that reads a
-- table is not free.
--
-- **This is Supabase's own documented guidance** (RLS performance: an authorisation check written
-- so it runs per row should run once) applied to the planner's side of the same problem.
--
-- NOT FIXED HERE: the chat rail (`my_conversations`) is **113 seconds** for somebody with a lot of
-- work, and costing does not touch it — its shape is wrong, not its plan. See `I54.26`; it needs
-- its own change and its own decision.

begin;

-- Reads `sla_events` and `sub_tasks`, and calls the approver lookup in turn.
alter function app.sub_task_can_decide_extension(uuid) cost 10000;
alter function app.sub_task_can_request_extension(uuid) cost 10000;
-- Walks the task to its deliverable, its department and its leads.
alter function app.sub_task_extension_approver(uuid) cost 10000;

-- Reads the resource, its person, their department and team, and the caller's scope.
alter function app.resource_in_scheduling_scope(uuid) cost 10000;

-- The two the whole system leans on. Cheaper per call than the ones above — a grant lookup rather
-- than a walk through half the schema — but still several reads, and still priced at nothing.
alter function app.has_permission(text, text) cost 500;
alter function app.in_write_scope(uuid, uuid, uuid) cost 500;

commit;
