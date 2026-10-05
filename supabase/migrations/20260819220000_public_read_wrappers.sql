-- Frontend bridge (I7.3/I7.4/I9 UI): public read-wrappers over the app-schema resolvers so the UI
-- can rpc() them (PostgREST exposes only `public`). All SECURITY INVOKER — RLS on the underlying
-- rows scopes what the caller resolves, exactly as if they queried directly:
--   * effective_sla     — a sub-task's resolved SLA turnaround (hours)
--   * kpi_rollup        — team/department KPI rollups for a period (RLS-scoped to the caller)
--   * attendance_deviation — a person-day's deviation flags (RLS-scoped to the caller)

create or replace function public.effective_sla(p_sub_task uuid)
returns numeric language sql stable security invoker set search_path = public, app as $$
  select app.effective_sla(p_sub_task);
$$;

create or replace function public.kpi_rollup(p_start date, p_end date)
returns table (kpi_definition_id uuid, scope_kind text, scope_id uuid, target numeric, actual numeric)
language sql stable security invoker set search_path = public, app as $$
  select * from app.kpi_rollup(p_start, p_end);
$$;

create or replace function public.attendance_deviation(p_user uuid, p_date date)
returns table (late boolean, short boolean, missing boolean, no_checkout boolean, suppressed boolean)
language sql stable security invoker set search_path = public, app as $$
  select * from app.attendance_deviation(p_user, p_date);
$$;

revoke execute on function
  public.effective_sla(uuid),
  public.kpi_rollup(date, date),
  public.attendance_deviation(uuid, date)
from anon;
grant execute on function public.effective_sla(uuid)                to authenticated;
grant execute on function public.kpi_rollup(date, date)             to authenticated;
grant execute on function public.attendance_deviation(uuid, date)   to authenticated;
