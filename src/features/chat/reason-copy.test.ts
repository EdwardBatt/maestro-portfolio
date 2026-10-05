import { describe, expect, it } from 'vitest'
import en from '../../locales/en.json'
import ar from '../../locales/ar.json'

/**
 * Every membership reason has copy, in both languages, in the form its CLASS uses.
 *
 * **This exists because the same bug has now happened three times.** On 26 Aug a `cancelled`
 * notification rendered as `notifications.type.cancelled`. On 31 Aug the chat member list filled
 * with `chat.reasonMany.assigner` after that reason was renamed to `creator` while the DEPLOYED
 * `chat` function was still sending the old value. i18next returns the key when it cannot find one,
 * so a missing string is not an error anywhere — it is debug text on a user's screen.
 *
 * The vocabulary lives in three places that cannot see each other: a `reason` string produced in
 * SQL, a set in `ConversationMembers.tsx`, and keys in two JSON files. Nothing but this test makes
 * them agree.
 *
 * **The two classes are the subject matter, not a length rule.** A COUNTED reason's subject is a
 * task — "Draft", "Review" — which nobody recognises by name, so it is only ever counted. A NAMED
 * reason's subject is a deliverable, campaign or person, which is worth reading out. Mixing the two
 * is what produced "created 26 tasks" beside "created A, B, C" on one screen.
 *
 * `assigner` stays listed: it is the pre-31-Aug name for `creator`, and a browser may hold new
 * client code while talking to an older function for as long as a deploy takes.
 */
const COUNTED = ['assignee', 'reviewer', 'creator', 'assigner'] as const
const NAMED = ['owner', 'account_manager', 'invited'] as const

type Block = Record<string, unknown>
const group = (b: Block, name: string): Record<string, string> =>
  (b[name] ?? {}) as Record<string, string>

const locales: Record<string, Block> = {
  en: (en as { chat: Block }).chat,
  ar: (ar as { chat: Block }).chat,
}

describe('chat member-reason copy', () => {
  for (const [name, bundle] of Object.entries(locales)) {
    describe(name, () => {
      it.each(COUNTED)('%s counts, singular and plural', (reason) => {
        const one = group(bundle, 'reasonCount')[`${reason}_one`]
        const many = group(bundle, 'reasonCount')[`${reason}_other`]
        expect(one, `chat.reasonCount.${reason}_one missing in ${name}`).toBeTruthy()
        expect(many, `chat.reasonCount.${reason}_other missing in ${name}`).toBeTruthy()
        // i18next resolves a count > 1 to `_other`; a wrong suffix silently renders the key name,
        // which is the failure this whole file is about.
        expect(many, `chat.reasonCount.${reason}_other must use {{count}}`).toContain('{{count}}')
        // The singular says "this task" — it names nothing, so it must NOT ask for a subject.
        expect(one, `chat.reasonCount.${reason}_one must not interpolate a subject`).not.toContain('{{subject}}')
      })

      it.each(NAMED)('%s names its subject, and counts when there are many', (reason) => {
        const one = group(bundle, 'reasonOne')[reason]
        const many = group(bundle, 'reasonMany')[`${reason}_other`]
        expect(one, `chat.reasonOne.${reason} missing in ${name}`).toBeTruthy()
        expect(one, `chat.reasonOne.${reason} must use {{subject}}`).toContain('{{subject}}')
        expect(many, `chat.reasonMany.${reason}_other missing in ${name}`).toBeTruthy()
        expect(many, `chat.reasonMany.${reason}_other must use {{count}}`).toContain('{{count}}')
      })

      it('has no copy for a reason nothing can emit', () => {
        // The other direction: a key left after a rename reads as support for a value the system no
        // longer produces, and is the thing that hid the `assigner` breakage for as long as it did.
        const known = new Set<string>([...COUNTED, ...NAMED])
        for (const key of Object.keys(group(bundle, 'reasonOne')))
          expect(known, `chat.reasonOne.${key} in ${name} matches no known reason`).toContain(key)
        for (const key of Object.keys(group(bundle, 'reasonCount')))
          expect(known, `chat.reasonCount.${key} in ${name} matches no known reason`)
            .toContain(key.replace(/_(zero|one|two|few|many|other)$/, ''))
      })
    })
  }

  it('classes every reason exactly once', () => {
    // A reason in both sets, or in neither, renders as nothing — the guard in `why()` returns an
    // empty string rather than letting a key reach the screen. Silent, so it is asserted here.
    const overlap = COUNTED.filter((r) => (NAMED as readonly string[]).includes(r))
    expect(overlap, 'a reason cannot be both counted and named').toEqual([])
  })
})
