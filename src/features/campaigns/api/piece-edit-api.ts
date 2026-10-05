import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabaseUntyped } from '../../../lib/supabase'
import { invalidateTaskViews } from '../../../lib/query/task-views'
import { endOfWorkingDay } from '../../../lib/time/iraq'

/**
 * Editing a piece where it is shown — the campaign page's side panel (ADR-0132, I68).
 *
 * - **A type change is direct** (d.3): `change_deliverable_type` cancels the old type's open tasks (their bookings
 *   freed, their assignees told), keeps finished and hand-added ones, and adds the new type's steps unassigned. The
 *   confirmation reads `preview_deliverable_type_change` first, so it says what will happen before it does.
 * - **A task is added by its name and due date** (d.2), unassigned, through the task editor `save_sub_task`. The
 *   owner's own addition keeps the list approved; anyone else's leaves it for the owner (d.4, the database decides).
 */

export interface TypeChangeTask {
  id: string
  title: string
  status: string
  /** who has it — the full name (I66.1), or null when nobody does */
  assigneeName: string | null
}

type TaskRaw = { id: string; title: string; status: string; assignee: string | null }

export interface TypeChangePreview {
  /** the old type's open tasks that are cancelled, and who has each */
  cancelled: TypeChangeTask[]
  /** finished and hand-added tasks, and any step the two types share */
  kept: TypeChangeTask[]
  /** the titles of the new type's tasks, as the list will title them */
  added: string[]
  /** true when the caller is the owner — the new list is approved as it lands */
  approvedAfter: boolean
  ownerId: string | null
}

export interface TypeChangeResult {
  cancelled: number
  added: number
  approved: boolean
}

type PreviewRaw = {
  cancelled: TaskRaw[]
  kept: TaskRaw[]
  added: string[]
  approved_after: boolean
  owner_id: string | null
}

export const pieceEditKeys = {
  preview: (deliverableId: string, typeId: string) => ['piece-edit', 'type-preview', deliverableId, typeId] as const,
}

const toTask = (t: TaskRaw): TypeChangeTask => ({ id: t.id, title: t.title, status: t.status, assigneeName: t.assignee ?? null })

export function toPreview(raw: PreviewRaw): TypeChangePreview {
  return {
    cancelled: (raw.cancelled ?? []).map(toTask),
    kept: (raw.kept ?? []).map(toTask),
    added: raw.added ?? [],
    approvedAfter: Boolean(raw.approved_after),
    ownerId: raw.owner_id ?? null,
  }
}

/** What changing `deliverableId` to `typeId` would do. Off until both are chosen and differ from today's. */
export function usePreviewTypeChange(deliverableId: string | null, typeId: string | null) {
  return useQuery({
    queryKey: pieceEditKeys.preview(deliverableId ?? 'none', typeId ?? 'none'),
    enabled: Boolean(deliverableId && typeId),
    staleTime: 0,
    queryFn: async (): Promise<TypeChangePreview> => {
      const { data, error } = await supabaseUntyped.rpc('preview_deliverable_type_change', {
        p_deliverable: deliverableId,
        p_type: typeId,
      })
      if (error) throw error
      return toPreview(data as PreviewRaw)
    },
  })
}

export function useChangeDeliverableType() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deliverableId: string; typeId: string }): Promise<TypeChangeResult> => {
      const { data, error } = await supabaseUntyped.rpc('change_deliverable_type', {
        p_deliverable: args.deliverableId,
        p_type: args.typeId,
      })
      if (error) throw error
      return data as TypeChangeResult
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: ['piece-edit'] })
    },
  })
}

/**
 * The due date as saved. A day ("2026-10-10", what the date box gives) is due at the close of that working day in Iraq
 * time (ADR-0076 d.3); a full timestamp is kept as it is.
 */
export function taskDueAt(due: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(due) ? endOfWorkingDay(due).toISOString() : new Date(due).toISOString()
}

export function useAddTaskToPiece() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deliverableId: string; title: string; dueAt: string }): Promise<string> => {
      const title = args.title.trim()
      if (!title) throw new Error('A task needs a name.')
      const { data, error } = await supabaseUntyped.rpc('save_sub_task', {
        p_sub_task: null,
        p_deliverable: args.deliverableId,
        p_title: title,
        p_reviewers: null,
        p_due_at: taskDueAt(args.dueAt),
      })
      if (error) throw error
      return data as string
    },
    onSuccess: () => invalidateTaskViews(qc),
  })
}

// ------------------------------------------------------------ quantity and due date (ADR-0132 d.2-d.3)

export interface QuantityChangePreview {
  /** the open unit tasks above the new count, which are cancelled */
  cancelled: TypeChangeTask[]
  /** the unit tasks a higher count adds (a unit cancelled earlier comes back) */
  added: string[]
  approvedAfter: boolean
}

export interface PieceEditResult {
  cancelled: number
  added: number
  quantity: number
  dueAt: string | null
}

export function toQuantityPreview(raw: { cancelled?: TaskRaw[]; added?: string[]; approved_after?: boolean }): QuantityChangePreview {
  return {
    cancelled: (raw.cancelled ?? []).map(toTask),
    added: raw.added ?? [],
    approvedAfter: Boolean(raw.approved_after),
  }
}

/** What changing the quantity to `quantity` would do. Off until a quantity is chosen. */
export function usePreviewQuantityChange(deliverableId: string | null, quantity: number | null) {
  return useQuery({
    queryKey: ['piece-edit', 'quantity-preview', deliverableId ?? 'none', quantity ?? 0] as const,
    enabled: Boolean(deliverableId && quantity && quantity >= 1),
    staleTime: 0,
    queryFn: async (): Promise<QuantityChangePreview> => {
      const { data, error } = await supabaseUntyped.rpc('preview_quantity_change', {
        p_deliverable: deliverableId,
        p_quantity: quantity,
      })
      if (error) throw error
      return toQuantityPreview(data as Parameters<typeof toQuantityPreview>[0])
    },
  })
}

/**
 * Correct a piece's quantity and/or due date directly — started or not (`edit_piece_directly`). A lower quantity cancels
 * the open units above it; a higher one adds units, unassigned. The due date is a day (`YYYY-MM-DD`), due at 18:00 Iraq.
 * Leave a field out to keep it.
 */
export function useEditPieceDirect() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (args: { deliverableId: string; quantity?: number | null; dueDay?: string | null }): Promise<PieceEditResult> => {
      const { data, error } = await supabaseUntyped.rpc('edit_piece_directly', {
        p_deliverable: args.deliverableId,
        p_quantity: args.quantity ?? null,
        p_due_day: args.dueDay ?? null,
      })
      if (error) throw error
      const r = data as { cancelled: number; added: number; quantity: number; due_at: string | null }
      return { cancelled: r.cancelled, added: r.added, quantity: r.quantity, dueAt: r.due_at }
    },
    onSuccess: () => {
      invalidateTaskViews(qc)
      void qc.invalidateQueries({ queryKey: ['piece-edit'] })
    },
  })
}
