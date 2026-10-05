-- ADR-0117 addendum, 4 Oct (Edward, Q19) — I74.34. A campaign or single job must have at least one language: no
-- default, the person picks one or more. Until today the wizard let a campaign through with none, and every one of its
-- deliverables then had no language and no translation task.
--
-- Held where the campaign LEAVES DRAFT, on the row itself, so every path is governed the same:
--   - `complete_campaign_draft` (the wizard's and the single job's submit) moves a draft on — refused at the status
--     change when the campaign has no language;
--   - `create_campaign_from_brief` inserts the campaign already past draft and writes its languages straight after
--     (`app.write_campaign_content`) — refused at that write when the list is empty.
-- A draft may still be saved with none (the wizard saves each step). A campaign already past draft with none is NOT
-- changed — approving it, closing it or reopening it is not refused here; `scripts/db/campaigns-without-language.sql`
-- lists them for Edward. The refusal carries hint `campaign_languages_required`.
--
-- Safe on a populated database: two triggers and their function; no row is written.
begin;

create or replace function app.tg_campaign_needs_a_language() returns trigger
language plpgsql security definer set search_path = public, app, extensions as $$
begin
  if new.status = 'draft' or cardinality(coalesce(new.languages, '{}')) > 0 then
    return new;
  end if;
  -- `status`: only the move out of draft. `languages`: only a write of the list on a campaign already past draft —
  -- which is the content writer at creation; nothing else writes the list once a campaign has left draft.
  if (tg_argv[0] = 'status' and old.status = 'draft')
     or tg_argv[0] = 'languages' then
    raise exception '%',
      case when new.kind = 'single_job'
           then 'a job is made in at least one language — choose one beside what is being made'
           else 'a campaign is made in at least one language — choose one on the brief step' end
      using errcode = '22023', hint = 'campaign_languages_required';
  end if;
  return new;
end $$;
comment on function app.tg_campaign_needs_a_language() is
  'ADR-0117 addendum (Q19, 4 Oct): a campaign or single job leaves draft with at least one language (hint '
  'campaign_languages_required). Drafts may be saved with none; a campaign already past draft with none is left alone.';

drop trigger if exists campaign_needs_a_language_on_leaving_draft on campaigns;
create trigger campaign_needs_a_language_on_leaving_draft
  before update of status on campaigns
  for each row execute function app.tg_campaign_needs_a_language('status');

drop trigger if exists campaign_needs_a_language_when_written on campaigns;
create trigger campaign_needs_a_language_when_written
  before update of languages on campaigns
  for each row execute function app.tg_campaign_needs_a_language('languages');

commit;
