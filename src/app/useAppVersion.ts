import { useEffect, useState } from 'react'
import { BUILD_ID, shouldPromptReload } from '../lib/version'

/** How often an open tab re-asks. Five minutes: a deploy is noticed within one coffee. */
const EVERY_MS = 5 * 60 * 1000

/**
 * Has a new version of Maestro been deployed since this tab loaded?
 *
 * Edward, 6 Sep: *"users are not logging out of the site in some cases and as we are continuously
 * updating the site, they are not always using the latest version."* Maestro is a single bundle
 * with no code splitting, so a tab that stays open never requests anything again — it cannot
 * discover a new release by accident, and it never fails in a way that would make somebody reload.
 * It just keeps running old code against a database that has moved on.
 *
 * **It only ever reports. It never reloads anybody.** The bar it feeds is dismissible and the
 * reload is a button — the non-blocking principle, and the reason this is not simply
 * `location.reload()` on mismatch: somebody is always half-way through a brief.
 *
 * **Checks on focus as well as on a timer.** The realistic pattern is a tab left open for hours and
 * returned to — waiting up to five minutes after they come back would mean they start work on the
 * old build anyway.
 *
 * **A failed check is silent.** Offline, a captive portal, a deploy mid-flight: none of those are
 * evidence of a new version, and a bar that appears when the network hiccups is a bar people learn
 * to close without reading.
 *
 * **It stops once it has an answer.** The bar does not need confirming twice, and a tab left open
 * across three deploys should not keep re-rendering it.
 */
export function useAppVersion(): { updateAvailable: boolean } {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  useEffect(() => {
    // `dev` under the dev server and under vitest — nothing to poll, and hot reload covers it.
    if (BUILD_ID === 'dev' || updateAvailable) return

    let cancelled = false

    async function check() {
      try {
        // `no-store` because the whole point is to bypass whatever cached the last answer, and a
        // cache-busting query string would leave a trail of unique URLs in the CDN.
        //
        // This settles the BROWSER cache. The CDN is settled by the `Cache-Control` header on
        // `/version.json` in `vercel.json` — a cached answer there would tell an out-of-date tab it
        // is current, which is the whole failure being fixed. That file cannot carry a comment
        // saying so (Vercel's schema rejects any key it does not know, `"//"` included, and doing
        // it that way failed a deploy on 6 Sep), so the reason lives here.
        const res = await fetch('/version.json', { cache: 'no-store' })
        if (!res.ok) return
        const body: unknown = await res.json()
        const served = (body as { buildId?: unknown } | null)?.buildId
        if (!cancelled && shouldPromptReload(BUILD_ID, served)) setUpdateAvailable(true)
      } catch {
        // Silent by design — see the note above.
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }

    void check()
    const timer = window.setInterval(() => void check(), EVERY_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [updateAvailable])

  return { updateAvailable }
}
