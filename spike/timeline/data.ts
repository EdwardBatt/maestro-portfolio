// Shared fixtures for both candidates. Deterministic (seeded) so LTR/RTL and
// both libraries render the identical scenario.
export interface Resource {
  id: string
  name: string
  nameAr: string
  dept: string
}
export interface Booking {
  id: string
  resourceId: string
  start: number
  end: number
  label: string
}
export interface Blackout {
  id: string
  resourceId: string
  start: number
  end: number
}

let seed = 42
export const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

const DEPTS = ['Art & Video', 'Copy & Social', 'Production', 'Performance', 'Influencer', 'Client Services', 'Equipment']
const FIRST = ['Sarah', 'Ali', 'Layla', 'Omar', 'Nour', 'Hassan', 'Rania', 'Karim', 'Dina', 'Yusuf']
const FIRST_AR = ['سارة', 'علي', 'ليلى', 'عمر', 'نور', 'حسن', 'رانيا', 'كريم', 'دينا', 'يوسف']

export const DAY = 24 * 60 * 60 * 1000
export const RANGE_START = new Date('2026-07-27T00:00:00Z').getTime()
export const RANGE_END = RANGE_START + 5 * DAY

export function makeFixtures(resourceCount = 150) {
  const resources: Resource[] = []
  for (let i = 0; i < resourceCount; i++) {
    const f = Math.floor(rand() * FIRST.length)
    const dept = DEPTS[i % DEPTS.length]
    resources.push({
      id: `r${i}`,
      name: `${FIRST[f]} ${i}`,
      nameAr: `${FIRST_AR[f]} ${i}`,
      dept,
    })
  }

  const bookings: Booking[] = []
  let b = 0
  for (const r of resources) {
    const n = 1 + Math.floor(rand() * 3) // 1-3 bookings per resource
    for (let k = 0; k < n; k++) {
      const start = RANGE_START + rand() * 4 * DAY
      const end = start + (4 + rand() * 20) * 60 * 60 * 1000
      bookings.push({ id: `b${b++}`, resourceId: r.id, start, end, label: `Job ${b}` })
    }
  }
  // Guaranteed overlap cluster on r0 (load-based human, 3 concurrent)
  const base = RANGE_START + DAY
  bookings.push(
    { id: 'ov1', resourceId: 'r0', start: base, end: base + 10 * 3600e3, label: 'Overlap A' },
    { id: 'ov2', resourceId: 'r0', start: base + 2 * 3600e3, end: base + 12 * 3600e3, label: 'Overlap B' },
    { id: 'ov3', resourceId: 'r0', start: base + 4 * 3600e3, end: base + 14 * 3600e3, label: 'Overlap C' },
  )

  const blackouts: Blackout[] = resources
    .filter((_, i) => i % 5 === 0)
    .map((r, i) => ({
      id: `bl${i}`,
      resourceId: r.id,
      start: RANGE_START + 2 * DAY,
      end: RANGE_START + 2 * DAY + 12 * 3600e3,
    }))

  return { resources, bookings, blackouts }
}
