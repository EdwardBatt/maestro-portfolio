-- ADR-0015: Realtime Authorization for chat Broadcast (private channels).
--
-- A client may RECEIVE on a conversation's private topic `tenant:{tid}:conv:{cid}` only if it is a
-- member of that conversation. Sends are done by the service-role `chat` function (which bypasses
-- this), so clients need receive-only authorization here.
--
-- `realtime.messages` and `realtime.topic()` exist only on a real Supabase project, not in the
-- local/CI harness — so the policy is created inside a guard. In CI (`to_regclass` is null) this
-- migration is a clean no-op; on Supabase it installs the policy. Authorization behaviour is
-- therefore verified on Supabase, not in pgTAP (documented, not silently skipped).

do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent (local/CI harness) — skipping chat Realtime Authorization policy';
    return;
  end if;

  execute 'drop policy if exists chat_members_receive_broadcast on realtime.messages';
  execute $pol$
    create policy chat_members_receive_broadcast on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and exists (
          select 1
          from public.conversation_members m
          where m.user_id = (select auth.uid())
            and (select realtime.topic()) = 'tenant:' || m.tenant_id::text || ':conv:' || m.conversation_id::text
        )
      )
  $pol$;
end $$;
