import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './auth-context'
import { useCurrentUser } from './useCurrentUser'

/**
 * The interface language is REMEMBERED (I53.21, 21 Sep). Until then `i18n.changeLanguage` was in
 * memory only: switch to Arabic, reload, English again — and `user_profiles.locale`, which the
 * seed sets to `ar` for the animator, was applied nowhere.
 *
 * Two halves, one seam:
 *  - on load, the profile's `locale` is applied ONCE per session (a ref, so a toggle made after
 *    the profile arrived is not undone by a refetch);
 *  - a toggle writes the new value back to the profile — `locale` is one of the three columns a
 *    person may update on their own row (`20260801090000`), so no Edge Function is needed.
 *
 * Returns the toggle. The sign-in page's own toggle stays in memory: nobody is signed in there.
 */
export function useRememberedLocale(): () => void {
  const { i18n } = useTranslation()
  const { session } = useAuth()
  const qc = useQueryClient()
  const me = useCurrentUser()
  const applied = useRef(false)
  const uid = session?.user.id

  useEffect(() => {
    if (applied.current) return
    const stored = me.data?.locale
    if (!stored) return
    applied.current = true
    if ((stored === 'ar' || stored === 'en') && stored !== i18n.language) void i18n.changeLanguage(stored)
  }, [me.data?.locale, i18n])

  return () => {
    const next = i18n.language === 'ar' ? 'en' : 'ar'
    applied.current = true
    void i18n.changeLanguage(next)
    if (!uid) return
    void supabase
      .from('user_profiles')
      .update({ locale: next })
      .eq('id', uid)
      .then(({ error }) => {
        // A failed save is not worth interrupting the page: the language changed on screen; it will
        // simply not be remembered on the next load.
        if (error) console.warn('locale: not saved', error.message)
        else void qc.invalidateQueries({ queryKey: ['current-user', uid] })
      })
  }
}
