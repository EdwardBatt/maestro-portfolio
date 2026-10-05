import { chromium } from 'playwright'
import { preview } from 'vite'

const server = await preview({ preview: { port: 4310 } })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
const base = 'http://localhost:4310'
const out = {}

async function loadAndMeasure(name, url, rootSel, itemSel) {
  const t0 = Date.now()
  await page.goto(base + url)
  await page.waitForSelector(itemSel, { timeout: 15000 })
  const loadMs = Date.now() - t0
  // let rendering settle
  await page.waitForTimeout(700)
  const items = await page.locator(itemSel).count()
  await page.screenshot({ path: `shots/${name}.png`, fullPage: false })
  out[name] = { loadMs, itemsRendered: items }
}

// ---------- dnd-timeline ----------
await loadAndMeasure('dnd-ltr', '/?lib=dnd', '[data-testid=dnd-timeline-root]', '[data-testid^=item-]')

// overlap stacking FIRST (before any drag disturbs the cluster)
{
  const ys = []
  for (const id of ['ov1', 'ov2', 'ov3']) {
    const bb = await page.locator(`[data-testid=item-${id}]`).boundingBox()
    ys.push(Math.round(bb?.y ?? -1))
  }
  out['dnd-overlap-distinct-lanes'] = new Set(ys).size
  out['dnd-blackouts-visible'] = await page.evaluate(() => {
    const el = document.querySelector('.blackout')
    if (!el) return 0
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.left > 0 && r.left < 3000 ? document.querySelectorAll('.blackout').length : -1
  })
}

// drag-move test: move first overlap item, verify its box moved
{
  const item = page.locator('[data-testid=item-ov1]')
  await item.scrollIntoViewIfNeeded()
  const before = await item.boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 200, before.y + before.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await page.locator('[data-testid=item-ov1]').boundingBox()
  out['dnd-drag'] = { movedPx: Math.round((after?.x ?? 0) - before.x) }
}
await loadAndMeasure('dnd-rtl', '/?lib=dnd&rtl=1', '[data-testid=dnd-timeline-root]', '[data-testid^=item-]')

// ---------- vis-timeline ----------
await loadAndMeasure('vis-ltr', '/?lib=vis', '[data-testid=vis-timeline-root]', '.vis-item.vis-range')
{
  // drag-move on a vis item
  const item = page.locator('.vis-item.vis-range').first()
  const before = await item.boundingBox()
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 200, before.y + before.height / 2, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await item.boundingBox()
  out['vis-drag'] = { movedPx: Math.round((after?.x ?? 0) - before.x) }
  const blackouts = await page.locator('.vis-item.vis-background.blackout').count()
  out['vis-blackouts'] = blackouts
}
await loadAndMeasure('vis-rtl', '/?lib=vis&rtl=1', '[data-testid=vis-timeline-root]', '.vis-item.vis-range')

console.log(JSON.stringify(out, null, 2))
await browser.close()
await server.close()
process.exit(0)
