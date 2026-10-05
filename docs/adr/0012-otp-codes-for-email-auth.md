# ADR-0012: Email auth via typed OTP codes, not clickable magic links

- **Status:** accepted
- **Date:** 2026-08-13
- **Sign-off:** Edward, 2026-08-13 (Gmail test confirmed link generation is sound → the corporate link scanner was the sole failure; codes remove the click entirely). Build additionally requires accurate per-error messaging and a show/hide password toggle (default hidden).
- **Task(s):** L1.1 (invite), L1.3 (set-password / recovery); supersedes the magic-link mechanics of ADR-0007's launch flow
- **Relates to:** the invite-user Edge Function, LoginPage forgot-password, SetPasswordPage, the branded EN/AR invite & recovery email templates

## Context

Invite and password-reset both rely on Supabase **magic links**: `inviteUserByEmail` /
`resetPasswordForEmail` send an email whose `{{ .ConfirmationURL }}` points at Supabase's
`/auth/v1/verify` endpoint, which verifies a **single-use token** and redirects to `/set-password`,
where `detectSessionInUrl` turns the token into a session.

This does not survive Meridian's real email environment. Testing against a live Meridian mailbox showed the
link arriving rewritten by the corporate secure-email gateway's **URL-defense link
scanner**. Scanners **pre-fetch links to sandbox them**, and because the token is single-use, that
automated fetch **consumes it before the human clicks** — every subsequent click (from the inbox,
or even straight from the Resend delivery log) reports *expired/invalid*. Two forces compound it:

- **Supersession** — each new reset request invalidates all earlier tokens, so only the newest link
  is ever live, and that is exactly the one the scanner just burned.
- **Delivery lag vs. expiry** — "delivered" in Resend only means the receiving MX accepted it; gateway
  scanning + spam filtering + Thunderbird's poll interval sit between acceptance and the human seeing it,
  and a short link expiry can lapse in that gap.

The point that makes this architectural, not incidental: **the entire Meridian team is behind this corporate
scanner.** Single-use clickable links are the wrong primitive for that environment — the failure is not
a bug to patch but a property of the mechanism. A separate symptom (the recovery `redirect_to` falling
back to the site root, landing users on login) is *also* a consequence of leaning on link redirects.

## Decision

**Move invite and password-reset off clickable links and onto 6-digit OTP codes the user types into
the app.** A code is data a human reads and enters; an automated scanner does not type codes into
forms, so it cannot consume the token. Supersession stops mattering (the user simply enters the newest
code), delivery lag is tolerable (a stale code is a re-request, not a dead end), and there is **no
redirect at all** — which also retires the `redirect_to`/allowlist fragility.

Concretely:

1. **Email templates carry `{{ .Token }}`** (the 6-digit code) as the primary instruction. The invite
   and recovery templates are reworked (keeping the branded EN/AR layout) to show the code prominently;
   the magic link is removed (or demoted) so users are not sent to click a link a scanner will have killed.
2. **A code-entry screen** replaces the redirect-driven `/set-password` path: the user provides their
   email + the code + a new password, and the app calls
   `supabase.auth.verifyOtp({ email, token, type })` — `type: 'recovery'` for reset, `type: 'invite'`
   for invited users — which establishes a session, then `updateUser({ password })` sets the password.
   Email is **re-entered on the code screen** (never passed in the URL — PII, and it must work
   cross-device), pre-filled from the login form where we already have it.
3. **invite-user keeps `inviteUserByEmail`** (it mints a `type: 'invite'` token that `verifyOtp`
   accepts); only the template and the landing screen change. `resetPasswordForEmail` is likewise
   unchanged server-side — the shift is template + client verification.
4. **Expiry stays generous but finite**; single-use is retained. Brute-force resistance for a 6-digit
   code rests on Supabase's built-in verification rate-limiting + expiry — the standard, industry-normal
   posture for emailed codes.

### Alternatives considered

- **Keep links, allowlist Supabase in the email gateway** — rejected: not reliably controllable, and every
  staffer's/client's scanner differs.
- **Keep links but require a button click on the landing page (`token_hash` + `verifyOtp` on click, no
  auto-exchange)** — defeats naive pre-fetchers (they don't run JS/click), but not scanners that execute
  JS, and it keeps the redirect-allowlist dependency. Weaker than codes.
- **6-digit OTP codes** — chosen: scanner-proof, delivery-lag-tolerant, redirect-free.

## Consequences

**Easier:** invite and reset work behind corporate link scanners; no dependence on the redirect
allowlist or `detectSessionInUrl` for these flows (the site-root/login bug disappears); works across
devices (the code travels in the person's head, not a browser session); delivery lag is recoverable.

**Harder / follow-through:** a new code-entry UI and the `/set-password` refactor; both branded email
templates reworked to lead with `{{ .Token }}`; `verifyOtp` wiring + graceful handling of wrong/expired
codes and Supabase verify rate-limits; tests (unit for the screen, and the L1.3 flow revisited). As a
config hygiene item, turn **off Resend click/open tracking** on auth emails (tracking wrappers get
followed by scanners) — belt-and-braces even though codes don't depend on links.

**Locked in:** emailed auth for Maestro is **code-based, not link-based**. Magic-link redirects are not
the mechanism for invite or recovery. Any future email auth (e.g. email-change confirmation) follows the
same code pattern rather than reintroducing single-use clickable links.
