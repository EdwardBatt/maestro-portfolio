# ADR-0054: The model proposes a type from the tenant's own list

- **Status:** accepted
- **Date:** 2026-08-28
- **Open Decision:** — (Edward, 28 Aug: apply the deliverable taxonomy to the current flow)
- **Task(s):** I24 (the model half; exact sub-IDs assigned when `docs/TASKS.md` is edited on
  acceptance)
- **Depends on:** **ADR-0051** (`deliverable_types`, the vocabulary this reads). Extends
  **ADR-0050 d.6**, contradicts none of it. Consistent with **ADR-0044** (model boundary),
  **ADR-0049** (provider), **ADR-0037** (one call path).

## Context

`generate-deliverables` proposes the deliverable list a brief implies. Today it returns free
prose — `src/lib/brief/deliverables.ts`:

```ts
export interface ProposedDeliverable {
  name: string;
  quantity: number;
}
```

ADR-0051 gives the system a real vocabulary: `deliverable_types`, 16 categories and 240 codes,
seeded per tenant and then owned by that tenant outright. The two do not currently meet. Without a
decision here, the Account Manager gets a proposed row reading _"60-second hero film"_ and then
picks its type by hand from a 240-row list, for every row, on every brief. The retyping that
ADR-0044 exists to remove would come straight back in a new place.

### Why the model must return a code, not a name

Verified against `docs/reference/Agency Deliverable Taxonomy.md`: 240 codes, **228 unique names**.
Twelve names are used by more than one code, across different categories:

| Name                 | Codes            |
| -------------------- | ---------------- |
| Billboard            | ADV-006, ENV-010 |
| Bottle               | PAC-007, MER-006 |
| Campaign Strategy    | STR-012, CAM-001 |
| Event Branding       | ENV-006, EVT-010 |
| Event Video          | VID-013, EVT-012 |
| Label                | PRT-020, PAC-011 |
| Long-form Video      | SOC-006, VID-010 |
| Newsletter           | CNT-015, PRT-009 |
| Print Advertisement  | ADV-001, PRT-016 |
| Reel                 | SOC-004, VID-008 |
| Short-form Video     | SOC-005, VID-009 |
| Social Advertisement | ADV-003, SOC-009 |

A model that returns `"Reel"` has said nothing decidable: SOC-004 sits under SOCIAL MEDIA and
VID-008 under VIDEO & MOTION, and under ADR-0052 those may carry different workflow templates —
so the ambiguity does not stop at a label, it reaches which tasks get created. ADR-0051 d.4 already
settled the general rule (_"The code is the key; the name is not"_); this ADR is that rule applied
to the one producer of rows that is not a human with a dropdown in front of them.

### Why the list is read server-side, not sent by the client

ADR-0051 d.3 is **seed-then-edit**: a tenant renames rows, deactivates what it does not do, and
adds codes of its own. So there is no single list — there is one list per tenant, changing over
time. A vocabulary compiled into `src/lib/brief/` would be wrong for the first tenant that edited
theirs, which is the whole point of the table.

That leaves two places it can come from, and only one is defensible:

- **The client sends it.** The browser already renders the picker, so it has the rows. But the
  request would then carry a caller-supplied list of what the model is allowed to say, on an
  endpoint whose request schema is deliberately `.strict()` and one field wide. It also inflates
  every request by the size of the tenant's taxonomy.
- **The function reads it.** `generate-deliverables` already builds a caller-scoped Supabase client
  (`makeCallerClient`) and already asks `public.has_permission` through it. Reading
  `deliverable_types` on that same client is RLS-fenced by construction: it can only ever see the
  caller's tenant, and no service key is involved.

**This does not touch ADR-0037.** That rule forbids an Edge Function reading a _grant_ table to
decide authority. `deliverable_types` is a reference table, the read is caller-scoped, and
authorization still happens exactly where it does now — `authenticate`, then `hasProjectsManage`,
both before the body is parsed.

### The schema limit — researched, not assumed

A tenant with all 240 codes active puts 240 values into one `strict` enum. OpenAI's documented
limits, as raised in July 2025:

|                                                                        | Before | Now        |
| ---------------------------------------------------------------------- | ------ | ---------- |
| Enum values in total within a single schema                            | 500    | **1,000**  |
| Total characters across an enum's members, when it has **>250** values | 7,500  | **15,000** |
| Object properties                                                      | 100    | 5,000      |
| Characters in strings                                                  | 15,000 | 120,000    |

Measured against this repository's reference document: 240 values, and the codes total **1,680
characters** (2,400 as a JSON array). Two consequences:

