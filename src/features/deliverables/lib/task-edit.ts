import { appointmentsOf, lacksRequiredReviewer, type ReviewerAppointment } from '../../../lib/reviewers/task-reviewers'
import { iraqDay } from '../../../lib/time/iraq'
import type { TaskDependency } from '../api/requirements-api'
import type { EditableTask } from '../api/task-editor-api'
import type { ReviewMode } from '../../../lib/review/review-mode'

/**
 * **One task editor** (ADR-0140 d.1, I74.7): every detail of a task — name, notes, hours, person, days, what it
 * waits for, reviewers and how it is reviewed — edited in one form wherever the task is met. This file is the
 * form's pure half: what changed, which write carries it, and what stops a save before it is sent. The writes
 * themselves are the existing ones, gated as the server gates them:
 *
 *  - a change to the PERSON or the DAYS of a held task goes through `update_task_assignment` — the one path that
 *    turns another team's person or days into a request (ADR-0139, ADR-0140 d.2) and asks before moving a started
 *    task (d.3, `p_confirm_started`);
 *  - taking the person off is `unassign_task` (d.5);
 *  - everything else — and every field of an unheld task — is `save_sub_task`;
 *  - what it waits for is `sub_task_dependencies`, added and removed edge by edge.
 */
export interface TaskDraft {
  title: string
  notes: string
  /** the task's total hours (`sla_hours`); null when it has none yet */
  hours: number | null
  assigneeId: string | null
  /** first and last ISO day; null until picked */
  from: string | null
  to: string | null
  /** the tasks of the piece this one waits for; empty = starts any time */
  waitsFor: string[]
  reviewers: ReviewerAppointment[]
  reviewMode: ReviewMode
}

export interface TaskSavePlan {
  /** take the person off first (`unassign_task`) */
  unassign: boolean
  /** `update_task_assignment`: the person or the days moved on a task that will be held */
  assign: boolean
  /** `save_sub_task` carries these (only what changed) */
  plain: {
    title: boolean
    notes: boolean
    hours: boolean
    days: boolean
    reviewers: boolean
    reviewMode: boolean
  }
  /** an hours change on a held task, placed again on the days by `subtask-schedule` */
  rematerialise: boolean
  addDeps: string[]
  removeDeps: string[]
  nothing: boolean
}

const sameReviewers = (a: readonly ReviewerAppointment[], b: readonly ReviewerAppointment[]) =>
  a.length === b.length && a.every((x, i) => x.userId === b[i]?.userId && x.isMandatory === b[i]?.isMandatory)

export function changesOf(before: TaskDraft, draft: TaskDraft) {
  return {
    title: draft.title.trim() !== before.title.trim(),
    notes: draft.notes.trim() !== before.notes.trim(),
    hours: draft.hours != null && draft.hours !== before.hours,
    person: draft.assigneeId !== before.assigneeId,
    days: draft.from !== before.from || draft.to !== before.to,
    reviewers: !sameReviewers(draft.reviewers, before.reviewers),
    reviewMode: draft.reviewMode !== before.reviewMode,
    waits: draft.waitsFor.length !== before.waitsFor.length || draft.waitsFor.some((w) => !before.waitsFor.includes(w)),
  }
}

/**
 * The task changed under the form (a refetch landed while it was open): start again from the FRESH task and carry
 * over only what the user changed relative to what the form LOADED (test script step 14, 4 Oct). Comparing the
 * user's draft with the fresh task instead turns every field the server moved into a "change" the user never made
 * — a stale unbooked draft against a fresh booked task read as "take the person off", and Save unassigned her.
 */
export function rebaseDraft(loaded: TaskDraft, draft: TaskDraft, fresh: TaskDraft): TaskDraft {
  const c = changesOf(loaded, draft)
  return {
    title: c.title ? draft.title : fresh.title,
    notes: c.notes ? draft.notes : fresh.notes,
    hours: c.hours ? draft.hours : fresh.hours,
    // the person and the days travel together: a booking is both
    assigneeId: c.person ? draft.assigneeId : fresh.assigneeId,
    from: c.days || c.person ? draft.from : fresh.from,
    to: c.days || c.person ? draft.to : fresh.to,
    waitsFor: c.waits ? draft.waitsFor : fresh.waitsFor,
    reviewers: c.reviewers ? draft.reviewers : fresh.reviewers,
    reviewMode: c.reviewMode ? draft.reviewMode : fresh.reviewMode,
  }
}

