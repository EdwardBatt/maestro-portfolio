# ADR-0122: The dashboard view is chosen by reach and permissions, never by role name

- **Status:** accepted (Edward, 2026-09-28)
- **Date:** 2026-09-28
- **Relates to:** ADR-0008 (roles are data; surfaces are grant-driven), ADR-0009 (reach tiers), ADR-0017
  (C-suite, deputy), **ADR-0018** (dashboards are grant-driven, scope-parameterized, three tiers), ADR-0100
  (department briefs retired), ADR-0120 (view as a person)
- **Task(s):** I61.1 (this ADR); I61 (the role dashboards)
- **Reference:** Figma section `H · DASHBOARDS · one shape, three people` (node `1592:2`: DB-AM `1592:5`,
  DB-L `1592:118`, DB-M `1592:245`, T8 `1596:497`); `E2EV1.pen` frames Health · C-Level `LMT0H`, Dept Lead
  `M3PN89`, Team Lead `KkL7L`, Traffic Manager `TLrWz`, Power Admin `HZ0NI`, Client Services `HYgHR`; the
  data map `(a private design artifact, not included)` (28 Sep)

## Context

Edward, 28 Sep: the dashboards are the day's work. Figma section H sets the layout, styling and colour, and
the designer's own note is *"Same page for everyone. Only the rows change."* It shows three people (an
account manager, a creative lead, a maker). `E2EV1.pen` holds six dashboards, each tailored to one kind of
person: C-Level, Department Lead, Team Lead (the Deputy Team Leader uses it too), Traffic Manager, Power
Admin, and Client Services (Account Director and Account Manager). The Team Member view is missing from
the .pen, and Figma's maker frame (DB-M) covers it. That makes **seven views**.

ADR-0018 d.1 locks dashboards as grant-driven and scope-parameterized, *"not per-role screens"*, and
ADR-0008 forbids anything that keys off a role's **name**: roles are tenant data, renamed and added from the
Roles screen. Seven role-shaped views look like a reversal of that rule, but they need not be one. Every
view is the same five blocks (a verdict sentence, a top bar of four problem numbers, two charts, a
breakdown, and "What to touch today"). The views differ only in which rows fill those blocks, and each
difference follows from **how far the person reaches** and **what they may do**.

Options weighed (Edward chose A, 28 Sep):

- **A. Choose the view from reach (`roles.scope`) and permissions.** The seven views become seven *reach
  levels*. A role renamed on the Roles screen keeps its dashboard. A new role gets the view its reach and
  grants imply, with nothing to code. Cost: two views share the widest reach (Traffic and C-Level both reach
  the whole company), so a permission has to separate them, and that test has to be stated exactly.
- **B. Choose by role name.** Simple to read in code. But it breaks ADR-0008 and ADR-0018: a renamed role
  loses its dashboard, a new role gets none until someone codes it in, and a tenant's own role names never
  match. Rejected.

## Decision

1. **One dashboard, seven views, chosen from the viewer's reach and permissions, never from the role's
   name.** Every view uses the same five blocks from Figma section H. Only the rows change.

2. **The view is picked by these rules, applied in order. The first rule that matches wins:**

   | Order | The viewer… | View |
   |---|---|---|
   | 1 | may change roles (`roles:manage`) | **Power Admin** |
   | 2 | reaches the whole company (`tenant`) and may run the work (`projects:manage`) | **Traffic Manager** |
   | 3 | reaches the whole company (`tenant`) and holds `health:view` | **C-Level**, read-only |
   | 4 | reaches every account (`all_accounts`) | **Client Services**, with the per-manager rows |
   | 5 | reaches their accounts (`account`) | **Client Services** |
   | 6 | reaches a department (`department`) | **Department Lead** |
   | 7 | reaches a team (`team`) | **Team Lead** (the Deputy Team Leader included) |
   | 8 | reaches themselves (`self`), or matches nothing above | **Team Member** |

   Rule 8 is the floor, so every signed-in internal person gets a dashboard (the UI never dead-ends).

   Why `roles:manage` and not an admin *viewing* permission: the CEO holds `admin.roles:view`, and the COO
   and CFO hold other admin viewing permissions (seeded in `app.seed_tenant_roles`, `20260924120000`). Only the Power Admin holds `roles:manage` today. The CEO, COO and CFO hold neither
   `roles:manage` nor `projects:manage`, so they fall through to rule 3.

3. **Rows inside a view still follow the viewer's own permissions and reach**, as ADR-0018 d.2 to d.6
   require. A row whose permission the viewer lacks is absent, not hidden. The view decides the layout;
   it never widens what the person may read.

4. **The top bar holds the exceptions.** Its four numbers are the problems that need this person, and each
   one opens the place where the action is taken (the task, the Team page on a filter, the Schedule on a
   clash). A person's own exceptions stay theirs (ADR-0018 d.3). The issues each view highlights are listed
   in the 28 Sep data map.

5. **View as a person (ADR-0120) shows the person's view**, because the rules read that person's reach and
   permissions.

6. **Every signed-in internal person can open the Dashboard, and it shows only what they already reach**
   (Edward, 28 Sep). The Dashboard leaves the admin address, and the admin permissions no longer gate it.
   No view shows data the person could not already open elsewhere. A team lead sees their team, never another
   department. Company-wide numbers stay with whole-company reach.

## Consequences

**Easier.** No role is special-cased. Renaming a role, or giving a tenant its own role names, leaves every
dashboard intact. The seven views share one layout and one set of building blocks, so there is one page
to build and test, not seven. ADR-0018's three tiers survive: My Work stays the action surface, and the
dashboard is where oversight and health rows land for the people who hold them.

**Harder.** The rule order in d.2 is itself a design choice. A role with an unusual mix of reach and grants
lands on the first matching view, which may surprise. Example: a Department Lead given `roles:manage`
sees the Power Admin view. **Answered by Edward, 28 Sep (A):** the Traffic Manager is
given every permission on production (I59.41) **except `roles:manage`**, so Traffic stays on the Traffic view
and changing roles stays with the Power Admin. Tests have to prove the order view by view, and "view as a person" has to be
checked against each one.

**Locked in.** The view follows reach and permissions. The permission names in d.2 (`roles:manage`,
`projects:manage`, `health:view`) become the tests that separate the widest views; changing them later
means a new ADR.

**Not decided here.** The Power Admin's system rows (I61.4).

**Money and licensing.** None. No new dependency.
