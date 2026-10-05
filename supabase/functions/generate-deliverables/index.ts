// generate-deliverables — proposes the deliverable list a brief implies (ADR-0048 d.4, I16.3).
//
// The wizard posts the brief it holds and NOTHING else; this returns a list of
// {name, typeCode, quantity, channel}. It writes nothing. The rows arrive in step 3 as editable,
// clearly-marked proposals, and the human-confirmed list is what becomes streams and deliverables
// on submit.
//
// The type vocabulary is the caller's OWN `deliverable_types`, read here on the caller-scoped
// client at call time (ADR-0054 d.2) — never sent by the browser, which is why the request schema
// is still `.strict()` and one field wide. The disciplines this header used to describe were
// removed by ADR-0050 d.6: the model proposes what to make, never who makes it.
//
// ONE FLOW (ADR-0048 d.3). This endpoint cannot tell whether the brief was typed by a person
// or filled by `ingest-brief`, and deliberately does not ask. Generation is a property of
// having complete inputs, not of having used the AI path.
//
// This file is four lines of substance. Everything else — the unconfigured-key 503 and the
// CORS preflight included — lives in handler.ts, where Vitest can reach it; `Deno.serve`
// running at import time is what keeps that code out of a test.
//
// SECRET. `OPENAI_API_KEY` is an Edge Function secret, shared with `ingest-brief`. It is read
// here from `Deno.env` and never leaves this process — putting it in the browser would hand a
// billable credential to every user (AGENTS.md §1). No `VITE_`-prefixed variable exists for
// it, which is the only way a value can reach the client bundle.
//
// Env (Supabase → Edge Functions → Secrets; Edward sets these, this repo never holds them):
//   OPENAI_API_KEY   required. Without it this returns 503 and the wizard says the list must
//                    be typed — which is exactly what people do today, so a missing key
//                    degrades rather than breaks.
//   OPENAI_MODEL     optional override. Defaults to gpt-5.6-luna (ADR-0049 d.2).
//   SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
//
// Deploy: `supabase functions deploy generate-deliverables` (Edward's action, not an agent's).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'
import { corsHeaders, createGenerateEntry, type CallerClient } from './handler.ts'

/** A user is watching the spinner. A list is a shorter answer than a brief, so a tighter bound. */
const MODEL_TIMEOUT_MS = 30_000

const entry = createGenerateEntry({
  getEnv: (key) => Deno.env.get(key),
  // One caller-scoped client, built from the request's own Authorization header. ADR-0037:
  // the permission primitive must run as the caller — a service-role client has no
  // auth.uid() and would resolve every grant to false. This function needs no elevated
  // client at all, because it reads and writes nothing.
  makeCallerClient: (authHeader) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }) as unknown as CallerClient,
  hasPermission,
  fetchImpl: fetch,
  timeoutMs: MODEL_TIMEOUT_MS,
})

Deno.serve(guarded(corsHeaders, entry))
