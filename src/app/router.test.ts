import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * The route table may not declare one path twice.
 *
 * **This is a regression test for a bug that cost four days and produced no error of any kind.**
 * `800666c` (27 Aug) added `CampaignPage` at `/campaigns/:campaignId` and left the older
 * `CampaignStatusPage` declared at the same path a few lines below. React Router matches the FIRST
 * entry, so the second page — and the campaign's delivery-status rollup, its only surface — became
 * unreachable. Nothing threw, nothing warned, no test failed, and the build was green throughout.
 * It was found on 31 Aug only because Edward asked why a campaign had no health figures.
 *
 * A duplicate path is never intentional: two elements cannot both answer one URL, so the second is
 * always dead code. Whichever page is meant to win, saying it twice is the bug.
 *
 * Read as TEXT rather than by importing `router`, deliberately. Importing the route table pulls in
 * every page component and every module they reach — including `lib/env`, which is exactly the
 * import-time failure recorded in `docs/memory/traps.md`. The check does not need the module: the
 * path literals are the whole subject.
 */
const SOURCE = readFileSync(resolve(__dirname, 'router.tsx'), 'utf8')

/** Every `path: '…'` literal in declaration order. */
function declaredPaths(source: string): string[] {
  return [...source.matchAll(/\bpath:\s*'([^']*)'/g)].map((m) => m[1]!)
}

describe('route table', () => {
  it('declares each path exactly once', () => {
    const seen = new Map<string, number>()
    for (const p of declaredPaths(SOURCE)) seen.set(p, (seen.get(p) ?? 0) + 1)
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([p, n]) => `${p} ×${n}`)

    // Named in the failure so the next person does not have to diff the file to find it.
    expect(duplicated, `duplicate route paths (the later one is unreachable): ${duplicated.join(', ')}`)
      .toEqual([])
  })

  it('finds the paths it is meant to be checking', () => {
    // Guards the guard: if the route table is ever restructured so this regex matches nothing, the
    // test above would pass vacuously and go on passing for ever.
    const paths = declaredPaths(SOURCE)
    expect(paths.length).toBeGreaterThan(10)
    expect(paths).toContain('/campaigns/:campaignId')
  })
})
