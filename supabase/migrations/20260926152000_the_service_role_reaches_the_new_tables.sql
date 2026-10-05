-- I59 integration (25 Sep) — the service role reaches the tables today's work created.
--
-- The local browser suite reads and seeds through the service role, and so does the escalation sweep
-- (supabase/functions/stall-sweep). The local CLI grants new tables to nobody by default, and the seed's
-- grants stand-in (I43.2) covers only the tables that existed when it ran — so these six were refused
-- with 42501 for the service role. The hosted project's default privileges already grant them; this
-- makes the grant explicit, so both behave the same. RLS is unaffected (the service role bypasses it,
-- as it always has).

begin;

grant select, insert, update, delete on table
  public.tenant_escalation_rules,
  public.tenant_filler_words,
  public.escalation_log,
  public.escalation_unreached,
  public.deliverable_change_requests,
  public.piece_messages
to service_role;

commit;
