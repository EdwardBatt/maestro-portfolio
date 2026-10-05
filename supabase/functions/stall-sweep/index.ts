import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { guarded } from '../_shared/http.ts'
import { createStallSweepHandler } from './handler.ts'

/**
 * stall-sweep — work that stalls is chased, then escalated (ADR-0045 d.1), on exactly the
 * `archive-sweep` pattern: cron-invoked, `CRON_SECRET` header, service role, no user JWT,
 * idempotent by construction (the database logs each cause it has sent — `escalation_log`).
 *
 * Since ADR-0108 (I59.24, 26 Sep) one call runs every rung — `public.run_escalation_sweep`:
 * unassigned (single jobs and campaign pieces), task list / brief not approved, review reminder,
 * review escalation, and the weekly over-capacity check. Every clock counts REAL hours; the hours
 * and the recipients are the tenant's `tenant_escalation_rules`.
 *
 * Schedule: hourly. `POST /functions/v1/stall-sweep` with `x-cron-secret`; `{ "dryRun": true }`
 * answers with every due cause and who it would go to, and sends nothing.
 *
 * Behaviour lives in handler.ts (unit-tested); this file only wires the environment in.
 */
Deno.serve(guarded({}, createStallSweepHandler({
  cronSecret: Deno.env.get('CRON_SECRET'),
  runSweep: async (dryRun) => {
    // Service role: the sweep runs without a caller and crosses every tenant by design (ADR-0045 d.1);
    // the database function is service-role only.
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data, error } = await admin.rpc('run_escalation_sweep', { p_dry_run: dryRun })
    return { data, error: error ? { message: error.message } : null }
  },
})))
