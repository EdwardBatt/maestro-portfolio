# ADR-0049: Brief ingestion runs on OpenAI

- **Status:** accepted (Edward, 27 Aug)
- **Date:** 2026-08-27
- **Open Decision:** — . **Amends ADR-0044 d.3** (which named Claude Sonnet 5) and **d.6**
  (retention). Everything else in ADR-0044 stands unchanged.
- **Task(s):** `I14.3`; relates to ADR-0002 (paid dependency), ADR-0028 (Edge Function secret
  pattern), ADR-0048 (which generates briefs through the same path)

## Context

ADR-0044 chose Claude Sonnet 5. Its own "Options weighed" section — added 27 Aug after Edward asked
why — recorded that the comparison was **a draw, not a win**: same tier, same price to within a tenth
of a cent per brief, both providers supporting enforced structured output, which is the only
capability this feature needs. It also recorded that the choice was reversible by design: one Edge
Function, one environment variable.

That reversibility is now being used, and for a reason that has nothing to do with model quality.

Edward, 27 Aug: the Anthropic account could not be funded at the time, so ingestion switches to an
OpenAI account that is already funded.

**This is a billing constraint, not a technical judgement, and the ADR says so plainly** so that
nobody later reads it as a verdict on either provider. The `for now` in Edward's sentence is real:
if the payment problem resolves, switching back is the same one-file change in the other direction.

### What made this cheap

ADR-0044 d.3's "model choice is config, not code" turned out to be worth more than it cost. The
provider-specific surface is **one file** — `supabase/functions/ingest-brief/handler.ts` — and within
it, one function. Nothing else in the feature knows which model answered:

- The Zod request and response schemas are provider-neutral.
- `briefOutputJsonSchema()` already emits every field as `required` with
  `additionalProperties: false` — which is exactly what OpenAI's `strict` mode demands, so **the
  schema needed no change at all**. It was written that way for Anthropic's strict mode and the two
  agree.
- The 50,000-character cap, the empty-fields-only merge, the `N/A` rule (ADR-0048 d.6), the
  heading-matching fallback and all 431 tests are untouched.

### What does not transfer, and must not be assumed

**ADR-0044 d.6 was granted against Anthropic's terms, and those terms do not follow the code.** The
27 Aug correction to that decision established two separate facts:

- **No training** on API data is *contractual* at Anthropic — a blanket commercial term, not a toggle.
- **Zero retention** is an enterprise arrangement requiring approval, which Maestro does not have.

At OpenAI the shape differs: not training on API data is the **default**, which an organisation can
opt out of; zero retention is likewise an approved arrangement, granted per project. The practical
position is similar but **it is a different company's promise**, and Edward's residency acceptance
(ADR-0044 Context, 26 Aug) was given for a data class, not for a vendor.

## Decision

1. **`ingest-brief` calls OpenAI's Responses API** — `POST https://api.openai.com/v1/responses`,
   `Authorization: Bearer`, with `text.format` = `{type: 'json_schema', strict: true, schema}` where
   the schema is the **unchanged** `briefOutputJsonSchema()`. Amends ADR-0044 d.3.

2. **The default model is `gpt-5.6-luna`**, and this is a deliberate step *down* from the like-for-like
   tier. Reading a brief and filling fourteen fields against a strict schema is extraction, not
   reasoning. Luna is roughly **$0.005 per brief against Terra's $0.049** — ten times cheaper on a
   feature with no aggregate spend cap (ADR-0044 d.9) and a bounded budget. Model stays an
   environment variable (`OPENAI_MODEL`), so moving up to `gpt-5.6-terra` if quality disappoints is a
   secret change, not a deploy.

3. **The secret is `OPENAI_API_KEY`**, read from the Edge Function environment exactly as
   `ANTHROPIC_API_KEY` was and `RESEND_API_KEY` is. **Never `VITE_`-prefixed**, never in `src/`,
   never committed. Absent, the function returns `503 model_unconfigured` and the wizard degrades to
   heading matching — unchanged behaviour.

4. **Truncation keeps its own error code.** OpenAI signals it as `status: 'incomplete'` with
   `incomplete_details.reason === 'max_output_tokens'` rather than Anthropic's
   `stop_reason: 'max_tokens'`. It maps to the existing `model_truncated`, not to
   `model_unavailable` — the distinction ADR-0048's predecessor review established, because a brief
   that needed more room is a budget to raise and an outage is not.

5. **The prompt-injection posture is unchanged, because it was never provider-specific.** No tools
   are sent, the model has no data access and can write nothing, and its answer is Zod-validated and
   rebuilt key-by-key from a frozen constant before it reaches the form. ADR-0044 d.4 stands as
   written.

6. **ADR-0044 d.6 is re-opened for this provider, not inherited.** Before ingestion is enabled in
   production Edward must confirm, against OpenAI's own terms: that API data is not used for
   training (their default, which must not have been opted out of), and whether zero retention is
   needed and available. **Nothing in the code enforces either** — same as before, and it belongs on
   the `docs/RUNBOOK.md` deployment checklist beside the secret. Inheriting the Anthropic answer
   would be assuming one company's promise covers another's.

7. **The Anthropic path is removed, not kept behind a flag.** Two live providers means two request
   shapes, two error mappings and two sets of tests, to serve a switch nobody has asked for. The
   heading-matching fallback already covers "the model path is unavailable", which is the only
   failure a second provider would have mitigated. Switching back is this ADR in reverse.

## Consequences

**Easier.** Edward can pay for it, which is the whole point. At Luna's rate the same credit buys
roughly ten times as many briefs, which matters more than it would on an unbounded budget.

**Harder.** ADR-0044's residency and training position has to be re-established rather than carried
over (d.6). The `claude-api` skill in `.claude/skills/` no longer describes the code in
`ingest-brief`, so a future agent reaching for it there will be reaching for the wrong reference —
the file's header comment says so explicitly.

**Locked in.** One provider at a time, no dual-path flag. The output schema stays strict-mode shaped,
which both providers accept — that constraint is now load-bearing for portability and should not be
relaxed to "optional fields" without re-reading this.

**Not a quality judgement.** ADR-0044's comparison found the two providers even at the same tier.
This ADR changes vendor for a payment reason and drops a tier for a cost reason; neither is evidence
about either company's models, and the first real client brief is still the first real test.

**Cost.** No new dependency, no new service. Per-brief cost falls by roughly 10× on the default
model. Still metered, still no aggregate cap (ADR-0044 d.9, now carrying the ADR-0048 load too).

**Testing.** The existing 431 tests stand; the handler suite's `fetch` stub changes shape to the
Responses API envelope. Specifically: a `status: 'incomplete'` with reason `max_output_tokens` yields
`model_truncated` and not `model_unavailable`; a refusal yields `model_declined`; a malformed answer
is dropped rather than forwarded; the key never appears in an error body or a log line; a caller
without `projects:manage` is refused before any billable call.
