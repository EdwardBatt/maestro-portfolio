import { useCallback, useMemo, useState } from 'react'
import type { DragEndEvent, ItemDefinition, Range, ResizeEndEvent, Span } from 'dnd-timeline'
import { TimelineContext, groupItemsToSubrows, useItem, useRow, useTimelineContext } from 'dnd-timeline'
import { makeFixtures, RANGE_END, RANGE_START, type Blackout, type Resource } from './data'

const FIX = makeFixtures(150)
const DEFAULT_RANGE: Range = { start: RANGE_START, end: RANGE_END }

function BookingItem(props: { id: string; span: Span; label: string }) {
  const { setNodeRef, attributes, listeners, itemStyle, itemContentStyle } = useItem({
    id: props.id,
    span: props.span,
  })
  return (
    <div ref={setNodeRef} data-testid={`item-${props.id}`} style={itemStyle} {...listeners} {...attributes}
      onPointerDown={(e) => { e.stopPropagation(); listeners?.onPointerDown?.(e) }}>
      <div style={itemContentStyle}>
        <div className="booking">{props.label}</div>
      </div>
    </div>
  )
}

function BlackoutOverlay(props: { blackout: Blackout }) {
  const { valueToPixels, range } = useTimelineContext()
  const origin = valueToPixels(range.start)
  const start = valueToPixels(props.blackout.start) - origin
  const end = valueToPixels(props.blackout.end) - origin
  return (
    <div
      className="blackout"
      style={{ position: 'absolute', insetBlock: 0, insetInlineStart: Math.min(start, end), width: Math.abs(end - start) }}
    />
  )
}

function CreateGhost(props: { startX: number; onCreateEnd: (span: Span) => void }) {
  const { getValueFromScreenX, getDeltaXFromScreenX } = useTimelineContext()
  const left = getDeltaXFromScreenX(props.startX)
  return (
    <div
      className="create-ghost"
      style={{ insetInlineStart: left }}
      ref={(el) => {
        if (!el) return
        let endX = props.startX
        const move = (e: PointerEvent) => {
          endX = e.clientX
          el.style.width = `${Math.abs(endX - props.startX)}px`
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          const a = getValueFromScreenX(props.startX)
          const b = getValueFromScreenX(endX)
          props.onCreateEnd({ start: Math.min(a, b), end: Math.max(a, b) })
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }}
    />
  )
}

function ResourceRow(props: {
  resource: Resource
  rtl: boolean
  children: React.ReactNode
  blackouts: Blackout[]
  onCreate: (span: Span, rowId: string) => void
}) {
  const { setNodeRef, rowWrapperStyle, rowStyle, rowSidebarStyle } = useRow({ id: props.resource.id })
  const [dragStartX, setDragStartX] = useState<number | null>(null)
  const onCreateEnd = useCallback(
    (span: Span) => { props.onCreate(span, props.resource.id); setDragStartX(null) },
    [props],
  )
  return (
    <div style={{ ...rowWrapperStyle, minHeight: 28 }} data-testid={`row-${props.resource.id}`}>
      <div style={rowSidebarStyle} className="sidebar">
        <span className="rname">{props.rtl ? props.resource.nameAr : props.resource.name}</span>
        <span className="rdept">{props.resource.dept}</span>
      </div>
      <div ref={setNodeRef} style={{ ...rowStyle, position: 'relative' }} className="rowbody"
        onPointerDown={(e) => setDragStartX(e.clientX)}>
        {props.blackouts.map((b) => <BlackoutOverlay key={b.id} blackout={b} />)}
        {props.children}
        {dragStartX !== null && <CreateGhost startX={dragStartX} onCreateEnd={onCreateEnd} />}
      </div>
    </div>
  )
}

export default function DndDemo({ rtl }: { rtl: boolean }) {
  const [range, setRange] = useState(DEFAULT_RANGE)
  const [items, setItems] = useState<(ItemDefinition & { label: string })[]>(
    FIX.bookings.map((b) => ({ id: b.id, rowId: b.resourceId, span: { start: b.start, end: b.end }, label: b.label })),
  )

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const rowId = event.over?.id as string
    const span = event.active.data.current.getSpanFromDragEvent?.(event)
    if (!span || !rowId) return
    setItems((prev) => prev.map((i) => (i.id === event.active.id ? { ...i, rowId, span } : i)))
  }, [])

  const onResizeEnd = useCallback((event: ResizeEndEvent) => {
    const span = event.active.data.current.getSpanFromResizeEvent?.(event)
    if (!span) return
    setItems((prev) => prev.map((i) => (i.id === event.active.id ? { ...i, span } : i)))
  }, [])

  const onCreate = useCallback((span: Span, rowId: string) => {
    setItems((prev) => [...prev, { id: `new-${prev.length}`, rowId, span, label: 'New booking' }])
  }, [])

  const blackoutsByRow = useMemo(() => {
    const m: Record<string, Blackout[]> = {}
    for (const b of FIX.blackouts) (m[b.resourceId] ??= []).push(b)
    return m
  }, [])

  return (
    <div dir={rtl ? 'rtl' : 'ltr'}>
      <TimelineContext range={range} onDragEnd={onDragEnd} onResizeEnd={onResizeEnd} onRangeChanged={setRange} sidebarWidth={180}>
        <Inner rtl={rtl} items={items} blackoutsByRow={blackoutsByRow} onCreate={onCreate} />
      </TimelineContext>
    </div>
  )
}

