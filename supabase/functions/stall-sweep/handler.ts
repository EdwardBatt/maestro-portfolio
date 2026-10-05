import { z } from 'npm:zod@4'

/**
 * stall-sweep's behaviour, with its runtime injected so Vitest can reach it (the `read-brief-receipt`
 * pattern). `index.ts` only wires Deno.env and the service-role client in.
 *
 * Contract, unchanged since 22 Sep: `POST` with `x-cron-secret`; `{ "dryRun": true }` sends nothing
 * and answers with what WOULD be sent — since ADR-0108 (I59.24) that is every due cause of every rung
 * (unassigned, task_list, review_remind, review_escalate, over_capacity) with its recipients.
 */

export const Input = z.object({ dryRun: z.boolean().optional() })

/** One due cause as `app.run_escalation_sweep` reports it. */
export const SweepItem = z.object({
  kind: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  label: z.string().nullable(),
  hours: z.number().nullable(),
  threshold: z.number().nullable(),
  recipients: z.array(z.object({ user_id: z.string(), reasons: z.array(z.string()) })),
}).passthrough()

export const SweepResult = z.object({
  dry_run: z.boolean(),
  sent: z.number(),
  due: z.number(),
  items: z.array(SweepItem),
}).passthrough()

export type SweepResultT = z.infer<typeof SweepResult>

export interface StallSweepDeps {
  cronSecret: string | undefined
  /** Calls `public.run_escalation_sweep(p_dry_run)` under the service role. */
  runSweep: (dryRun: boolean) => Promise<{ data: unknown; error: { message: string } | null }>
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } })

export function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ba = enc.encode(a)
  const bb = enc.encode(b)
  if (ba.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ba.length; i++) diff |= ba[i]! ^ bb[i]!
  return diff === 0
}

/** What each rung would send, for the dry run: counts per kind, and every cause with its people. */
export function summarise(result: SweepResultT) {
  const byKind: Record<string, { causes: number; recipients: number }> = {}
  for (const item of result.items) {
    const k = (byKind[item.kind] ??= { causes: 0, recipients: 0 })
    k.causes += 1
    k.recipients += item.recipients.length
  }
  return byKind
}

export function createStallSweepHandler(deps: StallSweepDeps) {
  return async (req: Request): Promise<Response> => {
    if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

    const presented = req.headers.get('x-cron-secret') ?? ''
    if (!deps.cronSecret || !timingSafeEqual(presented, deps.cronSecret))
      return err(401, 'unauthenticated', 'Invalid or missing cron secret')

    let parsed: z.infer<typeof Input>
    try {
      parsed = Input.parse(await req.json().catch(() => ({})))
    } catch {
      return err(400, 'bad_request', 'Invalid input')
    }
    const dryRun = parsed.dryRun === true

    const { data, error } = await deps.runSweep(dryRun)
    if (error) {
      console.error('stall-sweep: run_escalation_sweep failed', error.message)
      return err(500, 'sweep_failed', 'The sweep could not run')
    }
    const result = SweepResult.safeParse(data)
    if (!result.success) return err(500, 'sweep_failed', 'The sweep returned an unexpected shape')

    if (dryRun) {
      return json(200, { dryRun: true, due: result.data.due, byKind: summarise(result.data), items: result.data.items })
    }
    return json(200, { escalated: result.data.sent, due: result.data.due, byKind: summarise(result.data) })
  }
}
