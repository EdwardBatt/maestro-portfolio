import { z } from 'zod'

/**
 * Boot-time validation of client environment (AGENTS.md §5: validate at every
 * boundary). Fails fast with a readable error instead of undefined-URL fetches.
 * Only VITE_-prefixed, client-safe values belong here — never secrets.
 */

/**
 * Is this URL the local Supabase stack (ADR-0081)?
 *
 * Exported because two things need the same answer and must not each decide it: the schema below,
 * which relaxes the https rule for exactly this case, and the banner that tells the person which
 * database they are looking at. One definition, so "allowed to be http" and "shown as local" can
 * never disagree — which would be the worst possible pairing, an environment permitted to be local
 * while presenting itself as production.
 *
 * Host-based, not string-prefix-based: `https://prod.example.com/?x=localhost` must not pass, and a
 * naive `includes('localhost')` says it does.
 */
export function isLocalSupabase(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

const EnvSchema = z.object({
  /**
   * https everywhere EXCEPT the local stack, which serves plain http on 127.0.0.1:54321 and cannot
   * be given a certificate. The rule is right for every deployed environment and was simply wrong
   * for the one ADR-0081 introduced: it rejected the local URL at boot, so the app could not start
   * against it at all. Narrowed rather than dropped — a non-local http URL is still refused, which
   * is what the original check was for.
   */
  VITE_SUPABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('https://') || isLocalSupabase(u), {
      message: 'must be https:// (http is allowed only for the local Supabase stack on localhost)',
    }),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().startsWith('sb_publishable_'),
})

export const env = EnvSchema.parse(import.meta.env)

/**
 * True when this build is talking to a local database rather than a deployed one.
 *
 * Read by `EnvironmentBanner`. Deliberately derived from the SAME url the client is built with,
 * rather than from `import.meta.env.DEV` or the branch name: what matters is which database is
 * being written to, and a production build pointed at localhost — or a dev server pointed at
 * production — must both be described truthfully.
 */
export const isLocalEnvironment = isLocalSupabase(env.VITE_SUPABASE_URL)
