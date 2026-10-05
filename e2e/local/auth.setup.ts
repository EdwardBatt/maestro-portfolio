import { test as setup } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { PEOPLE, PASSWORD, authFile, type PersonTag } from './fixtures'
import { attemptWrite } from './helpers/db'

/**
 * Signs every seeded person in programmatically via the local GoTrue API and saves the browser
 * state, so specs pick a role with `test.use({ storageState: authFile('tl') })` and never
 * touch the login form.
 */
mkdirSync('e2e/.auth', { recursive: true })

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321'
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

for (const tag of Object.keys(PEOPLE) as PersonTag[]) {
  setup(`sign in as ${tag}`, async () => {
    // I53.21 (21 Sep): the interface language is REMEMBERED on the profile, so a person who was
    // switched to Arabic by an earlier run (the inspection walk does that) opens every later page
    // in Arabic — and a spec asserting English words fails for no reason it can see. Put each
    // person back to the seed's language before their session is used; the Arabic walk and the
    // RTL smoke switch on purpose and check that they did.
    const person = PEOPLE[tag] as { locale?: string }
    const wanted = person.locale ?? 'en'
    const reset = await attemptWrite('PATCH', 'user_profiles', `email=eq.${encodeURIComponent(PEOPLE[tag].email)}`, { locale: wanted })
    if (reset.status >= 300) throw new Error(`could not reset ${tag}'s language to ${wanted}: ${reset.status} ${reset.text}`)

    const file = authFile(tag)
    // ALWAYS sign in. No reuse, no cleverness (I54.22, second attempt).
    //
    // A stored session was reused for an hour on the clock. That hid three different failures this
    // month — a refresh token rotated by another context (15 Sep), a `db reset` recreating every
    // person with new ids (23 Sep), and then the fix for those two: checking the ACCESS token with
    // GoTrue, which happily says "valid" for the full hour while the REFRESH token beside it is
    // already dead. The browser then starts fine, fails its first refresh, and reads as anonymous.
    //
    // Every one of them fails the same silent way: nothing raises, every list is empty, every page
    // renders its "nothing here" state, and the database answers perfectly to anyone who asks it
    // directly. The failure points at the panel, the query, the permissions — anywhere but here.
    //
    // Signing all twenty people in costs about a second and a half. That is the whole saving this
    // was protecting, and it has now been paid back several times over in an afternoon.

    const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      body: JSON.stringify({
        email: PEOPLE[tag].email,
        password: PASSWORD
      })
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`Failed to login as ${tag}: ${err}`)
    }

    const session = await response.json()
    
    const storageState = {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            {
              name: 'sb-127-auth-token',
              value: JSON.stringify(session)
            }
          ]
        }
      ]
    }
    
    writeFileSync(file, JSON.stringify(storageState, null, 2))
  })
}
