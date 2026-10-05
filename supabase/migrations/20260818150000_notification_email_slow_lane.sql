-- ADR-0028: email notifications — a per-event, high-signal slow lane.
--
-- The in-app inbox (I5b) is instant; email is the SECOND channel, for recipients who aren't in the
-- app. It is best-effort by construction (ADR-0015): the notifications row already persisted in the
-- business transaction (I5a emission triggers), so a missed email is never a lost notification.
--
-- Mechanism (mirrors the notification BROADCAST trigger + the realtime-auth GUARD pattern): an
-- AFTER INSERT trigger skips `due_soon`, then best-effort `net.http_post`s the notification id to the
-- `notify-email` Edge Function, which sends via Resend directly (localized, idempotent). pg_net is
-- async — it queues and its worker sends AFTER COMMIT, so the transaction is never blocked and the
-- row is visible when the function reads it. `net.http_post`/Vault are absent in plain Postgres (CI),
-- so the trigger returns cleanly and the insert still commits — this migration is a no-op in CI.
--
-- One-time hosted bootstrap (see ADR-0028 runbook): two Vault secrets — `project_url` and
-- `notify_email_bearer` (the service-role key) — and the function's `RESEND_API_KEY` /
-- `NOTIFY_EMAIL_FROM` / `APP_BASE_URL` env. CI needs none of it.

create or replace function app.tg_notification_email()
returns trigger language plpgsql security definer set search_path = public, app as $$
declare
  v_url    text;
  v_bearer text;
begin
  -- high-signal only: deadline reminders are a digest concern, not a per-event email (ADR-0028)
  if new.type = 'due_soon' then
    return new;
  end if;

  -- GUARD: pg_net absent (local/CI) → no-op, exactly like the realtime-authorization migrations.
  if to_regproc('net.http_post') is null then
    return new;
  end if;

  begin
    -- config from Vault (the same store Supabase's Database Webhooks use); absent → skip quietly
    if to_regclass('vault.decrypted_secrets') is null then
      return new;
    end if;
    select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url'         limit 1;
    select decrypted_secret into v_bearer from vault.decrypted_secrets where name = 'notify_email_bearer' limit 1;
    if v_url is null or v_bearer is null then
      return new;  -- not bootstrapped yet — inbox still works; email is the slow lane
    end if;

    -- fire-and-forget: pg_net queues now and its worker POSTs after commit
    perform net.http_post(
      url     := v_url || '/functions/v1/notify-email',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_bearer),
      body    := jsonb_build_object('id', new.id)
    );
  exception when others then
    null;  -- best-effort: the row is the source of truth (ADR-0015); the client reconciles the inbox
  end;

  return new;
end $$;
comment on function app.tg_notification_email() is
  'ADR-0028: best-effort email slow lane — enqueue a notify-email call for high-signal notifications (skip due_soon). Guarded so CI (no pg_net/Vault) is a no-op; failures swallowed, row stays source of truth.';

create trigger notification_email after insert on notifications
  for each row execute function app.tg_notification_email();
