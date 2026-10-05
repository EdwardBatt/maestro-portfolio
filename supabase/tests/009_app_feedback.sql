-- app_feedback RLS (alpha-feedback): submit-as-self allowed, spoof denied,
-- reads gated by admin.feedback:view, and every submission is audited.
begin;
select plan(6);
\ir helpers/seed.sql

-- Power Admin (tenant A) auto-holds the new admin.feedback:view grant.
select ok(
  exists (
    select 1 from role_grants rg join roles r on r.id = rg.role_id
    where r.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001'
      and r.key = 'power_admin'
      and rg.resource = 'admin.feedback' and rg.action = 'view'
  ),
  'Power Admin auto-holds admin.feedback:view (catalog trigger + whole-catalog seed)'
);

-- Act as a team member (no admin.feedback:view).
set local role authenticated;
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a003'), true);

-- Submit own feedback: allowed.
select lives_ok($$
  insert into app_feedback (tenant_id, submitted_by, category, message, page_path, app_version)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a003',
          'bug', 'The chip drag lost my booking', '/schedule', '0.1.0-alpha')
$$, 'team member can submit feedback as themselves');

-- Attribute feedback to someone else: rejected by the insert policy (42501).
select throws_ok($$
  insert into app_feedback (tenant_id, submitted_by, category, message)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000a001',
          'other', 'not me')
$$, '42501', null, 'cannot submit feedback as another user');

-- Non-admin cannot read submissions (RLS filters silently — even their own).
select is(
  (select count(*)::int from app_feedback),
  0, 'team member without admin.feedback:view reads no feedback');

-- Power Admin reads the tenant's feedback.
select set_config('request.jwt.claims',
  (select jwt from test_claims where id = '00000000-0000-0000-0000-00000000a001'), true);
select is(
  (select count(*)::int from app_feedback),
  1, 'Power Admin reads submitted feedback in the tenant');

-- The submission was captured by the universal audit trigger.
reset role;
select is(
  (select count(*)::int from audit_events where entity = 'app_feedback' and action = 'insert'),
  1, 'feedback submission is written to the audit log');

select * from finish();
rollback;
