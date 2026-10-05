# ADR-0123: A client is registered in six steps, as a draft, and the account director activates it

- **Status:** accepted (Edward, 2026-09-28)
- **Date:** 2026-09-28
- **Relates to / amends:** ADR-0021 (client registration is a Client Services surface; the profile in
  `clients.profile`) — **amends d.3 (the required core) and the one-page form**; ADR-0022 (a brand's four folders);
  ADR-0005 (the working week is per office) — **amended by d.3**; ADR-0073 / ADR-0074 (the account director,
  reach across every account); ADR-0067 (drafts — until now campaigns only); I56.6 (campaign rules on top of the
  client's); the SJ-02 note ("who asked" is free text, so no contacts table) — **reversed by d.4**.
- **Task(s):** I62 (section J)
- **Reference:** Figma section `J · CLIENT REGISTRATION — the account director only` (node `1614:413`): CL-v3-01
  Basics `1614:416`, 02 Brands `1614:538`, 03 People `1614:647`, 04 Dos and don'ts `1614:770`, 05 How we work
  `1614:897`, 06 Review and activate `1614:1032`, CV-01 Clients `1634:518`, CV-02 Client — Kite `1634:723`.

## Context

Edward, 28 Sep: *"fix the client registration. as per J in figma… exactly as per the layout in figma."*

Today a client is registered in one modal (`ClientForm`): name, Odoo code, account manager, what they sell, business
types, eight profile fields, e-commerce and app sections, and the dos and don'ts. It is usable the moment it is saved,
by anyone holding `clients:manage` (account manager, account director, Traffic, Power Admin). `/clients` is one flat
table of clients and one of brands; there is no client page.

Section J registers a client in six steps — Basics, Brands, People, Dos and don'ts, How we work, Review and activate —
saves it as a **draft** from the first step, and **activates** it at the end. It adds what Maestro does not record:
the client's country (which "sets the working week for every job they ever raise"), a brand's short name, the people
at the client, and the languages each rule applies in. It replaces the flat list with a clients list (Active / Drafts
/ All) and a client page (Overview, Campaigns, Brands, People, Dos and don'ts, Library).

The frames disagree with each other on one point: the Basics step says *"Only the account director does this"*; the
clients list says *"Anyone can start a client; only the account director activates one"* and shows an account
manager's draft waiting for the director. Edward chose the second (question 1, A).

Five questions were put and answered on 28 Sep, one at a time.

## Decision

1. **Anyone who may manage clients starts a draft; only the Account Director — and the Power Admin — activates it**
   (Edward: A). A client is saved as a draft from the Basics step (name, country, account manager). Activating is a
   separate act behind a new permission, `clients:approve` (the catalogue's actions are fixed; activating a client is
   the director approving it), seeded to the Account Director and held by the Power
   Admin through the catalogue. The person and the time are recorded on the client.

2. **A draft cannot be used.** It is not offered in any client picker — the campaign wizard, the single job, the
   library, the audit filters — and no campaign or job can be raised for it (enforced in the database, not only
   hidden). Every client that exists today becomes active, activated by the migration.

3. **The client's country drives the working-day arithmetic of that client's work** (Edward: B). A client has a
   country; a country carries its working week (a list the organisation keeps: Iraq Sun–Thu, the UAE Mon–Fri, …). For
   that client's jobs and campaigns the country's week is the calendar for lead times, planning back from a go-live,
   due dates, the at-risk and late checks, and extension arithmetic — today the Iraq calendar is used for everyone.
   A person's own capacity (bookings, load, the ceiling) stays on their office's week (ADR-0005): people work their
   office's days; the client's days decide when its work is due. Existing clients take the country of the office
   they have always been worked from (Iraq).

4. **The people at the client are records on the client** (Edward: A) — name, role at the client, how to reach them
   (WhatsApp, email, phone), and three flags: may ask for work, signs off, is copied. They are not logins; nobody at
   the client uses Maestro. A job's "who asked" and "record sign-off from" offer the client's people, and a typed name
   is still accepted. This reverses the SJ-02 note.

5. **A client rule carries the languages it applies in, and is locked once the client is active** (Edward: A). Each
   do / don't names its languages from the organisation's own (Arabic, English, Kurdish). After activation only the
   Account Director or the Power Admin changes a client rule; a campaign still adds its own on top and never removes
   the client's (I56.6). Existing rules apply in every language and lock the same way.

6. **The profile fields the frames leave out are no longer asked** (Edward: A) — what they sell, selling points, best
   sellers, economics, daily capacity, seasonality, past lessons, digital presence, sales process, and the e-commerce
   and app sections. Nothing else in Maestro reads them. What is already saved stays in `clients.profile`, untouched,
   so they can return if the design brings them back. ADR-0021 d.3's required core ("what they sell") is replaced by
   the Basics step's: name, country, account manager. **The review report lists every removed field.**

7. **A brand has a short name** — what lists and pickers show ("Luma · LUMA"). Adding a brand still creates its four
   empty folders (ADR-0022).

8. **The screens are the frames**: the six-step registration with its profile meter and "saved as a draft", the
   clients list, and the client page. What they show is read from what Maestro already records (campaigns, pieces,
   Needs you, the library), and "How we work" shows the global lead times and the derived settings read-only.

## Consequences

**Easier.** A client is a commitment made on purpose: account managers can start one with what they know, and the
director checks it before work can be raised. The people who ask and sign off are chosen, not retyped on every job.
Rules say which languages they govern, so an English caption is not held to an Arabic-only rule.

**Harder.**
- d.3 reaches the deadline arithmetic everywhere it runs — `lib/campaigns/go-live-dates.ts`, `lib/campaigns/lead-time.ts`,
  `features/intake/lib/lead-time.ts`, `lib/timing/plan-back.ts`, `lib/deadlines/at-risk.ts`,
  `lib/deadlines/extension-arithmetic.ts` and `features/campaigns/lib/timeline-bars.ts`. Each is given the client's
  calendar (`lib/calendar/client-calendar.ts`) instead of assuming Iraq, and tested per country. The server's
  `app.working_hours_between` is on no live path — escalations run on real elapsed hours (ADR-0108 d.1) — so it is
  left as it is.
- d.2 needs every client read that offers a choice to filter drafts, and a database check on campaigns and jobs.
- d.5 moves the right to edit an active client's rules from everyone with `clients:manage` to the director.
- The current form's tests and browser specs (`client-form-*`, `client-register`, `brand-add-*`) are replaced.

**Locked in.** Clients have a lifecycle (draft → active); `clients:approve` is the director's; client rules carry
languages and lock on activation; contacts are records, not users; the client's country, not the office, decides its
work's working days.

**Not decided here.** A client being deactivated or archived; the client portal (M10) — contacts are not its users;
public holidays per country.

**Money and licensing.** None. No new dependency.

## Addendum — asking the director (28 Sep, implementation)

CV-01's draft row has *Ask the director to activate*. The client records who asked and when
(`activation_requested_at`, `activation_requested_by`), and a trigger tells every active holder of `clients:approve`
with a `client_activation_requested` notification that opens the draft's Review step; never the one who asked. It is
`SECURITY DEFINER` with `search_path` pinned, as every notification writer is: `notifications` has no insert policy
for `authenticated`. Migration `20260928140000`; pgTAP 193.