function TimeAxis(props: { rtl: boolean }) {
  const { range, valueToPixels, sidebarWidth } = useTimelineContext()
  const marks = useMemo(() => {
    const out: { label: string; sub: string; x: number }[] = []
    const origin = valueToPixels(range.start)
    // one mark per day at local midnight, plus 6h subticks
    const first = new Date(range.start)
    first.setUTCHours(0, 0, 0, 0)
    for (let t = first.getTime(); t <= range.end; t += 6 * 3600e3) {
      if (t < range.start) continue
      const d = new Date(t)
      const isDay = d.getUTCHours() === 0
      out.push({
        label: isDay
          ? d.toLocaleDateString(props.rtl ? 'ar' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
          : '',
        sub: isDay ? '' : d.toLocaleTimeString(props.rtl ? 'ar' : 'en-GB', { hour: '2-digit', timeZone: 'UTC' }),
        x: valueToPixels(t) - origin,
      })
    }
    return out
  }, [range, valueToPixels, props.rtl])

  return (
    <div className="timeaxis" data-testid="time-axis">
      <div style={{ inlineSize: sidebarWidth, flexShrink: 0 }} className="timeaxis-corner" />
      <div className="timeaxis-track">
        {marks.map((m, i) => (
          <div key={i} className={m.label ? 'tick day' : 'tick'} style={{ insetInlineStart: m.x }}>
            {m.label || m.sub}
          </div>
        ))}
      </div>
    </div>
  )
}

function Inner(props: {
  rtl: boolean
  items: (ItemDefinition & { label: string })[]
  blackoutsByRow: Record<string, Blackout[]>
  onCreate: (span: Span, rowId: string) => void
}) {
  const { setTimelineRef, style, range } = useTimelineContext()
  const grouped = useMemo(() => groupItemsToSubrows(props.items, range), [props.items, range])
  const labels = useMemo(() => new Map(props.items.map((i) => [i.id, i.label])), [props.items])

  return (
    <div ref={setTimelineRef} style={style} data-testid="dnd-timeline-root">
      <TimeAxis rtl={props.rtl} />
      {FIX.resources.map((r) => (
        <ResourceRow key={r.id} resource={r} rtl={props.rtl} blackouts={props.blackoutsByRow[r.id] ?? []} onCreate={props.onCreate}>
          {grouped[r.id]?.map((subrow, idx) => (
            <div key={idx} style={{ position: 'relative', height: 26 }}>
              {subrow.map((item) => (
                <BookingItem key={item.id} id={item.id as string} span={item.span} label={labels.get(item.id as string) ?? ''} />
              ))}
            </div>
          ))}
        </ResourceRow>
      ))}
    </div>
  )
}
