// read-brief-receipt — reads a screenshot of the request that asked for a brief (ADR-0066, I35.5).
//
// The browser sends ONE image as a `data:` URL. This function verifies the caller, asks the model
// what the screenshot says — subject, date, time — validates the answer, and returns it. It writes
// nothing: the reading goes to the wizard marked as machine-filled, a person confirms it, and the
// CONFIRMED timestamp is what starts the T+ clock (ADR-0066 d.5).
//
// This file is deliberately thin. Everything with behaviour lives in handler.ts, where Vitest can
// reach it; `Deno.serve` running at import time is what keeps that code out of a test.
//
// WHAT MAKES IT DIFFERENT FROM `ingest-brief`, AND WHAT DOES NOT. Same auth shape, same permission,
// same no-tools rule, same single call site (`_shared/model.ts`, extended additively for the image
// per ADR-0066 d.11 — a caller sending no image produces a byte-identical request to before). What
// differs is only that a partial answer is CORRECT here: a screenshot showing `14:32` with no date
// must come back with an empty date, because completing it is an inference and d.4 forbids one.
//
// SECRET. `OPENAI_API_KEY` is an Edge Function secret. It is read here from `Deno.env` and never
// leaves this process; nothing in `src/` reads it and no `VITE_`-prefixed variable exists for it,
// which is the only route a value has into the browser bundle (AGENTS.md §1).
//
// Env (Supabase → Edge Functions → Secrets; Edward sets these, this repo never holds them):
//   OPENAI_API_KEY   required — without it this returns 503 and the three fields are typed by
//                       hand, which is a supported way to record a receipt rather than a failure.
//   OPENAI_MODEL     optional override. Defaults to gpt-5.6-luna (ADR-0049 d.2).
//   SUPABASE_URL / SUPABASE_ANON_KEY are injected by the platform.
//
// PRIVACY, AND IT IS NAMED IN THE ADR. A screenshot of an inbox carries far more than the brief —
// other senders, other subject lines, phone numbers — and it goes both to the Library and to
// OpenAI. The interface asks for a cropped capture; that is a mitigation, not a fix. ADR-0066's
// Consequences records that when residency (ADR-0044 d.6 / ADR-0049 d.6) is answered, IMAGES must
// be considered separately from text.
//
// Deploy: `supabase functions deploy read-brief-receipt` (Edward's action, not an agent's).
import { createClient } from 'npm:@supabase/supabase-js@2'
import { hasPermission } from '../_shared/authz.ts'
import { guarded } from '../_shared/http.ts'
import { corsHeaders, createReceiptEntry, type CallerClient } from './handler.ts'

/** A user is watching the spinner, and three short fields is a fast call. */
const MODEL_TIMEOUT_MS = 45_000

const entry = createReceiptEntry({
  getEnv: (key) => Deno.env.get(key),
  // One caller-scoped client, built from the request's own Authorization header. ADR-0037: the
  // permission primitive must run as the caller — a service-role client has no auth.uid() and
  // would resolve every grant to false. This function needs no elevated client at all, because it
  // reads and writes nothing.
  makeCallerClient: (authHeader) =>
    createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
    }) as unknown as CallerClient,
  hasPermission,
  fetchImpl: fetch,
  timeoutMs: MODEL_TIMEOUT_MS,
})

Deno.serve(guarded(corsHeaders, entry))
