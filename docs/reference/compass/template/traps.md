---
type: trap
status: current
origin: ai-derived
verified: 2026-09-08
sources: [session work]
---

# Traps

Non-obvious failure modes that have actually cost time on this project. Each one is here because
something broke, not because it might. **Read this before debugging anything that "should work".**

**The bar for an entry:** it took more than a few minutes to understand AND the cause was not visible
from the symptom. General advice does not go here. Neither does anything a stack trace names.

Each entry ends with what it cost — that is what tells the next reader whether to take it seriously.

## Index — read this, then only the entries you need

**This file grows without limit and becomes the most expensive thing in the store.** Capsules are
capped at 60 lines; traps are not, because you cannot cap what a codebase does to you. So it carries
its own map: scan the lines below, open the two or three that could be your symptom, skip the rest.
In Maestro this file reached ~12,000 tokens against an index of ~1,100.

**Word each line as the SYMPTOM, not the cause** — you are matching against what you are looking at,
not against what turns out to be wrong. That is the whole point of the file.

`scripts/compass-lint.mjs` fails the build on any entry the index does not list: an unindexed entry
is one nobody will ever be routed to, and nothing else would notice.

**<Section>**
- [A one-line statement of the trap, as a fact](#a-one-line-statement-of-the-trap-as-a-fact)

---

<!-- Delete this example once you have a real one. -->

### A one-line statement of the trap, as a fact

<What you see. What is actually happening. Why the two look unrelated. What to do instead.>

*Cost: <how long, and how it was eventually found — a test, a person, a query>.*
