// report-error — a user's "Report to your administrator" button (ADR-0092 d.3 / I48.11).
//
// When an error dialog cannot be resolved by the user, they send the failure to the tenant's Power
// Admin(s): the message, what they were doing, and who/when. Sent server-side via Resend, to the
// admins' RECORDED emails (Edward, 13 Sep) — never an address the client supplies.
//
// Recipients come from the `power_admin_emails` RPC (security definer), so this function reads no
// role or grant table itself (ADR-0037). The email carries what the user saw, the technical cause, and (I66.12)
// what it means in words, when (Iraq time), and the page they were on — a link into the app, which may carry a
// record's id; nothing the user could not already open.
//
// Secrets: RESEND_API_KEY, NOTIFY_EMAIL_FROM (as notify-email). EMAIL_ALLOWLIST fences recipients
// locally and is unset in production (ADR-0081 d.3a).
//
// Deploy: `supabase functions deploy report-error`
import { explainFailure } from '../../../src/lib/errors/explain.ts'
import { formatMoment } from '../../../src/lib/time/iraq.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://esm.sh/zod@3.23.8'
import { guarded } from '../_shared/http.ts'
import { isAllowedRecipient } from '../_shared/email-allowlist.ts'
import { emailConfigured, sendEmail } from '../_shared/email-transport.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...corsHeaders } })
const err = (status: number, code: string, message: string) =>
  json(status, { error: { code, message } })

// Zod at the boundary (AGENTS.md §6). Everything the user can send is bounded, and trimmed.
const Body = z.object({
  message: z.string().trim().min(1).max(4000),
  context: z.string().trim().max(2000).optional().default(''),
  code: z.string().trim().max(200).optional().default(''),
  where: z.string().trim().max(400).optional().default(''),
  // I48.39: the technical cause (server message, detail, hint). Optional so an older bundle's
  // report still lands; the browser bundle and this function deploy separately (traps.md).
  cause: z.string().trim().max(2000).optional().default(''),
  // I66.12: the page the person was on — only an address in the app itself is shown as a link.
  page: z.string().trim().max(1000).optional().default(''),
})

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

Deno.serve(guarded(corsHeaders, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
  if (req.method !== 'POST') return err(405, 'method_not_allowed', 'POST only')

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Authenticate the caller; the report is addressed within THEIR tenant (the RPC is tenant-scoped).
  const authHeader = req.headers.get('authorization') ?? ''
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } })
  const { data: who, error: whoErr } = await caller.auth.getUser()
  if (whoErr || !who.user) return err(401, 'unauthenticated', 'Sign in required')

  let body: z.infer<typeof Body>
  try {
    body = Body.parse(await req.json())
  } catch {
    return err(400, 'bad_request', 'Invalid report')
  }

  const from = Deno.env.get('NOTIFY_EMAIL_FROM')
  if (!from || !emailConfigured()) {
    console.error('report-error: NOTIFY_EMAIL_FROM / RESEND_API_KEY (or MAILPIT_URL) not configured')
    return err(503, 'email_unconfigured', 'Reporting is not configured on this environment yet')
  }

  // Recipients from the RPC — never a grant table read here (ADR-0037).
  const { data: recipients, error: recErr } = await caller.rpc('power_admin_emails')
  if (recErr) return err(500, 'recipients_failed', 'Could not find an administrator to notify')
  const emails = ((recipients ?? []) as string[]).filter((e) => isAllowedRecipient(e, Deno.env.get('EMAIL_ALLOWLIST')))
  if (emails.length === 0) {
    // Honest, not silent: the dialog tells the user nobody could be reached.
    return json(200, { sent: 0, skipped: 'no_recipients' })
  }

  const reporter = who.user.email ?? who.user.id
  // I66.12: when, in the company's clock and said so; what it means in words; the page, as a link to open.
  const when = formatMoment(new Date(), 'en')
  const meaning = explainFailure(body.code, `${body.cause} ${body.message}`)
  const origin = req.headers.get('origin') ?? ''
  const pageLink = body.page && origin && body.page.startsWith(origin) ? body.page : ''
  const subject = `Maestro — error reported by ${reporter}${body.where ? ` (${body.where})` : ''}`
  const html = [
    `<p><strong>${escapeHtml(reporter)}</strong> reported an error in Maestro.</p>`,
    `<p><strong>When:</strong> ${escapeHtml(when)}</p>`,
    body.where ? `<p><strong>Where:</strong> ${escapeHtml(body.where)}</p>` : '',
    pageLink ? `<p><strong>Page:</strong> <a href="${escapeHtml(pageLink)}">${escapeHtml(pageLink)}</a></p>` : '',
    body.context ? `<p><strong>What they were doing:</strong><br>${escapeHtml(body.context)}</p>` : '',
    `<p><strong>What they saw:</strong><br>${escapeHtml(body.message)}</p>`,
    meaning ? `<p><strong>What it means:</strong><br>${escapeHtml(meaning)}</p>` : '',
    body.code ? `<p><strong>Code:</strong> ${escapeHtml(body.code)}</p>` : '',
    body.cause ? `<p><strong>Technical cause:</strong><br><code>${escapeHtml(body.cause)}</code></p>` : '',
  ].join('\n')

  let sent = 0
  for (const to of emails) {
    const res = await sendEmail({ from, to, subject, html })
    if (res.ok) sent++
    else console.error('report-error: send', res.status, res.body)
  }
  if (sent === 0) return err(502, 'send_failed', 'The report could not be sent')
  return json(200, { sent })
}))
