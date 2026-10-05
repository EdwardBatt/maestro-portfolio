-- I59 E9 — `escalation_unreached` (20260926133000) was never granted to `authenticated`, so
-- `escalation_rules_reaching_nobody()`, which is SECURITY INVOKER and reads it, answered every admin
-- with 42501 "permission denied for table escalation_unreached" on the local stack — and the settings
-- screen, which reads that answer defensively, showed "reaches nobody" on no rule at all. Found by the
-- browser suite (coverage/escalation-settings E9), not by pgTAP: `verify.sh` sets default privileges
-- first, which hides it (docs/memory/traps.md, "A new table answers permission denied on the local
-- stack though its RLS and pgTAP are fine").
--
-- SELECT only: the sweep (service role, 20260926152000) is its only writer. The rows an admin may
-- read are still decided by `escalation_unreached_admin_select` (organization:manage, own tenant).

begin;

grant select on table public.escalation_unreached to authenticated;

commit;
