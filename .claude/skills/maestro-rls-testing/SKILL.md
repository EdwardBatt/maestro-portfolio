---
name: maestro-rls-testing
description: Write adversarial pgTAP tests for Maestro RLS policies. Use for any change touching RLS, tenant isolation, joint-project sharing, or the client portal — the two highest-risk surfaces. Required before merge on those paths.
---

# Adversarial RLS testing

Every RLS policy gets at minimum one **allow** and one **deny** test. The joint-project and
client-portal surfaces get the full adversarial suite below — a scoping bug there is a
confidentiality breach (design doc §10.2/§10.4), so these paths carry the
"disproportionate testing" flag: test them beyond what feels proportionate.

Tests live in `supabase/tests/`, run with pgTAP via `supabase test db`.

## Fixture baseline

Seed at least: two unrelated tenants (A, B); a joint project hosted by A with B invited;
two clients inside A (C1, C2) each with a portal user; one user per role per tenant.
Simulate callers by setting the JWT claims the policies read
(`select set_config('request.jwt.claims', json_build_object('sub', :user_id, ...)::text, true);`)
— never by querying as superuser, which bypasses RLS and proves nothing.

## The adversarial matrix (joint project)

For every table reachable from a joint project, assert:

1. Tenant B member **with** project grant sees shared rows — and only shared fields.
2. Tenant B member **without** the grant sees zero rows.
3. Grant does not leak sideways: B's granted user cannot read A's *other* projects, clients,
   rates, capacity ceilings, or performance data.
4. Symmetry: repeat 1–3 with A and B swapped.
5. Writes: B can only insert/update rows tagged to its own tenant on the shared project;
   B cannot book A's resources.
6. Revocation: after the grant row is deleted, access returns to zero immediately.

## The adversarial matrix (client portal)

1. C1's portal user sees only C1's own work — never C2's, never another tenant's.
2. Exclusion list holds: no rates, no capacity/utilization, no internal-only threads, no SLA
   clock internals, no other clients' existence (count queries too — leaking *counts* is a leak).
3. Portal user has no write path except feedback and approval events on C1's own deliverables.
4. Approval events record who/which version/when and are append-only (UPDATE and DELETE
   both fail even for the creating user).
5. Media: signed-URL issuance is scoped per deliverable; a C1 URL request for a C2
   deliverable ID fails.
6. Anonymous/expired-session requests get zero rows on every portal-reachable relation.

## Append-only tables

For every audit/event table: INSERT succeeds for the authorized writer; UPDATE and DELETE
fail for **every** role including the row's creator and the table owner path used by the app.

Name tests after the policy under test (`bookings_portal_select__denies_other_client`).
A red adversarial test blocks merge — no exceptions, no "fix later".