1. 240 is comfortably inside the 1,000-value ceiling.
2. At 240 values the character rule **does not even engage** — it applies above 250. A tenant who
   added enough of its own codes to cross 250 would then be measured against 15,000 characters,
   and 250 seven-character codes is roughly 1,750. The headroom is roughly an order of magnitude
   in both directions.

⚠️ **Verify before implementing.** These numbers are corroborated by two sources — an OpenAI staff
announcement in the developer community and a secondary summary — but the official
`docs/guides/structured-outputs` "Supported schemas" section did not render its limits table
through the fetch tool, so I could not read them from the primary page. The check is one request
against the real API with a 240-value enum, and it belongs at the top of the implementation task,
not after it. If the limit turns out to be lower than 240, the fallback is the two-pass option
weighed below; the decision below is written so that swapping to it changes one function.

### Cost

ADR-0044 d.9 recorded that there is deliberately **no per-tenant quota and no monthly ceiling**, so
a per-call increase is not absorbed by a cap somewhere — it is simply paid. The addition here is
input-only:

- the enum: 240 codes ≈ **1,200 tokens**
- the legend that gives those codes meaning (d.3): 240 entries under 16 headings ≈ **2,000 tokens**

So roughly **3,000–3,500 added input tokens per call**, against a default model of
`gpt-5.6-luna` (`DEFAULT_MODEL`, ADR-0049 d.2) chosen for exactly this kind of schema-constrained
work. `MAX_OUTPUT_TOKENS` (4,000) is untouched — this is all input. Two things make it smaller than
it looks: the block is byte-identical between calls for a given tenant, so it sits in the prompt
prefix where caching applies; and the call is per-brief and initiated by a person, with no
background loop that could run away (ADR-0044 d.9's reasoning, unchanged).

It does not change the position. What it does change is the honesty of ADR-0044's open question —
whether a cheaper tier does this job — because a 3,000-token constant is a larger share of a Luna
call than of a frontier one, and the corpus test named there should now be run with the enum in
place rather than without it.

### Options weighed

**A. One call, full enum of the tenant's active codes.** ✅ Chosen. One round trip, and `strict`
makes an out-of-vocabulary code structurally impossible rather than merely unlikely. Costs the
tokens above. Fails only if the tenant list exceeds the API ceiling, which d.5 handles.

**B. Two passes — category first, then type within it.** Halves the enum in each call and puts the
category in front of the model explicitly. Rejected: it doubles latency and cost for a benefit d.3
gets for free by grouping the legend, and it introduces a failure mode with no good answer — a
first pass that picks the wrong category makes the second pass confidently wrong, with nothing in
the output to show it happened. **Held in reserve** as the fallback if the limit check fails.

**C. Free text plus server-side fuzzy matching.** Rejected on the evidence above: twelve names are
genuinely ambiguous, so a matcher would have to guess between two real codes in different
categories, and — worse — it would guess _silently_. That is precisely the failure Edward named on
27 August. A matcher also degrades as tenants rename rows, which ADR-0051 d.3 invites them to do.

> **AMENDMENT, 2026-08-29 — d.1 is superseded. Extraction and classification are two passes.**
>
> **What happened.** A brief plainly listing *"one 60-second hero film, three 15-second cutdowns, a
> key visual adapted for OOH in three cities, and a 30-day social calendar"* came back proposing
> **nothing**, silently. Edward: *"we are meant to be using the llm to make the work more
> intelligent… if you ask an agent to map the deliverables mentioned in the brief to the taxonomy it
> could not do it?"* He is right. That is not a hard extraction and not a hard classification.
>
> **Why option A failed, and it is structural rather than a wording problem.** d.1 put `type_code`
> on the extraction schema, **required on every row**, with a 240-value enum. Under `strict: true`
> the model is constrained *while it generates* — and `{"deliverables": []}` satisfies that schema
> perfectly at zero effort, because an empty array is always trivially valid. Making a hard
> sub-task mandatory per row therefore does not degrade classification; it makes the degenerate
> answer the cheapest one available. The measurements rule out size: 240 codes is 3.3KB of schema
> and ~1,900 prompt tokens, far inside every documented ceiling. Coupling was the fault, not scale.
>
> **This ADR also compared the wrong split.** Option B was rejected as *category-then-type*, on the
> sound reasoning that a first pass choosing the wrong category makes the second confidently wrong.
> **Extraction-then-classification has no such failure**: pass 1 cannot pick a wrong category, and
> pass 2's worst case is a null — which d.6 already makes legal and permanent. The rejection stands
> for the option it was written about and does not reach this one.
>
> **The decision now:**
>
> 1. **Pass 1 extracts.** `{name, quantity, channel}`. No type vocabulary, no legend. `channel`
>    stays because naming a channel is quoting the brief (d.8) and the list is 14 values, not 240.
> 2. **Pass 2 classifies.** The extracted names are sent as a numbered list with the
>    category-grouped legend (d.3, unchanged) and answered by **index** — two rows can legitimately
>    share a name, and positional alignment breaks on a short answer.
> 3. **Pass 2 can never cost a row.** A failure, timeout, malformed answer, unknown index,
>    unrecognised code, or no vocabulary at all leaves every row untyped and intact, and the
>    response reports `types: 'unavailable'` so the wizard says which half failed.
> 4. Everything else in this ADR stands: d.2 (read server-side, caller-scoped), d.3 (codes in the
>    enum, grouped legend), d.4 (revalidated server-side), d.5 (degrade visibly), d.6 (nullable end
>    to end), d.7 (never who does the work — now asserted on **both** prompts), d.8 (channel by
>    extraction only).
>
> **Cost.** A second call per brief, on a human-initiated action with no background loop (d.9's
> reasoning unchanged). Against losing the deliverable list entirely, that is not a close trade.
>
> **`I24.1` is now less load-bearing but not closed.** The enum still has 240 values on pass 2; what
> changed is that a refusal there costs types rather than rows.

## Decision

1. **`generate-deliverables` returns a type code.** The proposed row becomes
   `{ name, type_code, quantity }`. `name` and `quantity` keep their present meaning and limits
   (`MAX_DELIVERABLE_NAME_CHARS`, `MAX_DELIVERABLE_QUANTITY`, `MAX_PROPOSED_DELIVERABLES`).

2. **The permitted codes are the caller's own active `deliverable_types`, read server-side at call
   time** on the caller-scoped client the function already builds, and injected into the `strict`
   JSON schema as an enum. The request schema stays `.strict()` and one field wide: `{ brief }`.
   The client never sends the vocabulary and cannot influence it.

3. **The enum carries codes; the system prompt carries a legend grouped by category.** The enum
   values are the bare codes, so what the model must emit is short and exact. Their meaning arrives
   as a compact `CODE  Name` list under its 16 category headings. The grouping is the reason for
   the split rather than a composite `CODE — Name` enum value: a flat enum cannot show that SOC-004
   is a social-media Reel and VID-008 a video one, and that structure is what resolves the twelve
   ambiguous names. Both are built from one query in one function, so they cannot drift apart.

4. **The returned code is revalidated against the tenant's list server-side.** `strict` should make
   this impossible; it is checked anyway, because a schema guarantee that is merely believed is not
   a guarantee. A code that is absent, inactive, or unrecognised is **dropped, and the row kept** —
   `type_code: null`, name and quantity intact. `sanitizeProposedDeliverables` gains this, keeping
   its existing rule that a row which cannot be understood is discarded rather than repaired.

5. **A vocabulary that cannot be offered degrades visibly, and never silently.** If the tenant has
   no active types (a tenant provisioned before ADR-0051's seed, or one that deactivated
   everything), or the list exceeds the API's enum ceiling, the function **omits `type_code` from
   the schema entirely** and proposes exactly as it does today. The response says which happened,
   and the wizard tells the person the rows arrived without types so they can set them. An empty
   dropdown must never look like a model that had no opinion.

6. **`type_code` is nullable end to end** — schema, response, wizard row, and the
   `deliverables.deliverable_type_id` it eventually writes (ADR-0051 d.7). A row with no type is a
   legal row. Nothing filters it out, nothing blocks submission on it, and the wizard shows "no
   type set" the way ADR-0051 d.8 requires. The failure taxonomy in
   `deliverables-generate-api.ts` — `mismatch` / `unauthenticated` / `forbidden` / `too_long` /
   `unconfigured` / `unavailable` / `malformed` — is unchanged and still has no branch that returns
   an empty list to mean anything.

7. **This does not breach ADR-0050 d.6.** That decision says the model _"proposes what to make,
   never who makes it"_, and the prompt rule that enforces it — _"Never say who should do the work,
   which team, or which department"_ — **stays in the prompt verbatim**. A type is a property of the
   artefact: `deliverable_types` names no person, department, team or role (ADR-0051 d.14), and a
   deliverable's department still comes only from the owner the Account Manager names. The model is
   being given a more precise way to say _what_, and no way at all to say _who_.

8. **Channel IS proposed, by extraction only. Format is not.**

   The first draft of this ADR left both out, reasoning that "each inferred attribute is another
   thing a person must check, and a plausible-but-wrong value is worse than a blank one". That
   reasoning is right about **inference** and wrong about **extraction**. If a brief says _"three
   Instagram Reels"_, Instagram is not inferred — it is quoted, and `ingest-brief` already extracts
   quoted facts under ADR-0044 without anyone calling it a guess.

   It also undercut d.3. The single strongest signal for choosing `SOC-004` (a social Reel) over
   `VID-008` (a video Reel) is the brief naming Instagram. Declining to capture the thing that
   disambiguates the code makes the code worse, not the row safer.

   So `channel` is returned under one rule, stated in the prompt and enforced in the schema:
   **return a channel only if the brief names one; otherwise null.** It is revalidated
   server-side against the tenant's own channel list exactly as `type_code` is (ADR-0051 makes
   channel a tenant-editable attribute list), an unrecognised value is dropped while the row
   survives, and a null channel is a normal, permanent outcome — never an error and never a
   blocker.

   **Format stays out**, and the original argument holds cleanly for it: JPG versus PNG, MOV versus
   MP4 is a production decision that briefs do not state and a model can only invent. There is
   nothing to extract, so anything returned would be exactly the plausible-but-wrong value the
   first draft was right to refuse.

