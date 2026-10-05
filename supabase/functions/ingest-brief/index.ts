// ingest-brief — reads a client's brief and fills the empty wizard fields (ADR-0044, I14.3).
//
// The browser extracts plain text from a .docx/.txt/.md (or the user pastes it) and posts
// ONLY that text here. This function verifies the caller, asks the model for the brief's
// fields as typed JSON, validates the answer, and returns it. It writes nothing: the
// result goes to the user's form, the user reviews it, and the user submits the brief.
//
// This file is deliberately four lines of substance. Everything else — including the
// unconfigured-key path and the CORS preflight — lives in handler.ts, where Vitest can
// reach it; `Deno.serve` running at import time is what keeps that code out of a test.
//
// SECRET. `OPENAI_API_KEY` is an Edge Function secret, exactly as `RESEND_API_KEY` is
// for notify-email (ADR-0028). It is read here from `Deno.env` and never leaves this
// process — putting it in the browser would hand a billable credential to every user
// (AGENTS.md §1). Nothing in `src/` reads it, and no `VITE_`-prefixed variable exists for
// it, which is the only way a value can reach the client bundle.
//
// Env (Supabase → Edge Functions → Secrets; Edward sets these, this repo never holds them):
//   OPENAI_API_KEY   the API key. Required — without it the function returns 503 and the
//                       wizard falls back to heading matching, so a missing key degrades
//                       rather than breaks.
//   OPENAI_MODEL     optional override. Defaults to gpt-5.6-luna (ADR-0049 d.2:
//                       model choice is config, not code).
//   SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
//
// PROVIDER. OpenAI's Responses API (ADR-0049). Switched from Anthropic for a BILLING reason
// — a virtual card was refused — not a technical one; ADR-0044's own comparison found the two
// even at the same tier. The `claude-api` skill does NOT describe this file any more.
//
// RETENTION. ADR-0044 §6 asked for zero retention and no training, and ADR-0049 d.6 re-opens
// it: that answer was given against ANOTHER company's terms and does not transfer. Neither is
// a request parameter. Edward confirms both on the OpenAI account that owns the key before
// this is enabled in production; see docs/RUNBOOK.md.
//
// Deploy: `supabase functions deploy ingest-brief` (Edward's action, not an agent's).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'
import { corsHeaders, createIngestEntry, type CallerClient } from './handler.ts'

/** A user is watching the spinner. Well inside the platform's own request ceiling. */
const MODEL_TIMEOUT_MS = 45_000

// One caller-scoped client, built from the request's own Authorization header. ADR-0037:
// the permission primitive must run as the caller — a service-role client has no
// auth.uid() and would resolve every grant to false. This function needs no elevated
// client at all: the one thing it reads, the brief template (ADR-0084 d.6), is read as the
// caller too, so `brief_templates_tenant_select` decides whose template answers.
function callerClient(authHeader: string) {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  })
}

const entry = createIngestEntry({
  getEnv: (key) => Deno.env.get(key),
  makeCallerClient: (authHeader) => callerClient(authHeader) as unknown as CallerClient,
  hasPermission,
  loadTemplateFields: async (authHeader, briefType) => {
    const { data, error } = await callerClient(authHeader)
      .from('brief_templates')
      .select('fields')
      .eq('brief_type', briefType)
      .eq('is_active', true)
      .maybeSingle()
    if (error) {
      // Surfaces in the function log; the caller gets the plain "no such template" 400.
      console.error('ingest-brief: template lookup failed', error.message)
      return null
    }
    return (data as { fields: unknown } | null)?.fields ?? null
  },
  fetchImpl: fetch,
  timeoutMs: MODEL_TIMEOUT_MS,
})

Deno.serve(guarded(corsHeaders, entry))
