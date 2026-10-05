-- Frontend bridge (I7/I8/I9 UI wiring): PostgREST exposes only the `public` schema
-- (supabase/config.toml → schemas = ["public","graphql_public"]), so the app-schema action
-- functions the UI needs to call require thin `public` wrappers the client can rpc() into — the
-- same convention as public.create_campaign_from_brief. Each wrapper is SECURITY INVOKER and only
-- forwards to its app function, which carries the real authority (SECURITY DEFINER + auth.uid()
-- checks). No logic is added or bypassed; the wrapper adds nothing but reachability. Grants:
-- authenticated only (anon revoked). authenticated already holds USAGE on schema app (every RLS
-- policy references app.* helpers) + EXECUTE on the underlying functions.

create or replace function public.sub_task_start(p_id uuid)
returns void language sql security invoker set search_path = public, app as $$
  select app.sub_task_start(p_id);
$$;

create or replace function public.sub_task_submit(p_id uuid, p_manual_minutes numeric default null)
returns void language sql security invoker set search_path = public, app as $$
  select app.sub_task_submit(p_id, p_manual_minutes);
$$;

create or replace function public.sub_task_request_changes(p_sub_task uuid)
returns void language sql security invoker set search_path = public, app as $$
  select app.sub_task_request_changes(p_sub_task);
$$;

create or replace function public.attendance_heartbeat()
returns void language sql security invoker set search_path = public, app as $$
  select app.attendance_heartbeat();
$$;

create or replace function public.attendance_start_day()
returns void language sql security invoker set search_path = public, app as $$
  select app.attendance_start_day();
$$;

create or replace function public.attendance_end_day()
returns void language sql security invoker set search_path = public, app as $$
  select app.attendance_end_day();
$$;

revoke execute on function
  public.sub_task_start(uuid),
  public.sub_task_submit(uuid, numeric),
  public.sub_task_request_changes(uuid),
  public.attendance_heartbeat(),
  public.attendance_start_day(),
  public.attendance_end_day()
from anon;
grant execute on function public.sub_task_start(uuid)               to authenticated;
grant execute on function public.sub_task_submit(uuid, numeric)     to authenticated;
grant execute on function public.sub_task_request_changes(uuid)     to authenticated;
grant execute on function public.attendance_heartbeat()             to authenticated;
grant execute on function public.attendance_start_day()             to authenticated;
grant execute on function public.attendance_end_day()               to authenticated;
