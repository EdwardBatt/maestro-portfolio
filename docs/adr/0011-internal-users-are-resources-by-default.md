# ADR-0011: Internal users are bookable resources by default (provisioned at invite)

- **Status:** accepted
- **Date:** 2026-08-12
- **Relates to:** ADR-0008 (RBAC), ADR-0009 (teams); tasks L1.1 (invite), L1.4 (Resources admin), L1.5, L2.1 (master-grid filters)
- **Companion:** `docs/nickname-wordlists.md` (the curated nickname pools)
- **Sign-off:** Edward approved the decision and the initial (English-only) word list on 2026-08-12; the
  Arabic-adjective expansion remains a later enhancement pending native-speaker review (see the word-list file).

## Context

Maestro separates a **user** (login + role) from a **resource** (a schedulable, bookable entity).
Today, inviting a user never creates a resource; the invite form only offers a manual "link to an
existing, unlinked human resource" dropdown, and there is no Admin → Resources screen (L1.4) to
create resources in the first place. Result: an invited person cannot be scheduled, and there is no
UI path to fix that. In reality **most internal staff are bookable resources**, so the separate
manual step is friction on the common case.

The obstacle to auto-creating a resource at invite is a database rule that **resource names must be
unique per tenant** (`uq_resources_tenant_name`). The login id and resource id are always unique —
that is not the issue — but two staff genuinely share a **display name** across departments/org (and,
though rare, sometimes within a team). Filtering the schedule by team disambiguates most cases but
NOT two identical names inside the same team; a stable unique handle does.

## Decision

1. **Internal users are bookable resources by default.** The invite form gains a toggle
   *"Also a bookable resource"* — **default ON**, switched off manually for the exceptions. When ON,
   `invite-user` auto-creates a `resources` row: `kind='human'`, `capacity_model='load_based'` with
   default **ceiling 120% / warn 100%**, `department_id`/`team_id`/`office_id` inherited from the invite,
   `user_id` linked, `is_active=true`. Rates stay null (admin-only, set later).

2. **Add a unique `nickname`; drop the org-wide name-unique rule.** `resources.name` (display) becomes
   **non-unique**; a new **`nickname`** (short handle) is **unique per tenant** and is the unambiguous
   identifier — it also resolves the rare *same name within the same team* case that team filtering
   cannot. At invite the nickname is **auto-generated as a fun, MENA-flavoured handle**: a random
   adjective + noun from curated, signed-off pools (`docs/nickname-wordlists.md`) — e.g. *Turbo Koshari*,
   *Golden Gazelle* — de-duplicated (re-rolled on a clash, numeric suffix as last resort), so it never
   fails and needs no input. **Fun for all** (nicknames are internal-only — clients never see them),
   with a 🎲 reroll on the form and full edit; the real name always shows beside it. `uq_resources_tenant_name`
   is dropped and `unique(tenant_id, nickname)` replaces it. The master schedule filters by category
   (kind) + team and shows name + nickname.

3. **Remove the manual "link to existing resource" step from the invite form.** Linking a login to a
   pre-existing resource (the rare case) is handled from the **Resources admin** (link/unlink user).

4. **Resource-create folds into the invite permission.** A caller with `users:manage` may auto-create
   the person's resource; no separate `resources:manage` is required at invite. Revisit later if needed.

5. **Admin → Resources (L1.4) is still required** — equipment/rooms, editing capacity/rates/nicknames,
   activate/deactivate, unlinking, and resources with no login. This ADR complements L1.4.

## Consequences

Easier: inviting an internal person makes them schedulable in one step; no orphaned "user without a
resource"; every resource has one unambiguous, and now morale-friendly, handle.

Harder / follow-through: a new `nickname` column + unique index + generator (adjective+noun, de-dup) in
`invite-user`; the **word lists must be reviewed and signed off by an Egyptian/Iraqi Arabic speaker**
before shipping (connotation, gender of any Arabic words, cross-language reading); the master schedule
shows name + nickname and offers team + category filters (L2.1); the Resources admin (L1.4) must ship.

Locked in: internal-user-as-resource is the default, provisioned at invite; display names are not
unique but **nicknames are**; scheduling disambiguates by nickname + team/category.
