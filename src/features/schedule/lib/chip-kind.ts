import type { ScheduleBooking } from '../api/schedule-api'

/**
 * Is this chip AD-HOC (green) or PROJECT work (purple), and what does it say?
 *
 * The grid used to decide with `!campaignName && !taskName`, which was correct until ADR-0035:
 * back then ad-hoc work had no deliverable, so having no deliverable name meant ad-hoc. ADR-0035
 * gave **every** ad-hoc task a deliverable — that is the whole point of it, so the review stack has
 * something to hang off — which made `taskName` always populated and the test permanently false.
 * Every chip has been rendering purple since, ad-hoc included, contradicting the legend right
 * beside it.
 *
 * The question that actually separates them is the CAMPAIGN. Project work belongs to one; ad-hoc
 * work does not, and no booking path sets `campaign_id` for it (`subtask-schedule` writes only
 * deliverable_id + sub_task_id; `booking-transition` derives the campaign through the deliverable's
 * stream, which job-backed ad-hoc work has none of).
 *
 * The LABEL has to move with it. `create_adhoc_deliverable` names the deliverable after the task
 * title, so `taskName` is the ad-hoc chip's real label; the old ad-hoc branch read `notes`, which is
 * usually empty. Flipping the classification without this would have blanked every ad-hoc chip.
 */
export interface ChipKind {
  isAdhoc: boolean
  /** What the chip shows on the grid. */
  label: string
  /** The bold first line of the hover tooltip. */
  title: string
}

export function chipKind(b: Pick<ScheduleBooking, 'campaignId' | 'campaignName' | 'taskName' | 'notes'>): ChipKind {
  const isAdhoc = b.campaignId == null
  if (isAdhoc) {
    // taskName first (the ad-hoc deliverable is named after its task), notes for a plain
    // reservation that has no task behind it at all.
    const text = b.taskName ?? b.notes ?? ''
    return { isAdhoc, label: text, title: text }
  }
  return {
    isAdhoc,
    label: [b.taskName, b.campaignName].filter(Boolean).join(' · '),
    title: b.taskName ?? '',
  }
}
