import { describe, expect, it, vi } from 'vitest'
import { emailConfigured, emailTransport, sendEmail } from './email-transport.ts'

/**
 * One wire for both mail-sending functions. The property under test: with `EMAIL_TRANSPORT=mailpit`
 * NOTHING is posted to Resend — the mail goes to the local Mailpit send API — and without it the
 * Resend call is byte-for-byte what it was (idempotency key included).
 */
const env = (o: Record<string, string>) => (k: string) => o[k]

describe('email transport', () => {
  it('defaults to Resend, and is "configured" only with the key that transport needs', () => {
    expect(emailTransport(env({}))).toBe('resend')
    expect(emailConfigured(env({ NOTIFY_EMAIL_FROM: 'M <m@x>' }))).toBe(false)
    expect(emailConfigured(env({ NOTIFY_EMAIL_FROM: 'M <m@x>', RESEND_API_KEY: 'k' }))).toBe(true)
    expect(emailConfigured(env({ NOTIFY_EMAIL_FROM: 'M <m@x>', EMAIL_TRANSPORT: 'mailpit' }))).toBe(false)
    expect(emailConfigured(env({ NOTIFY_EMAIL_FROM: 'M <m@x>', EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://mp' }))).toBe(true)
  })

  it('mailpit: posts to the local send API, tagged, and never to Resend', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ID: 'mp-1' }), { status: 200 })) as unknown as typeof fetch
    const res = await sendEmail(
      { from: 'Maestro <notifications@maestro.local>', to: 'maestro.dev+tl@example.test', subject: 'S', html: '<p>h</p>', idempotencyKey: 'n-1' },
      { getEnv: env({ EMAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://host.docker.internal:54324/' }), fetchImpl },
    )
    expect(res).toEqual({ ok: true, id: 'mp-1' })
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toBe('http://host.docker.internal:54324/api/v1/send')
    const body = JSON.parse(String(init.body))
    expect(body.From).toEqual({ Name: 'Maestro', Email: 'notifications@maestro.local' })
    expect(body.To).toEqual([{ Email: 'maestro.dev+tl@example.test' }])
    expect(body.Tags).toEqual(['maestro'])
    expect(String(url)).not.toContain('resend')
  })

  it('resend: unchanged — bearer, idempotency key, the four fields', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: 're-1' }), { status: 200 })) as unknown as typeof fetch
    const res = await sendEmail(
      { from: 'M <m@x>', to: 'a@b', subject: 'S', html: '<p>h</p>', idempotencyKey: 'n-1' },
      { getEnv: env({ RESEND_API_KEY: 'key' }), fetchImpl },
    )
    expect(res).toEqual({ ok: true, id: 're-1' })
    const [url, init] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer key')
    expect(headers['Idempotency-Key']).toBe('n-1')
    expect(JSON.parse(String(init.body))).toEqual({ from: 'M <m@x>', to: 'a@b', subject: 'S', html: '<p>h</p>' })
  })

  it('reports a refused send with the status and body, without throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 422 })) as unknown as typeof fetch
    const res = await sendEmail({ from: 'M <m@x>', to: 'a@b', subject: 'S', html: '' }, { getEnv: env({ RESEND_API_KEY: 'k' }), fetchImpl })
    expect(res).toEqual({ ok: false, status: 422, body: 'nope' })
  })
})
