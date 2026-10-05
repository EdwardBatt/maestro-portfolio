import { describe, expect, it } from 'vitest'
import { HUE_COUNT, workstreamHue } from './workstream-hue'

describe('workstreamHue — one stable colour per workstream', () => {
  it('is the same for the same id, every time', () => {
    expect(workstreamHue('w-abc')).toBe(workstreamHue('w-abc'))
  })
  it('stays inside the twelve categorical hues', () => {
    for (const id of ['a', 'b', 'w1', '00000000-0000-0000-0000-000000000000', 'ffff']) {
      const h = workstreamHue(id)
      expect(h).toBeGreaterThanOrEqual(1)
      expect(h).toBeLessThanOrEqual(HUE_COUNT)
    }
  })
  it('keeps the value the campaign wizard has always drawn', () => {
    // 'w1' → ((119*31 + 49) % 12) + 1 = 3689 % 12 + 1 = 5 + 1 = 6
    expect(workstreamHue('w1')).toBe(((119 * 31 + 49) % 12) + 1)
  })
})
