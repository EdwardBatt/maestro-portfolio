// propose-concepts — the ONE working concept proposed against a department's brief (ADR-0065 and
// its 13 Sep addendum, I34.2 / I48.15).
//
// One call per department that has a brief. It reads that brief SERVER-SIDE on the caller's own
// client — the browser sends an id and nothing else — and either proposes the concept (first
// press) or REGENERATES only the items a person deleted (addendum d.11), with the kept items as
// fixed context, refining the same `campaign_concepts` row in place (d.10).
//
// It never writes `campaign_briefs.values`. A concept is a proposal; approving a brief does not
// approve concepts (d.6), and the schema keeps that true rather than the UI remembering it.
//
// This file is four lines of substance. Everything else — the unconfigured-key 503 and the CORS
// preflight included — lives in handler.ts, where Vitest can reach it; `Deno.serve` running at
// import time is what keeps that code out of a test.
//
// SECRET. `OPENAI_API_KEY` is an Edge Function secret, shared with `ingest-brief`,
// `generate-brief` and `generate-deliverables`. It is read here from `Deno.env` and never leaves
// this process — putting it in the browser would hand a billable credential to every user
// (AGENTS.md §1). No `VITE_`-prefixed variable exists for it, which is the only way a value can
// reach the client bundle.
//
// Env (Supabase → Edge Functions → Secrets; Edward sets these, this repo never holds them):
//   OPENAI_API_KEY   required. Without it this returns 503 and the button says concepts are not
//                    configured — the brief itself is unaffected, which is the whole point of
//                    keeping this separate from `generate-brief`.
//   OPENAI_MODEL     optional override. Defaults to gpt-5.6-luna (ADR-0049 d.2, ADR-0065 d.9).
//   SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
//
// Deploy: `supabase functions deploy propose-concepts` (Edward's action, not an agent's).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'
import { corsHeaders, createProposeConceptsEntry, type CallerClient } from './handler.ts'

/** A person is watching a spinner, and four sections is a longer answer than one brief field. */
const MODEL_TIMEOUT_MS = 60_000

const entry = createProposeConceptsEntry({
  getEnv: (key) => Deno.env.get(key),
  // One caller-scoped client, built from the request's own Authorization header. ADR-0037: the
  // permission primitive must run as the caller — a service-role client has no auth.uid() and
  // would resolve every grant to false. It is also what makes the brief read and the concept
  // insert obey RLS, and what lets the trigger stamp `requested_by` from a real identity. This
  // function has no elevated client at all, by design.
  makeCallerClient: (authHeader) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }) as unknown as CallerClient,
  hasPermission,
  fetchImpl: fetch,
  timeoutMs: MODEL_TIMEOUT_MS,
})

Deno.serve(guarded(corsHeaders, entry))