/** Which writes a save makes, and in which order the caller makes them (unassign → assign → plain → waits). */
export function planTaskSave(before: TaskDraft, draft: TaskDraft): TaskSavePlan {
  const c = changesOf(before, draft)
  const unassign = before.assigneeId != null && draft.assigneeId == null
  const assign = draft.assigneeId != null && (c.person || c.days)
  // On the assignment path the title, hours, reviewers and review mode ride with it; only the notes do not
  // (`update_task_assignment` has no notes). Off it, everything that changed goes through `save_sub_task`.
  const plain = assign
    ? { title: false, notes: c.notes, hours: false, days: false, reviewers: false, reviewMode: false }
    : {
        title: c.title,
        notes: c.notes,
        hours: c.hours,
        // The days of a task with nobody on it are a plan, saved as they are (a held task's days go the assignment way).
        days: c.days && draft.assigneeId == null,
        reviewers: c.reviewers,
        reviewMode: c.reviewMode,
      }
  const addDeps = draft.waitsFor.filter((w) => !before.waitsFor.includes(w))
  const removeDeps = before.waitsFor.filter((w) => !draft.waitsFor.includes(w))
  const nothing = !unassign && !assign && !Object.values(plain).some(Boolean) && addDeps.length === 0 && removeDeps.length === 0
  return {
    unassign,
    assign,
    plain,
    rematerialise: !assign && plain.hours && draft.assigneeId != null,
    addDeps,
    removeDeps,
    nothing,
  }
}

export type DraftProblem = 'title' | 'hours' | 'dates' | 'reviewer' | 'reviewerRequired' | 'notApproved'

/**
 * What the form can say before sending (presentation; the server still decides). A held task needs its days and
 * someone to check it (the required-reviewer rule, ADR-0038/0089); a list not yet approved gives nobody out
 * (ADR-0052 d.10 — ADR-0140 d.4: before approval the rows carry no Who).
 */
export function draftProblem(before: TaskDraft, draft: TaskDraft, listApproved: boolean): DraftProblem | null {
  if (draft.title.trim().length === 0) return 'title'
  if (draft.hours != null && !(draft.hours > 0)) return 'hours'
  if (draft.assigneeId != null) {
    if (draft.assigneeId !== before.assigneeId && !listApproved) return 'notApproved'
    if (!draft.from || !draft.to) return 'dates'
    if (draft.reviewers.length === 0) return 'reviewer'
    if (lacksRequiredReviewer(draft.reviewers)) return 'reviewerRequired'
  }
  return null
}

/** The refusal hints the editor answers in place rather than as an error. */
export type TaskRefusal =
  | { kind: 'started'; name: string }
  | { kind: 'notAssigned' }
  | { kind: 'notYours' }
  | null

export function taskRefusal(err: unknown): TaskRefusal {
  const e = err as { hint?: string; details?: string } | null
  switch (e?.hint) {
    case 'task_started': return { kind: 'started', name: (e.details ?? '').trim() }
    case 'not_assigned': return { kind: 'notAssigned' }
    case 'unassign_task': return { kind: 'notYours' }
    default: return null
  }
}

/**
 * Is this task part of Maestro's suggestion — "Suggested" until the list is approved (CP-03)? A step of the
 * deliverable's workflow is, and so is the translation task the languages rule adds (ADR-0117 d.4–d.5): it has no
 * workflow step, but nobody added it by hand (test script step 1). The database knows the translation task by the
 * same title prefix (app.place_translation_task).
 */
/**
 * May this viewer edit a deliverable's tasks — the pencil, ✕, hours, add, reorder (ADR-0140 d.2)? Its owner; Traffic and
 * the Power Admin; a lead who books within reach (the server decides the reach). Never someone whose reach is an account:
 * the account manager changes the deliverable and asks a lead for a person, she does not edit its tasks (I74.53,
 * `20261004190000`). A team member holds project_tasks:manage but books nobody: read-only.
 */
export function mayEditTasks(v: { isOwner: boolean; scope: string | null; can: (grant: string) => boolean }): boolean {
  if (v.isOwner) return true
  if (v.scope === 'tenant') return true
  if (v.scope === 'account') return false
  return v.can('project_tasks:manage') && v.can('bookings:create')
}

export const TRANSLATION_TITLE_PREFIX = 'Translation — '
export function isSuggestedTask(t: { workflowStepId: string | null; title: string }): boolean {
  return t.workflowStepId != null || t.title.startsWith(TRANSLATION_TITLE_PREFIX)
}

/** The hours a task gets when it is added by hand and nobody says otherwise. */
export const DEFAULT_TASK_HOURS = 1

/** Step the hours by one, never below half an hour. */
export const stepHours = (h: number | null, by: 1 | -1) => Math.max(0.5, (h ?? 0) + by)

/** A task as the form starts from. */
export function draftOf(task: EditableTask, edges: readonly TaskDependency[]): TaskDraft {
  return {
    title: task.title,
    notes: task.notes,
    hours: task.hours,
    assigneeId: task.assigneeId,
    from: task.startsAt ? iraqDay(task.startsAt) : null,
    to: task.dueAt ? iraqDay(task.dueAt) : null,
    waitsFor: edges.filter((e) => e.subTaskId === task.id).map((e) => e.prerequisiteId),
    reviewers: appointmentsOf(task.reviewers),
    reviewMode: task.reviewMode,
  }
}
