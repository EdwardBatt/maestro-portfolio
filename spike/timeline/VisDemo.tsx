import { useEffect, useRef } from 'react'
import { Timeline } from 'vis-timeline/standalone'
import 'vis-timeline/styles/vis-timeline-graph2d.css'
import { makeFixtures, RANGE_END, RANGE_START } from './data'

const FIX = makeFixtures(150)

export default function VisDemo({ rtl }: { rtl: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current) return
    const groups = FIX.resources.map((r) => ({
      id: r.id,
      content: rtl ? r.nameAr : r.name,
    }))
    const items = [
      ...FIX.bookings.map((b) => ({
        id: b.id,
        group: b.resourceId,
        start: b.start,
        end: b.end,
        content: b.label,
        type: 'range' as const,
      })),
      ...FIX.blackouts.map((bl) => ({
        id: bl.id,
        group: bl.resourceId,
        start: bl.start,
        end: bl.end,
        content: '',
        type: 'background' as const,
        className: 'blackout',
      })),
    ]
    const timeline = new Timeline(ref.current, items, groups, {
      start: RANGE_START,
      end: RANGE_END,
      stack: true,
      editable: { updateTime: true, updateGroup: true, add: true, remove: false },
      rtl,
      orientation: 'top',
      margin: { item: 2 },
      onAdd: (item, cb) => {
        item.content = 'New booking'
        cb(item)
      },
    })
    return () => timeline.destroy()
  }, [rtl])

  return <div ref={ref} data-testid="vis-timeline-root" dir={rtl ? 'rtl' : 'ltr'} />
}