9. **`generate-brief` is unaffected.** It fills one brief's fields from a template's field list and
   never proposes deliverables; it shares only `_shared/model.ts` and `src/lib/brief/fields.ts`,
   neither of which changes. It remains built, tested and **undeployed**, and this ADR neither
   deploys it nor blocks it.

10. **The enum-size limit is verified against the live API before the code is written**, as the
    first step of the implementation task, and the finding recorded. If 240 values are refused, the
    fallback is option B — two passes, category then type — and only the schema-building function
    changes.

## Consequences

**Easier.** A proposed row arrives already classified, so the Account Manager confirms a type
instead of finding one in a 240-row list twenty-five times. The model's output stops being prose
the system cannot act on and becomes a key it can: ADR-0052's workflow template is selected by
type, so this is what lets a proposed TVC arrive with a shoot, an edit and a grade already listed.
And because the vocabulary is the tenant's own, an agency that renamed half the taxonomy gets
proposals in its own words rather than the seed's.

**Harder.** `generate-deliverables` gains a database read before the model call, which is a new
failure point in a path that had none — it must degrade to d.5 rather than fail, and that is a
branch to test rather than assume. Every call carries ~3,000 more input tokens. The function is no
longer a pure function of its request body, so its tests need a stubbed type list, and a
proposal is now reproducible only against a known vocabulary.

