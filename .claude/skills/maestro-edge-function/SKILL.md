---
name: maestro-edge-function
description: Scaffold or modify a Maestro Supabase Edge Function (Deno/TS). Use for any server-side workflow or calculation — booking transitions, approval routing, SLA evaluation, exports. Enforces auth, Zod validation, error envelope, and logic-placement rules.
---

# Maestro Edge Functions

Edge Functions own **workflows and calculations** (design doc §3.1): booking state
transitions, approval routing, SLA evaluation, finance export. They never render, and the
frontend never re-implements their math. Hard invariants stay in Postgres — an Edge Function
may assume the DB will reject a double-booked exclusive resource, and must handle that
rejection gracefully.

One folder per function: `supabase/functions/<kebab-case-name>/index.ts`, name matching the
route (`booking-transition`, `finance-export`).

## Required structure

```ts
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

const Input = z.object({
  bookingId: z.string().uuid(),
  action: z.enum(["confirm", "cancel"]),
}); // 1. Zod-parse EVERY input — client data is hostile

Deno.serve(async (req) => {
  // 2. Authenticate: derive the caller from the JWT (Authorization header).
  //    Reject anon unless the route is explicitly public (none are, today).
  // 3. Authorize: check the caller's right to THIS resource. Prefer running as the
  //    caller (user-scoped client) so RLS keeps enforcing; service-role client only
  //    when the workflow genuinely must cross RLS — and then authorize explicitly first.
  // 4. Do the work in small, testable pure functions imported from ./lib.ts.
  // 5. Structured result envelope; never leak stack traces, SQL, or internal errors.
});
```

## Rules

- **Secrets** only via `Deno.env.get(...)` — never inline, never logged. Service-role key
  usage is a flag for extra review; each use states in a comment why RLS must be crossed.
- **Validation:** Zod schema per function, exported so unit tests reuse it. Unknown keys stripped.
- **Errors:** return `{ error: { code, message } }` with correct HTTP status; log the detail
  server-side without PII; never echo raw DB errors to the client.
- **Money/time correctness:** all timestamps UTC in/out; rounding rules for billing live in
  one shared module with unit tests, not scattered.
- **Dynamic SQL is banned.** Parameterized queries / PostgREST only.
- **Idempotency:** state transitions accept an idempotency key or verify current state first —
  a retried `confirm` must not double-fire side effects (notifications, exports).
- **Tests:** pure logic in `lib.ts` gets Vitest coverage (Deno-compatible); state-machine
  transitions get a table-driven test enumerating every from→to pair, legal and illegal.
- Period-locked data (finance export, §9.5): a locked period is read-only — the function
  refuses regeneration for locked periods rather than silently recomputing.
