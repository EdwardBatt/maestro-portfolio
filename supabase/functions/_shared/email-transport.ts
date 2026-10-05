// One place that sends an email, so `notify-email` and `report-error` deliver the same way and a
// test environment can swap the wire without touching either.
//
// TWO TRANSPORTS, chosen by `EMAIL_TRANSPORT`:
//
//   * `resend` (default, production) — Resend's API with `RESEND_API_KEY`. Unchanged from before.
//   * `mailpit` (local / CI) — the Mailpit "send" API at `MAILPIT_URL` (the CLI's local Mailpit,
//     http://127.0.0.1:54324 from the host, http://host.docker.internal:54324 from the Edge
//     runtime's container). The mail lands in Mailpit's inbox where a person reads it and a
//     Playwright run asserts on it (`GET /api/v1/search?query=to:<address>`), and NOTHING leaves the
//     machine. ADR-0081 d.3 made local email live and fenced it with `EMAIL_ALLOWLIST`; this is the
//     stronger fence for the test plan — the allowlist still applies on top.
//
// The allowlist is applied by the callers, not here: they decide who a message is FOR; this only
// carries it.

export interface OutboundEmail {
  from: string
  to: string
  subject: string
  html: string
  /** Resend only — a retried trigger never double-sends. */
  idempotencyKey?: string
}

export type EmailTransport = 'resend' | 'mailpit'

export function emailTransport(getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): EmailTransport {
  return getEnv('EMAIL_TRANSPORT') === 'mailpit' ? 'mailpit' : 'resend'
}

/** True when the environment can send at all — the caller decides what "not configured" means. */
export function emailConfigured(getEnv: (k: string) => string | undefined = (k) => Deno.env.get(k)): boolean {
  if (!getEnv('NOTIFY_EMAIL_FROM')) return false
  return emailTransport(getEnv) === 'mailpit' ? Boolean(getEnv('MAILPIT_URL')) : Boolean(getEnv('RESEND_API_KEY'))
}

/** Mailpit's send API wants a structured address; Resend takes `Name <addr>` as text. */
function splitAddress(s: string): { Name?: string; Email: string } {
  const m = s.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  return m ? { Name: m[1] || undefined, Email: m[2] } : { Email: s.trim() }
}

export async function sendEmail(
  mail: OutboundEmail,
  opts: { getEnv?: (k: string) => string | undefined; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; id: string | null } | { ok: false; status: number; body: string }> {
  const getEnv = opts.getEnv ?? ((k: string) => Deno.env.get(k))
  const fetchImpl = opts.fetchImpl ?? fetch

  if (emailTransport(getEnv) === 'mailpit') {
    const base = (getEnv('MAILPIT_URL') ?? '').replace(/\/$/, '')
    const res = await fetchImpl(`${base}/api/v1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        From: splitAddress(mail.from),
        To: [splitAddress(mail.to)],
        Subject: mail.subject,
        HTML: mail.html,
        // Tagged so a test can find every mail the system sent, whatever the subject.
        Tags: ['maestro'],
      }),
    })
    if (!res.ok) return { ok: false, status: res.status, body: await res.text() }
    const sent = (await res.json().catch(() => ({}))) as { ID?: string }
    return { ok: true, id: sent.ID ?? null }
  }

  const res = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${getEnv('RESEND_API_KEY')}`,
      ...(mail.idempotencyKey ? { 'Idempotency-Key': mail.idempotencyKey } : {}),
    },
    body: JSON.stringify({ from: mail.from, to: mail.to, subject: mail.subject, html: mail.html }),
  })
  if (!res.ok) return { ok: false, status: res.status, body: await res.text() }
  const sent = (await res.json().catch(() => ({}))) as { id?: string }
  return { ok: true, id: sent.id ?? null }
}
