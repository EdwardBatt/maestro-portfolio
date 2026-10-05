-- Admin ability to read product feedback. Inserting this catalog row auto-grants
-- it to every existing tenant's Power Admin via the ADR-0008 catalog-insert
-- trigger, and Power Admin's whole-catalog seed covers future tenants. Feedback
-- is admin-only, so seed_tenant_roles needs no edit (no starter role gets it).
-- [alpha-feedback]

insert into permission_catalog (resource, action, description) values
  ('admin.feedback', 'view', 'Admin: read product feedback submissions')
on conflict do nothing;