**Locked in.** The model proposes from a closed list it is given, never from memory of an industry
taxonomy. The list is the tenant's, read server-side, never client-supplied. The code is the key.
An unclassifiable row survives as an untyped row. And ADR-0050's line holds exactly where it was:
the model says what, a person says who.

**Not decided here.** Whether `format` is eventually proposed (d.8 says not, and says why). Whether a
cheaper model tier is sufficient once the enum is in the prompt — ADR-0044 left that open and this
ADR moves the number, so it should be measured, not re-argued. Whether the legend should be trimmed
for tenants with very large lists; at 240 codes it does not need to be.

**Cost.** No new dependency and no new service. One Edge Function changed (a read, a schema
builder, a prompt block), one shared library file changed (`src/lib/brief/deliverables.ts` — the
interface, the schema builder, the prompt, the sanitizer), one client schema widened
(`deliverables-generate-api.ts`), and the wizard's proposed-row shape gains a nullable field.
Per-call inference cost rises by the tokens above, against no aggregate cap (ADR-0044 d.9).

**Testing.** Unit, on the shared library: the schema built for a tenant contains exactly that
tenant's active codes and nothing else; a returned code outside the list yields `type_code: null`
with the row intact; an inactive code is treated as outside the list; an empty type list produces a
schema with no `type_code` property and a response that says so; a list over the ceiling does the
same. On the function: the type read is caller-scoped, and a caller from another tenant cannot
influence the vocabulary offered. On the client: a row with `type_code: null` renders, submits, and
shows "no type set"; and the existing guarantee is re-asserted — **there is no input for which this
path returns an empty list to mean a failure** (`classify-failure.test.ts`, extended rather than
replaced). Regression: the prompt still forbids naming who does the work, asserted directly against
the prompt string.

## Sources

- [Structured Outputs limits are raised to support larger schemas — OpenAI Developer Community, 11 July 2025](https://community.openai.com/t/structured-outputs-limits-are-raised-to-support-larger-schemas/1313593)
- [Structured model outputs — OpenAI API docs](https://developers.openai.com/api/docs/guides/structured-outputs) (limits table did not render through the fetch tool; see the verification note in Context)
