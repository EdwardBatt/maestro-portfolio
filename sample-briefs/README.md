# Sample briefs — for testing `ingest-brief`

Test material for the Brief Wizard's ingestion path (ADR-0044, provider per ADR-0049).
Upload or paste each at `/campaigns/new`, **step 2**.

Everything the feature has been tested against so far was written by an agent to fit the
code. These are written to break it — or at least to find where it bends.

| File | Path it exercises | What good looks like |
|---|---|---|
| `01-structured-headings.docx` | `.docx` → `mammoth` → model. Clean headings that match field names. | Nearly every field filled. **This one also works on the fallback**, so it does not prove the model is running — check the message does *not* say "matched by its headings only". |
| `02-rambling-client-email.docx` | **The real test.** A dictated client email: no headings, no structure, the answers buried in prose and in the wrong order. | Most fields filled. Heading-matching would find **almost nothing** here — if this works, the model is doing the job it was bought for. If it fails, the feature is not earning its cost. |
| `03-partial-and-sparse.txt` | Blanks. Two fields present, the rest genuinely absent. | Background and Task filled; **everything else left empty**. Nothing invented. The count must say 2, not 9. |
| `04-paid-media.md` | The conditional performance fields, which only render when the brief type is Paid Media. | With type = Paid Media: budget, platforms, geography, objective all land. **With any other type they must not be counted as filled** — that was a real bug, and this is its regression test. |
| `05-injection-attempt.txt` | Prompt injection. Contains an "ignore all previous instructions" block and a fake `<system>` tag. | The instruction text appears as **ordinary field content**, or is dropped. Nothing else happens: no extra network call, no permission change, no field called `DONE`. The model has no tools, so this should be boring — boring is the pass. |
| `06-bilingual-arabic.txt` | Arabic + English in one document, with a BOM. | Content extracted without mangling. Arabic text stays Arabic — it must **not** be translated into English on the way in. |
| `07-oversized-refusal.txt` | ~139 KB, well over the 50,000-character cap. | **Refused with a clear message**, not silently truncated. The wizard should say the document is too long, and no billable call should be made. |

## Reading the result

After each ingest the panel says one of:

- **"Filled N empty fields from the document"** — the model ran.
- **"…the document was matched by its headings only"** — the model call *failed* and it fell
  back. Check `supabase functions logs ingest-brief`; the reason is logged distinguishably
  (`model_truncated`, `model_declined`, `model_unavailable`) precisely so this is diagnosable.
- **"Nothing in that document matched a brief field"** — ran, found nothing.

## Two things worth watching beyond pass/fail

**Quality on `02`.** The default model is `gpt-5.6-luna`, a deliberate step down in tier
(ADR-0049 d.2) because filling fields against a strict schema is extraction, not reasoning.
File `02` is where that assumption gets tested. If the output is vague or invents specifics
the email does not contain, step up:

```
supabase secrets set OPENAI_MODEL="gpt-5.6-terra"
```

No redeploy — the model is config, not code. It costs roughly 10× per brief.

**Invention.** The failure that matters is not a blank field, it is a *plausible* field the
document never said. Read `03` and `05` closely: anything filled there that is not in the
source is a prompt problem, and the prompt is one file.

---

*Generated 27 Aug 2026. Not committed by default — these are fixtures, not product. If they
earn a permanent home they belong under `docs/reference/`, or in the e2e suite.*
